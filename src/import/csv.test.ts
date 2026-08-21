import { parseLooseNumber, readCsvGrid, sniffDelimiter } from './csv';

let failures = 0;
const check = (label: string, condition: boolean, detail = '') => {
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  ${label} ${detail}`);
  }
};

const NL = String.fromCharCode(10);
const CR = String.fromCharCode(13);
const TAB = String.fromCharCode(9);

console.log('\nPicking the delimiter\n');

// Counting commas would pick the wrong one here: the amounts contain commas but
// the file is semicolon-separated.
const semicolons = [
  'Date;Narration;Amount',
  '01/08/2026;SWIGGY;1,234.00',
  '02/08/2026;BLINKIT;2,500.50',
].join(NL);
check('semicolons win over commas inside numbers', sniffDelimiter(semicolons) === ';');

const tabs = ['Date' + TAB + 'Narration' + TAB + 'Amount', '01/08/2026' + TAB + 'SWIGGY' + TAB + '40'].join(NL);
check('tabs are detected', sniffDelimiter(tabs) === TAB);

check(
  'commas are detected',
  sniffDelimiter(['Date,Narration,Amount', '01/08/2026,SWIGGY,40'].join(NL)) === ','
);
check('an empty file falls back to a comma', sniffDelimiter('') === ',');

console.log('\nNumbers as banks write them\n');

const NUMBERS: Array<{ raw: string; expect: number | null }> = [
  { raw: '1,234.50', expect: 1234.5 },
  { raw: '40', expect: 40 },
  { raw: '0.00', expect: 0 },
  { raw: '(200.00)', expect: -200 },
  { raw: '-200.00', expect: -200 },
  { raw: '2,000.00 Dr', expect: -2000 },
  { raw: '2,000.00 Cr', expect: 2000 },
  { raw: 'Rs. 1,50,000.00', expect: 150000 },
  { raw: '1.234,50', expect: 1234.5 },
  // A three-digit group after the comma is a thousands separator, not a decimal:
  // a statement that says 1,234 means one thousand two hundred and thirty-four.
  { raw: '1,234', expect: 1234 },
  { raw: '1,5', expect: 1.5 },
  { raw: '1,50', expect: 1.5 },
  { raw: '1,234,567', expect: 1234567 },
  { raw: '-', expect: null },
  { raw: '', expect: null },
  { raw: 'NA', expect: null },
  { raw: 'Opening Balance', expect: null },
];

for (const sample of NUMBERS) {
  const actual = parseLooseNumber(sample.raw);
  check(`"${sample.raw}" reads as ${sample.expect}`, actual === sample.expect, `-> ${actual}`);
}

console.log('\nQuoting\n');

const quoted = [
  'Date,Narration,Amount',
  '01/08/2026,"SWIGGY, BENGALURU",40.00',
  '02/08/2026,"He said ""hi""",50.00',
].join(NL);
const quotedGrid = readCsvGrid(quoted);
check('a quoted comma stays inside its field', quotedGrid[1][1] === 'SWIGGY, BENGALURU', String(quotedGrid[1][1]));
check('a doubled quote becomes one quote', quotedGrid[2][1] === 'He said "hi"', String(quotedGrid[2][1]));
check('the row keeps three fields', quotedGrid[1].length === 3, String(quotedGrid[1].length));

const embeddedNewline = 'Date,Narration' + NL + '01/08/2026,"line one' + NL + 'line two"';
const embeddedGrid = readCsvGrid(embeddedNewline);
check('a newline inside quotes does not split the row', embeddedGrid.length === 2, String(embeddedGrid.length));
check('both lines are kept', String(embeddedGrid[1][1]).includes('line two'));

console.log('\nGrid shape and typing\n');

const crlf = ['Date,Amount', '01/08/2026,40.00', '02/08/2026,50.00'].join(CR + NL);
const crlfGrid = readCsvGrid(crlf);
check('CRLF line endings give three rows', crlfGrid.length === 3, String(crlfGrid.length));
check('a bare number becomes a number', crlfGrid[1][1] === 40);
check('a date stays text', crlfGrid[1][0] === '01/08/2026', String(crlfGrid[1][0]));

const withBom = String.fromCharCode(0xfeff) + 'Date,Amount' + NL + '01/08/2026,40';
check('a byte-order mark is stripped', readCsvGrid(withBom)[0][0] === 'Date', String(readCsvGrid(withBom)[0][0]));

const blanks = ['Date,Amount', '', ',', '01/08/2026,40'].join(NL);
const blankGrid = readCsvGrid(blanks);
check('blank rows are dropped', blankGrid.length === 2, String(blankGrid.length));

const ragged = readCsvGrid(['a,b,c', '1,2', '3,4,5,6'].join(NL));
check('short rows are kept as-is', ragged[1].length === 2, String(ragged[1].length));
check('long rows are kept as-is', ragged[2].length === 4, String(ragged[2].length));

// An empty middle cell must stay in place: shifting it left would pair the next
// column's amount with the wrong transaction.
const gap = readCsvGrid('01/08/2026,,40.00');
check('an empty cell holds its position', gap[0].length === 3 && gap[0][1] === null);
check('the value after a gap is not shifted', gap[0][2] === 40);

console.log(failures === 0 ? '\nAll assertions passed\n' : `\n${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
