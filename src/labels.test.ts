import { displayTitle, originBadge, paymentReference } from './labels';

let failures = 0;
const check = (label: string, condition: boolean, detail = '') => {
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  ${label} ${detail}`);
  }
};

console.log('\nRow titles\n');

const CASES: Array<{
  label: string;
  row: { title?: string | null; merchant?: string | null };
  expect: string;
}> = [
  {
    label: 'user title wins over merchant',
    row: { title: 'Monthly rent', merchant: 'Anita Bhosale' },
    expect: 'Monthly rent',
  },
  {
    label: 'merchant stands in when untitled',
    row: { title: null, merchant: 'Swiggy' },
    expect: 'Swiggy',
  },
  {
    label: 'blank title falls back rather than showing empty',
    row: { title: '   ', merchant: 'Swiggy' },
    expect: 'Swiggy',
  },
  {
    label: 'title is trimmed',
    row: { title: '  Chai  ', merchant: 'Swiggy' },
    expect: 'Chai',
  },
  {
    label: 'manual row with only a title',
    row: { title: 'Auto to office', merchant: null },
    expect: 'Auto to office',
  },
  {
    label: 'neither set falls back to Unknown',
    row: { title: null, merchant: null },
    expect: 'Unknown',
  },
  {
    label: 'blank merchant does not win over nothing',
    row: { title: null, merchant: '  ' },
    expect: 'Unknown',
  },
];

for (const testCase of CASES) {
  const actual = displayTitle(testCase.row);
  check(testCase.label, actual === testCase.expect, `-> "${actual}"`);
}

check(
  'caller can override the fallback',
  displayTitle({ title: null, merchant: null }, 'Unknown merchant') === 'Unknown merchant'
);

// Titles must not disturb the badges and references shown beside them.
check(
  'statement rows still badge as PDF',
  originBadge({ source: 'manual', raw_sender: 'statement:phonepe' }) === 'PDF'
);
check(
  'reference is still read from the row',
  paymentReference({ reference: '523401', dedup_key: null }) === '523401'
);

console.log(failures === 0 ? '\nAll assertions passed\n' : `\n${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
