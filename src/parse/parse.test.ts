import {
  extractReference,
  merchantIdentity,
  NEAR_DUPLICATE_WINDOW_MS,
  parseCapture,
  referencesMatch,
} from './parse';
import { suggestCategory } from './categorize';

type Sample = {
  label: string;
  source: 'sms' | 'notification';
  sender: string;
  body: string;
  expect: {
    amountPaise: number;
    direction: 'debit' | 'credit';
    last4?: string | null;
    merchantLike?: RegExp;
    category?: string;
  };
};

const SAMPLES: Sample[] = [
  {
    label: 'HDFC credit card spend',
    source: 'sms',
    sender: 'HDFCBK',
    body: 'Rs.450.00 spent on HDFC Bank Card x1234 at SWIGGY on 12-08-25. Not you? Call 18002586161',
    expect: { amountPaise: 45000, direction: 'debit', last4: '1234', merchantLike: /swiggy/i, category: 'Food & Dining' },
  },
  {
    label: 'ICICI UPI debit with Info block',
    source: 'sms',
    sender: 'ICICIB',
    body: 'INR 1,200.00 debited from A/c XX4321 on 12-Aug-25. Info: UPI/523401/ZOMATO. Avl Bal INR 22,300.55',
    expect: { amountPaise: 120000, direction: 'debit', last4: '4321', merchantLike: /zomato/i, category: 'Food & Dining' },
  },
  {
    label: 'SBI transfer debit',
    source: 'sms',
    sender: 'SBIINB',
    body: 'Rs.500 debited from A/c X8899 on 12/08/25 transfer to BLINKIT Ref 402214 -SBI',
    expect: { amountPaise: 50000, direction: 'debit', last4: '8899', merchantLike: /blinkit/i, category: 'Groceries' },
  },
  {
    label: 'Axis card spend, amount after currency word',
    source: 'sms',
    sender: 'AxisBk',
    body: 'Spent Card no. XX5678 INR 250 12-08-25 UBER INDIA Avl Lmt INR 145000',
    expect: { amountPaise: 25000, direction: 'debit', last4: '5678', category: 'Transport' },
  },
  {
    label: 'Salary credit',
    source: 'sms',
    sender: 'KOTAKB',
    body: 'Your A/c XX2211 is credited with INR 85,000.00 on 01-Aug-25 by SALARY HEAPTRACE. Avl Bal INR 91,204.10',
    expect: { amountPaise: 8500000, direction: 'credit', last4: '2211', category: 'Salary' },
  },
  {
    label: 'Fuel spend',
    source: 'sms',
    sender: 'HDFCBK',
    body: 'Rs.2,000.00 spent on HDFC Bank Card x1234 at HPCL PETROL PUMP on 12-08-25.',
    expect: { amountPaise: 200000, direction: 'debit', last4: '1234', category: 'Fuel' },
  },
  {
    label: 'ATM withdrawal',
    source: 'sms',
    sender: 'SBIINB',
    body: 'Rs.5,000 withdrawn from A/c X8899 at ATM on 12-08-25. Avl Bal Rs.10,000',
    expect: { amountPaise: 500000, direction: 'debit', last4: '8899', category: 'Cash Withdrawal' },
  },
  {
    label: 'Subscription',
    source: 'notification',
    sender: 'com.phonepe.app',
    body: '₹649 paid to Netflix',
    expect: { amountPaise: 64900, direction: 'debit', category: 'Subscriptions' },
  },
  {
    label: 'EMI debit',
    source: 'sms',
    sender: 'ICICIB',
    body: 'INR 15,250.00 debited from A/c XX4321 on 05-Aug-25 towards HOME LOAN EMI. Avl Bal INR 40,000',
    expect: { amountPaise: 1525000, direction: 'debit', last4: '4321', category: 'Loan & EMI' },
  },
  {
    label: 'Refund credit',
    source: 'sms',
    sender: 'HDFCBK',
    body: 'Rs.1,299.00 credited to A/c XX1234 on 12-08-25 as refund from AMAZON.',
    expect: { amountPaise: 129900, direction: 'credit', last4: '1234', category: 'Refunds & Cashback' },
  },
  {
    label: 'Interest credit',
    source: 'sms',
    sender: 'SBIINB',
    body: 'Rs.412.00 credited to A/c X8899 on 30-Jun-25 being interest on savings.',
    expect: { amountPaise: 41200, direction: 'credit', last4: '8899', category: 'Interest & Dividends' },
  },
  {
    label: 'GPay notification',
    source: 'notification',
    sender: 'com.google.android.apps.nbu.paisa.user',
    body: '₹450 paid to Swiggy — Paid with HDFC Bank ••1234',
    expect: { amountPaise: 45000, direction: 'debit', merchantLike: /swiggy/i, category: 'Food & Dining' },
  },
  {
    label: 'PhonePe notification',
    source: 'notification',
    sender: 'com.phonepe.app',
    body: 'Payment successful — ₹1,899 paid to Amazon Pay',
    expect: { amountPaise: 189900, direction: 'debit', merchantLike: /amazon/i, category: 'Shopping' },
  },
  {
    label: 'Paise-level amount',
    source: 'sms',
    sender: 'HDFCBK',
    body: 'Rs.99.99 debited from A/c XX1111 on 12-08-25 to NETFLIX Ref 8812',
    expect: { amountPaise: 9999, direction: 'debit', last4: '1111', merchantLike: /netflix/i, category: 'Subscriptions' },
  },
];

