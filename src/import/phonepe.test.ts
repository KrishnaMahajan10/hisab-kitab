import { looksLikePhonePeStatement, maskDigits, parsePhonePeStatement } from './phonepe';

const SAMPLE = [
  'Transaction Statement for 9800000000',
  '21 Jul, 2026 - 20 Aug, 2026',
  'Date Transaction Details Type Amount',
  'Aug 19, 2026',
  '08:51 pm',
  'DEBIT ₹100\tPaid to S SQUARE HOSPITALITY',
  'Transaction ID T2608192051120944645731',
  'UTR No. 585204261401',
  'Paid by XXXXXXXXXX10',
  'Aug 17, 2026',
  '09:58 am',
  'DEBIT ₹2,000\tPaid to Dad',
  'Transaction ID T2608170958316328851503',
  'UTR No. 180129513492',
  'Paid by XXXXXXXXXX10',
  'Page 1 of 7',
  'This is a system generated statement. For any queries, contact us at https://support.phonepe.com/statement.',
  '-- 1 of 7 --',
  'Date Transaction Details Type Amount',
  'Aug 14, 2026',
  '11:02 am',
  'CREDIT ₹1,499.50\tReceived from ANJALI LAD',
  'Transaction ID T2608141102110000000001',
  'UTR No. 700000000001',
  'Paid by XXXXXX9823',
  'Aug 12, 2026',
  '06:30 pm',
  'DEBIT ₹1,240\tElectricity bill MSEDCL',
  'Bharat Connect Transaction ID PP016214BB0HR1PFG508',
  'Paid by XXXXXX9823',
].join('\n');

