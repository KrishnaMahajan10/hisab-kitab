import { existsSync, readFileSync } from 'node:fs';

import { readXlsSheets } from './biff';
import { readCsvGrid } from './csv';
import {
  merchantFromNarration,
  parseTable,
  parseTableDate,
  referenceFromNarration,
} from './table';

let failures = 0;
const check = (label: string, condition: boolean, detail = '') => {
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  ${label} ${detail}`);
  }
};

const NL = String.fromCharCode(10);
const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);

console.log('\nDates as banks write them\n');

const DATES: Array<{ raw: string | number; expect: string | null }> = [
  { raw: '15/08/2026', expect: '2026-08-15' },
  { raw: '15-08-2026', expect: '2026-08-15' },
  { raw: '15.08.2026', expect: '2026-08-15' },
  { raw: '15-Aug-2026', expect: '2026-08-15' },
  { raw: '15 Aug 2026', expect: '2026-08-15' },
  { raw: '15-Sept-2026', expect: '2026-09-15' },
  { raw: 'Aug 15, 2026', expect: '2026-08-15' },
  { raw: '2026-08-15', expect: '2026-08-15' },
  { raw: '15/08/26', expect: '2026-08-15' },
  { raw: '15/08/2026 22:41:49', expect: '2026-08-15' },
  // Excel serial: 45884 is 15 Aug 2025, so 46249 is a year later.
  { raw: 46249, expect: '2026-08-15' },
  { raw: 'Opening Balance', expect: null },
  { raw: '', expect: null },
  { raw: '32/08/2026', expect: null },
  { raw: '15/13/2026', expect: null },
];

for (const sample of DATES) {
  const parsed = parseTableDate(sample.raw);
  const actual = parsed === null ? null : day(parsed);
  check(`"${sample.raw}" reads as ${sample.expect}`, actual === sample.expect, `-> ${actual}`);
}

// Day-first is the only reading used, on purpose: 08/09/2026 filed as September
// instead of August would put the payment in the wrong month.
check('an ambiguous date reads day-first', day(parseTableDate('08/09/2026')!) === '2026-09-08');

console.log('\nReading the payment reference out of a narration\n');

const NARRATIONS: Array<{ raw: string; reference: string | null; merchant: string | null }> = [
  {
    raw: 'UPI/SAFA ARBAZ/paytm.s228d6c@/UPI/YES BANK P/659315937795/ICI7168ffeb5cd74035ab58fc4bdc405fe7/',
    reference: '659315937795',
    merchant: 'Safa Arbaz',
  },
  {
    // The bank puts the reference first and never names the payee.
    raw: 'UPI/622250777175/14:05:02/UPI/amznlpa-txjdit4eur@',
    reference: '622250777175',
    merchant: null,
  },
  {
    raw: 'ACHCR/MAHINDRA AND MAHINDR/2547275115/111431588901',
    reference: '111431588901',
    merchant: 'Mahindra And Mahindr',
  },
  {
    raw: 'NEFT/SBIN0001234/Acme Payroll/salary aug',
    reference: null,
    merchant: 'Sbin0001234',
  },
  { raw: 'ATM WDL SELF', reference: null, merchant: 'Atm Wdl Self' },
  { raw: '', reference: null, merchant: null },
];

for (const sample of NARRATIONS) {
  const reference = referenceFromNarration(sample.raw);
  const merchant = merchantFromNarration(sample.raw);
  check(`reference of "${sample.raw.slice(0, 34)}"`, reference === sample.reference, `-> ${reference}`);
  check(`merchant of "${sample.raw.slice(0, 34)}"`, merchant === sample.merchant, `-> ${merchant}`);
}

console.log('\nSeparate withdrawal and deposit columns\n');

const hdfc = readCsvGrid(
  [
    'HDFC BANK LTD',
    'Account No: 50100123456789',
    '',
    'Date,Narration,Chq/Ref No,Value Dt,Withdrawal Amt,Deposit Amt,Closing Balance',
    '01/08/2026,UPI-SWIGGY-swiggy@ybl-HDFC-659315937795,659315937795,01/08/2026,250.00,0.00,14487.83',
    '02/08/2026,SALARY AUG 2026,0000000,02/08/2026,0.00,"85,000.00",99487.83',
    '03/08/2026,Opening Balance,,,,,99487.83',
  ].join(NL)
);
const hdfcParsed = parseTable(hdfc);
check('the header is found under the title block', hdfcParsed.headerRow === 2, String(hdfcParsed.headerRow));
check('two transactions are read', hdfcParsed.rows.length === 2, String(hdfcParsed.rows.length));
check('a balance-only row is skipped', hdfcParsed.skipped === 1, String(hdfcParsed.skipped));
check('the withdrawal is a debit', hdfcParsed.rows[0].direction === 'debit');
check('the withdrawal amount is in paise', hdfcParsed.rows[0].amountPaise === 25000, String(hdfcParsed.rows[0].amountPaise));
check('the deposit is a credit', hdfcParsed.rows[1].direction === 'credit');
check('a quoted thousands amount is read', hdfcParsed.rows[1].amountPaise === 8500000, String(hdfcParsed.rows[1].amountPaise));
check('the account is taken from the title block', hdfcParsed.accountHint === '6789', String(hdfcParsed.accountHint));
check('Date is preferred over Value Dt', day(hdfcParsed.rows[0].occurredAt) === '2026-08-01');

console.log('\nOne amount column with a Dr/Cr indicator\n');

const axis = readCsvGrid(
  [
    'Tran Date,Particulars,Amount,DR/CR,Balance',
    '01/08/2026,POS PURCHASE BIGBASKET,1250.75,DR,20000.00',
    '02/08/2026,INTEREST CREDIT,340.00,CR,20340.00',
    '03/08/2026,UNKNOWN ROW,0.00,DR,20340.00',
  ].join(NL)
);
const axisParsed = parseTable(axis);
check('two transactions are read', axisParsed.rows.length === 2, String(axisParsed.rows.length));
check('DR is a debit', axisParsed.rows[0].direction === 'debit');
check('CR is a credit', axisParsed.rows[1].direction === 'credit');
check('the amount is read', axisParsed.rows[0].amountPaise === 125075, String(axisParsed.rows[0].amountPaise));
check('a zero-amount row is skipped', axisParsed.skipped === 1, String(axisParsed.skipped));
// "DR/CR" contains both words; reading it as the debit column would misfile
// every row in the file.
check('the indicator column is not mistaken for a debit column', axisParsed.columns?.debit === -1);

console.log('\nOne signed amount column\n');

const signed = readCsvGrid(
  [
    'Date,Description,Amount',
    '01/08/2026,CARD PURCHASE,-499.00',
    '02/08/2026,REFUND,199.00',
  ].join(NL)
);
const signedParsed = parseTable(signed);
check('a negative amount is a debit', signedParsed.rows[0].direction === 'debit');
check('the sign is dropped from the amount', signedParsed.rows[0].amountPaise === 49900);
check('a positive amount is a credit', signedParsed.rows[1].direction === 'credit');

console.log('\nFiles that hold no table\n');

const noTable = parseTable(readCsvGrid(['just,some,notes', 'nothing,to,see'].join(NL)));
check('no header means no rows', noTable.rows.length === 0);
check('no header is reported as null columns', noTable.columns === null);
check('an empty grid is handled', parseTable([]).rows.length === 0);

console.log('\nA real ICICI .xls export\n');

const FIXTURE = 'src/import/fixtures/icici-sample.xls';
if (!existsSync(FIXTURE)) {
  console.log(`  skipped — ${FIXTURE} is not present (it holds real account data and is gitignored)`);
} else {
  const sheets = readXlsSheets(new Uint8Array(readFileSync(FIXTURE)));
  check('one sheet is found', sheets.length === 1, String(sheets.length));

  const parsed = parseTable(sheets[0].rows);
  check('the header is found below the title block', parsed.headerRow === 12, String(parsed.headerRow));
  check('every transaction is read', parsed.rows.length === 15, String(parsed.rows.length));
  check('the legend rows are skipped, not guessed at', parsed.skipped === 28, String(parsed.skipped));
  check('Transaction Date is used, not Value Date', parsed.columns?.date === 3, String(parsed.columns?.date));
  check('all rows carry a reference', parsed.rows.every((row) => row.reference !== null));
  check('all rows carry a merchant', parsed.rows.every((row) => row.merchant !== null));
  check('all rows are debits', parsed.rows.every((row) => row.direction === 'debit'));
  check('no row has a zero amount', parsed.rows.every((row) => row.amountPaise > 0));
  check('the account is taken from the header block', parsed.accountHint === '2810', String(parsed.accountHint));

  // These two UTRs also appear in the SMS dedup tests, which is the whole point:
  // the same payment seen from both sources must carry the same reference.
  const references = parsed.rows.map((row) => row.reference);
  check('a known UTR is present', references.includes('180129513492'));
  check('a second known UTR is present', references.includes('585204261401'));

  const first = parsed.rows[0];
  check('the first row is dated correctly', day(first.occurredAt) === '2026-08-15', day(first.occurredAt));
  check('the first amount is right', first.amountPaise === 25000, String(first.amountPaise));

  const total = parsed.rows.reduce((sum, row) => sum + row.amountPaise, 0);
  // 14487.83 is the balance after the first row, 10711.83 after the last.
  check('the amounts add up to the balance movement', total === 25000 + 377600, String(total));

  console.log(`  ${parsed.rows.length} transactions, ${parsed.skipped} non-transaction rows skipped`);
}

console.log(failures === 0 ? '\nAll assertions passed\n' : `\n${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
