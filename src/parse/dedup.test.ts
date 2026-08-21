import {
  CROSS_SOURCE_WINDOW_MS,
  extractReference,
  isSamePayment,
  isSelfTransfer,
  merchantsMatch,
  parseCapture,
  NEAR_DUPLICATE_WINDOW_MS,
  referencesMatch,
} from './parse';

let failures = 0;
const check = (label: string, condition: boolean, detail = '') => {
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  ${label} ${detail}`);
  }
};

console.log('\nReference extraction from bank SMS\n');

const REF_SAMPLES: Array<{ body: string; expect: string | null }> = [
  {
    body: 'INR 1,200.00 debited from A/c XX4321 on 12-Aug-25. Info: UPI/523401/ZOMATO.',
    expect: '523401',
  },
  {
    body: 'Rs.500 debited from A/c X8899 on 12/08/25 transfer to BLINKIT Ref 402214 -SBI',
    expect: '402214',
  },
  {
    body: 'Rs.450 spent on card x1234 at SWIGGY. RRN: 585204261401',
    expect: '585204261401',
  },
  {
    body: 'Rs.99 debited. UTR No. 180129513492',
    expect: '180129513492',
  },
  {
    body: 'Rs.100 paid. Transaction ID T2608192051120944645731',
    expect: 'T2608192051120944645731',
  },
  {
    body: 'Rs.75 spent at LOCAL SHOP on 12-08-25',
    expect: null,
  },
];

for (const sample of REF_SAMPLES) {
  const got = extractReference(sample.body);
  check(`ref "${sample.expect}"`, got === sample.expect, `got "${got}"`);
  console.log(`  ${String(got).padEnd(24)} <- ${sample.body.slice(0, 58)}`);
}

console.log('\nReference matching across sources\n');

const REF_PAIRS: Array<{ a: string | null; b: string | null; expect: boolean; why: string }> = [
  { a: '585204261401', b: '585204261401', expect: true, why: 'identical UTR' },
  { a: '523401', b: '523401987654', expect: true, why: 'SMS fragment is prefix of UTR' },
  { a: '261401', b: '585204261401', expect: true, why: 'SMS fragment is suffix of UTR' },
  { a: '12345', b: '123456789012', expect: false, why: 'below 6-char floor' },
  { a: '999999', b: '585204261401', expect: false, why: 'unrelated references' },
  { a: null, b: '585204261401', expect: false, why: 'one side missing' },
  { a: 'T260819205112', b: 't260819205112', expect: true, why: 'case insensitive' },
];

for (const pair of REF_PAIRS) {
  const got = referencesMatch(pair.a, pair.b);
  check(`refMatch ${pair.why}`, got === pair.expect, `got ${got}`);
  console.log(`  ${got ? 'match   ' : 'no match'}  ${pair.a} / ${pair.b}  (${pair.why})`);
}

console.log('\nMerchant matching across sources\n');

const MERCHANT_PAIRS: Array<{ a: string; b: string; expect: boolean; why: string }> = [
  { a: 'swiggy', b: 'swiggy', expect: true, why: 'identical' },
  { a: 'swiggy', b: 'swiggylimited', expect: true, why: 'SMS name inside statement name' },
  { a: 'zomatoltd', b: 'zomato', expect: true, why: 'statement name contains SMS name' },
  { a: 'dad', b: 'dadar', expect: false, why: 'short name below floor must not collide' },
  { a: 'swiggy', b: 'zomato', expect: false, why: 'different payees' },
  { a: 'premjimithaiwale', b: 'premji', expect: true, why: 'shortened payee' },
  { a: 'amazon', b: 'amazonpay', expect: true, why: 'amazon vs amazon pay' },
];

for (const pair of MERCHANT_PAIRS) {
  const got = merchantsMatch(pair.a, pair.b);
  check(`merchantMatch ${pair.why}`, got === pair.expect, `got ${got}`);
  console.log(`  ${got ? 'match   ' : 'no match'}  ${pair.a} / ${pair.b}  (${pair.why})`);
}

console.log('\nOver-dedup guards (these must NOT collapse)\n');

check(
  'two ₹60 payments to different vendors stay separate',
  !merchantsMatch('sarthfreshmart', 'bhosaleanitapapu'),
  'different vendors matched'
);
check(
  'unrelated 6-digit refs stay separate',
  !referencesMatch('402214', '523401'),
  'unrelated refs matched'
);
console.log('  sarthfreshmart / bhosaleanitapapu -> separate');
console.log('  402214 / 523401 -> separate');

console.log('\nSame payment seen from two sources\n');

const NOON = new Date(2026, 7, 20, 12, 0).getTime();
const MINUTE = 60 * 1000;

// A PhonePe statement row with no clock time lands at a different hour than the
// bank SMS that reported the same payment. That pair must still collapse.
const statementRow = { occurredAt: NOON, merchantIdentity: 'swiggylimited', origin: 'statement' as const };
const smsSameDay = { occurredAt: NOON + 7 * 60 * MINUTE, merchantIdentity: 'swiggy', origin: 'sms' as const };
check('statement and SMS hours apart are one payment', isSamePayment(statementRow, smsSameDay));
check('the match is symmetric', isSamePayment(smsSameDay, statementRow));

// The bug this guards: before the cross-source window, the SMS drain used only
// the 10 minute window and queued an already-imported payment for review again.
check('a 7 hour gap is outside the tight window', 7 * 60 * MINUTE > NEAR_DUPLICATE_WINDOW_MS);
check('a 7 hour gap is inside the cross-source window', 7 * 60 * MINUTE < CROSS_SOURCE_WINDOW_MS);

check('beyond the cross-source window they are separate',
  !isSamePayment(statementRow, { ...smsSameDay, occurredAt: NOON + 13 * 60 * MINUTE }));

console.log('\nRepeat payments within one source stay separate\n');

// Two chai payments to the same shop on the same day are two payments. Widening
// the window across sources must never widen it within one source.
const morningChai = { occurredAt: NOON, merchantIdentity: 'chaipoint', origin: 'sms' as const };
const eveningChai = { occurredAt: NOON + 6 * 60 * MINUTE, merchantIdentity: 'chaipoint', origin: 'sms' as const };
check('two same-day SMS payments to one shop are separate', !isSamePayment(morningChai, eveningChai));
check('two same-day statement rows are separate',
  !isSamePayment({ ...morningChai, origin: 'statement' }, { ...eveningChai, origin: 'statement' }));
check('within the tight window the same source still collapses',
  isSamePayment(morningChai, { ...eveningChai, occurredAt: NOON + 3 * MINUTE }));

console.log('\nA merchant is required outside the tight window\n');

check('no merchant on the stored row means no cross-source match',
  !isSamePayment({ ...statementRow, merchantIdentity: null }, smsSameDay));
check('no merchant on the incoming row means no cross-source match',
  !isSamePayment(statementRow, { ...smsSameDay, merchantIdentity: null }));
check('a different merchant is not a match',
  !isSamePayment(statementRow, { ...smsSameDay, merchantIdentity: 'blinkit' }));

// Inside the tight window a missing merchant is tolerated: the amount, the
// direction and the clock already agree.
check('a missing merchant is tolerated inside the tight window',
  isSamePayment({ ...morningChai, merchantIdentity: null }, { ...morningChai, occurredAt: NOON + 2 * MINUTE }));
check('an exact timestamp collision is a match even with no merchants',
  isSamePayment({ occurredAt: NOON, merchantIdentity: null, origin: 'statement' },
         { occurredAt: NOON, merchantIdentity: null, origin: 'sms' }, 0));

console.log('\nNotification and SMS for one payment\n');

check('a payment app notification matches the bank SMS',
  isSamePayment({ occurredAt: NOON, merchantIdentity: 'zomato', origin: 'notification' },
                { occurredAt: NOON + 90 * MINUTE, merchantIdentity: 'zomato', origin: 'sms' }));

console.log('\nSelf-transfer between two of your own accounts\n');

const capture = (body: string) => ({
  id: 1,
  source: 'sms' as const,
  sender: 'HDFCBK',
  body,
  postedAt: new Date(2026, 7, 20, 12, 0).getTime(),
});

const TRANSFER_SAMPLES: Array<{ body: string; expect: string[] }> = [
  {
    body: 'Rs.20000 debited from A/c XX1234 and credited to A/c XX5678 on 20-Aug-25. UPI/523401',
    expect: ['1234', '5678'],
  },
  {
    body: 'INR 5,000.00 transferred from your Account XX9911 to Account XX2200 -HDFC Bank',
    expect: ['9911', '2200'],
  },
  {
    body: 'Rs.450 spent on card xx1234 at SWIGGY on 20-Aug-25',
    expect: ['1234'],
  },
  {
    body: 'Rs.75 paid to LOCAL SHOP on 20-Aug-25',
    expect: [],
  },
];

for (const sample of TRANSFER_SAMPLES) {
  const parsed = parseCapture(capture(sample.body));
  const actual = parsed?.allLast4 ?? [];
  check(
    `finds [${sample.expect.join(', ')}]`,
    actual.length === sample.expect.length && actual.every((v, i) => v === sample.expect[i]),
    `-> [${actual.join(', ')}]`
  );
  console.log(`  [${actual.join(', ')}]  <-  ${sample.body.slice(0, 58)}`);
}

const both = parseCapture(capture(TRANSFER_SAMPLES[0].body))!;
check('the primary last4 is still the debited account', both.last4 === '1234', String(both.last4));
check('the numbers come back in the order written', both.allLast4[0] === '1234');
check('the primary is included in the full list', both.allLast4.includes(both.last4!));

// The same number written twice is one account, not a transfer.
const repeated = parseCapture(capture('Rs.100 debited from A/c XX1234. A/c XX1234 balance is Rs.900'))!;
check('a repeated number is not counted twice', repeated.allLast4.length === 1, `[${repeated.allLast4.join(', ')}]`);

console.log('\nDeciding whether a transfer is yours\n');

const mine = new Set(['1234', '5678']);
check('both accounts yours is a self-transfer', isSelfTransfer(['1234', '5678'], mine));
check('order does not matter', isSelfTransfer(['5678', '1234'], mine));
check('paying a stranger is not a self-transfer', !isSelfTransfer(['1234', '9999'], mine));
check('one account only is not a self-transfer', !isSelfTransfer(['1234'], mine));
check('no accounts named is not a self-transfer', !isSelfTransfer([], mine));
check('neither account yours is not a self-transfer', !isSelfTransfer(['4444', '9999'], mine));
check('a third number does not spoil the match', isSelfTransfer(['1234', '9999', '5678'], mine));
check('an empty account list never matches', !isSelfTransfer(['1234', '5678'], new Set<string>()));

// The whole point: the wording says nothing, the account numbers say everything.
const disguised = parseCapture(capture('Rs.30000 debited from A/c XX1234 credited to A/c XX5678 via UPI'))!;
check('a UPI self-transfer is caught with no NEFT or IMPS wording',
  isSelfTransfer(disguised.allLast4, mine));
const toFriend = parseCapture(capture('Rs.30000 debited from A/c XX1234 credited to A/c XX7777 via IMPS'))!;
check('IMPS wording alone does not make it yours',
  !isSelfTransfer(toFriend.allLast4, mine));

console.log(failures === 0 ? '\nAll assertions passed\n' : `\n${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