const REJECT_SAMPLES: Array<{ label: string; body: string }> = [
  { label: 'OTP', body: '123456 is your OTP for a transaction of Rs.5000 at Amazon. Do not share.' },
  { label: 'Promo', body: 'Get a pre-approved loan of Rs.5,00,000. Apply now!' },
  { label: 'Balance only', body: 'Avl Bal in A/c XX1234 is Rs.22,300.55 as on 12-08-25' },
];

let failures = 0;
const check = (label: string, condition: boolean, detail: string) => {
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  ${label}: ${detail}`);
  }
};

console.log('\nParsing real-world formats\n');

for (const sample of SAMPLES) {
  const parsed = parseCapture({
    id: 1,
    source: sample.source,
    sender: sample.sender,
    body: sample.body,
    postedAt: new Date(2025, 7, 12, 13, 30).getTime(),
  });

  if (!parsed) {
    failures += 1;
    console.log(`  FAIL  ${sample.label}: returned null`);
    continue;
  }

  check(sample.label, parsed.amountPaise === sample.expect.amountPaise,
    `amount ${parsed.amountPaise} != ${sample.expect.amountPaise}`);
  check(sample.label, parsed.direction === sample.expect.direction,
    `direction ${parsed.direction} != ${sample.expect.direction}`);

  if (sample.expect.last4 !== undefined) {
    check(sample.label, parsed.last4 === sample.expect.last4,
      `last4 ${parsed.last4} != ${sample.expect.last4}`);
  }
  if (sample.expect.merchantLike) {
    check(sample.label, !!parsed.merchant && sample.expect.merchantLike.test(parsed.merchant),
      `merchant "${parsed.merchant}" !~ ${sample.expect.merchantLike}`);
  }
  if (sample.expect.category) {
    const category = suggestCategory(parsed.merchant, sample.body, parsed.direction, []);
    check(sample.label, category === sample.expect.category,
      `category "${category}" != "${sample.expect.category}"`);
  }

  console.log(
    `  ${sample.label}\n    amount=${parsed.amountPaise} dir=${parsed.direction} last4=${parsed.last4} merchant="${parsed.merchant}" conf=${parsed.confidence.toFixed(2)}`
  );
}

console.log('\nNoise rejection\n');
for (const sample of REJECT_SAMPLES) {
  const parsed = parseCapture({
    id: 1, source: 'sms', sender: 'X', body: sample.body, postedAt: Date.now(),
  });
  check(sample.label, parsed === null, 'should have been rejected but parsed');
  console.log(`  ${parsed === null ? 'rejected' : 'PARSED (BUG)'}  ${sample.label}`);
}

console.log('\nCross-source near-duplicate detection\n');
const smsTxn = parseCapture({
  id: 1, source: 'sms', sender: 'HDFCBK',
  body: 'Rs.450.00 spent on HDFC Bank Card x1234 at SWIGGY on 12-08-25.',
  postedAt: new Date(2025, 7, 12, 13, 30, 0).getTime(),
});
const notifTxn = parseCapture({
  id: 2, source: 'notification', sender: 'com.google.android.apps.nbu.paisa.user',
  body: '₹450 paid to Swiggy',
  postedAt: new Date(2025, 7, 12, 13, 30, 40).getTime(),
});

check('dedup', smsTxn !== null && notifTxn !== null, 'one side failed to parse');
if (smsTxn && notifTxn) {
  check('dedup', smsTxn.dedupKey !== notifTxn.dedupKey,
    'distinct captures must have distinct capture keys');
  check('dedup', smsTxn.amountPaise === notifTxn.amountPaise,
    'amounts should match');
  check('dedup', merchantIdentity(smsTxn.merchant) === merchantIdentity(notifTxn.merchant),
    `merchant identity "${merchantIdentity(smsTxn.merchant)}" != "${merchantIdentity(notifTxn.merchant)}"`);
  const withinWindow =
    Math.abs(smsTxn.occurredAt - notifTxn.occurredAt) <= NEAR_DUPLICATE_WINDOW_MS;
  check('dedup', withinWindow, 'timestamps outside near-duplicate window');
  console.log(
    `  same amount=${smsTxn.amountPaise} identity="${merchantIdentity(smsTxn.merchant)}" withinWindow=${withinWindow}`
  );
}

console.log('\nPayment reference extraction\n');
// The reference is what lets the same payment be recognised across sources, so
// every separator a bank puts between the rail name and the number matters.
const REFERENCE_SAMPLES: { label: string; body: string; expect: string | null }[] = [
  { label: 'UPI slash', body: 'Rs.500 debited a/c XX1234. UPI/123456789012/SWIGGY', expect: '123456789012' },
  { label: 'UPI colon', body: 'Rs.500 debited a/c XX1234. UPI:123456789012', expect: '123456789012' },
  { label: 'UPI colon space', body: 'Rs.500 debited a/c XX1234. UPI: 123456789012', expect: '123456789012' },
  { label: 'UPI Ref No', body: 'Rs.500 debited a/c XX1234. UPI Ref No 123456789012', expect: '123456789012' },
  { label: 'UPI hyphen', body: 'Rs.500 debited a/c XX1234. UPI-451234567890-SWIGGY', expect: '451234567890' },
  { label: 'UPI/DR/ block', body: 'Rs.500 debited. Info: UPI/DR/523401234567/ZOMATO/ICIC', expect: '523401234567' },
  { label: 'UPI/CR/ block', body: 'Rs.500 credited. Info: UPI/CR/412345678901/RAHUL', expect: '412345678901' },
  { label: 'UPI payee not ref', body: 'Rs.500 debited. Info: UPI/523401/ZOMATO', expect: '523401' },
  { label: 'bare Ref', body: 'Rs.500 debited from A/c X8899 transfer to BLINKIT Ref 402214', expect: '402214' },
  { label: 'RRN', body: 'Rs.500 debited a/c XX1234. RRN 123456789012', expect: '123456789012' },
  { label: 'Txn ID alnum', body: 'Rs.500 spent card XX9999. Txn ID AB1234567', expect: 'AB1234567' },
  { label: 'UTR', body: 'Rs.500 debited. UTR 123456789012', expect: '123456789012' },
  { label: 'no reference', body: 'Rs.500 debited a/c XX1234 to SWIGGY', expect: null },
];

for (const sample of REFERENCE_SAMPLES) {
  const actual = extractReference(sample.body);
  check('reference', actual === sample.expect,
    `${sample.label}: expected ${sample.expect} but got ${actual}`);
  console.log(`  ${String(actual).padEnd(14)} ${sample.label}`);
}

// A bank SMS often quotes only a fragment of the UTR the statement carries.
check('reference', referencesMatch('123456789012', '789012'),
  'suffix fragment should match the full UTR');
check('reference', !referencesMatch('123456', '654321'),
  'unrelated references must not match');

console.log('\nRe-drain idempotency\n');
const capture = {
  id: 9, source: 'sms' as const, sender: 'HDFCBK',
  body: 'Rs.450.00 spent on HDFC Bank Card x1234 at SWIGGY on 12-08-25.',
  postedAt: new Date(2025, 7, 12, 13, 30, 0).getTime(),
};
check('idempotency',
  parseCapture(capture)?.dedupKey === parseCapture(capture)?.dedupKey,
  'same capture produced unstable key');
console.log(`  stable key: ${parseCapture(capture)?.dedupKey}`);

console.log(failures === 0 ? '\nAll assertions passed\n' : `\n${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