let failures = 0;
const check = (label: string, condition: boolean, detail = '') => {
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  ${label} ${detail}`);
  }
};

console.log('\nPhonePe statement parsing\n');

check('detection', looksLikePhonePeStatement(SAMPLE), 'should be detected as PhonePe');

const result = parsePhonePeStatement(SAMPLE);
console.log(`  parsed ${result.rows.length} rows, skipped ${result.skipped}`);
check('row count', result.rows.length === 4, `got ${result.rows.length}, want 4`);
check('no skips', result.skipped === 0, `skipped ${result.skipped}`);

for (const row of result.rows) {
  console.log(
    `   ${row.direction.padEnd(6)} ${String(row.amountPaise).padStart(8)}p  ` +
      `${new Date(row.occurredAt).toLocaleString('en-IN')}  exact=${row.hasExactTime}  ` +
      `mask=${row.accountMask}  ref=${row.reference}  "${row.merchant}"`
  );
}

const [first, second, third, fourth] = result.rows;

check('first amount', first.amountPaise === 10000, `${first.amountPaise}`);
check('first direction', first.direction === 'debit');
check('first merchant', first.merchant === 'S Square Hospitality', `"${first.merchant}"`);
check('first exact time', first.hasExactTime === true);
check('first hour is 20:51', new Date(first.occurredAt).getHours() === 20,
  `${new Date(first.occurredAt).getHours()}`);
check('first ref is UTR', first.reference === '585204261401', `${first.reference}`);
check('first mask', first.accountMask === 'XXXXXXXXXX10');

check('second merchant keeps case', second.merchant === 'Dad', `"${second.merchant}"`);
check('second amount with comma', second.amountPaise === 200000, `${second.amountPaise}`);
check('second am hour is 9', new Date(second.occurredAt).getHours() === 9);

check('third is credit', third.direction === 'credit');
check('third decimal amount', third.amountPaise === 149950, `${third.amountPaise}`);
check('third merchant strips "Received from"', third.merchant === 'Anjali Lad', `"${third.merchant}"`);
check('third mask', third.accountMask === 'XXXXXX9823');

check('fourth bill amount', fourth.amountPaise === 124000, `${fourth.amountPaise}`);
check('fourth bill merchant keeps acronym', fourth.merchant === 'Electricity bill MSEDCL', `"${fourth.merchant}"`);
check('fourth ref from Bharat Connect', fourth.reference === 'PP016214BB0HR1PFG508', `${fourth.reference}`);

console.log('\nAccount mask digits\n');
check('4-digit mask', maskDigits('XXXXXX9823') === '9823');
check('2-digit mask', maskDigits('XXXXXXXXXX10') === '10');
check('null mask', maskDigits(null) === null);
console.log(`  XXXXXX9823 -> ${maskDigits('XXXXXX9823')}`);
console.log(`  XXXXXXXXXX10 -> ${maskDigits('XXXXXXXXXX10')}`);

console.log('\nSplit-line shape (as PDFBox may emit it)\n');

const SPLIT = [
  'Transaction Statement for 9800000000',
  'UTR No. placeholder',
  'Aug 19, 2026',
  '08:51 pm',
  'DEBIT',
  '₹100',
  'Paid to S SQUARE HOSPITALITY',
  'Transaction ID T2608192051120944645731',
  'UTR No. 585204261401',
  'Paid by XXXXXXXXXX10',
  'Aug 18, 2026',
  '07:58 pm',
  'CREDIT ₹1,250.75',
  'Received from ANJALI LAD',
  'UTR No. 999888777666',
  'Paid by XXXXXX9823',
].join('\n');

const splitResult = parsePhonePeStatement(SPLIT);
console.log(`  parsed ${splitResult.rows.length} rows from split shape`);
splitResult.rows.forEach((row) =>
  console.log(
    `   ${row.direction.padEnd(6)} ${row.amountPaise}p  "${row.merchant}"  ref=${row.reference}`
  )
);
check('split row count', splitResult.rows.length === 2, `got ${splitResult.rows.length}`);
check('split first amount', splitResult.rows[0]?.amountPaise === 10000);
check('split first merchant', splitResult.rows[0]?.merchant === 'S Square Hospitality',
  `"${splitResult.rows[0]?.merchant}"`);
check('split second is credit', splitResult.rows[1]?.direction === 'credit');
check('split second amount', splitResult.rows[1]?.amountPaise === 125075,
  `${splitResult.rows[1]?.amountPaise}`);
check('split second merchant', splitResult.rows[1]?.merchant === 'Anjali Lad',
  `"${splitResult.rows[1]?.merchant}"`);

console.log('\nCombined-row shape (what PDFBox actually emits on device)\n');

const COMBINED = [
  'Transaction Statement for 9800000000',
  '21 Jul, 2026 - 20 Aug, 2026',
  'Date Transaction Details Type Amount',
  'Aug 19, 2026 Paid to S SQUARE HOSPITALITY DEBIT ₹100',
  '08:51 pm Transaction ID T2608192051120944645731',
  'UTR No. 585204261401',
  'Paid by XXXXXXXXXX10',
  'Aug 19, 2026 Paid to SATHE PATIL PETROLEUM DEBIT ₹445',
  '08:16 pm Transaction ID T2608192016415831309695',
  'UTR No. 015976282936',
  'Paid by XXXXXXXXXX10',
  'Page 1 of 7',
  '-- 1 of 7 --',
  'Aug 14, 2026 Received from ANJALI LAD CREDIT ₹1,499.50',
  '11:02 am Transaction ID T2608141102110000000001',
  'UTR No. 700000000001',
  'Paid by XXXXXX9823',
  'Aug 12, 2026 Electricity bill MSEDCL DEBIT ₹1,240',
  '06:30 pm Bharat Connect Transaction ID PP016214BB0HR1PFG508',
  'Paid by XXXXXX9823',
].join('\n');

const combinedResult = parsePhonePeStatement(COMBINED);
console.log(`  parsed ${combinedResult.rows.length} rows, skipped ${combinedResult.skipped}`);
combinedResult.rows.forEach((row) =>
  console.log(
    `   ${row.direction.padEnd(6)} ${String(row.amountPaise).padStart(8)}p  ` +
      `${new Date(row.occurredAt).toLocaleString('en-IN')}  exact=${row.hasExactTime}  ` +
      `mask=${row.accountMask}  ref=${row.reference}  "${row.merchant}"`
  )
);

check('combined row count', combinedResult.rows.length === 4, `got ${combinedResult.rows.length}`);
check('combined no skips', combinedResult.skipped === 0, `${combinedResult.skipped}`);

const [c1, c2, c3, c4] = combinedResult.rows;
check('combined amount', c1?.amountPaise === 10000, `${c1?.amountPaise}`);
check('combined merchant', c1?.merchant === 'S Square Hospitality', `"${c1?.merchant}"`);
check('combined exact time applied', c1?.hasExactTime === true);
check('combined hour 20', new Date(c1?.occurredAt ?? 0).getHours() === 20,
  `${new Date(c1?.occurredAt ?? 0).getHours()}`);
check('combined ref is UTR', c1?.reference === '585204261401', `${c1?.reference}`);
check('combined mask', c1?.accountMask === 'XXXXXXXXXX10');

check('combined second merchant', c2?.merchant === 'Sathe Patil Petroleum', `"${c2?.merchant}"`);
check('combined second time not leaked from first',
  new Date(c2?.occurredAt ?? 0).getHours() === 20 && new Date(c2?.occurredAt ?? 0).getMinutes() === 16,
  `${new Date(c2?.occurredAt ?? 0).toLocaleTimeString('en-IN')}`);

check('combined credit direction', c3?.direction === 'credit');
check('combined credit amount', c3?.amountPaise === 149950, `${c3?.amountPaise}`);
check('combined credit merchant', c3?.merchant === 'Anjali Lad', `"${c3?.merchant}"`);

check('combined bill amount', c4?.amountPaise === 124000, `${c4?.amountPaise}`);
check('combined bill ref', c4?.reference === 'PP016214BB0HR1PFG508', `${c4?.reference}`);
check('combined bill merchant', c4?.merchant === 'Electricity bill MSEDCL', `"${c4?.merchant}"`);

console.log('\nNon-PhonePe text is not misdetected\n');
check('rejects random text', !looksLikePhonePeStatement('HDFC Bank Account Statement\nDate Narration'));

console.log(failures === 0 ? '\nAll assertions passed\n' : `\n${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
