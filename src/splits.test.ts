import {
  evenShares,
  myShareOf,
  outstandingBalances,
  splitEvenlyWithMe,
  totalOutstanding,
  type SplitRow,
  sharesTotal,
  toggleSharePerson,
  type Shares,
} from './splits';

let failures = 0;
const check = (label: string, condition: boolean, detail = '') => {
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  ${label} ${detail}`);
  }
};

const sum = (values: readonly number[]) => values.reduce((total, value) => total + value, 0);

console.log('\nSplitting an amount that does not divide evenly\n');

const CASES: Array<{ amount: number; parts: number }> = [
  { amount: 100000, parts: 3 },
  { amount: 100000, parts: 7 },
  { amount: 120000, parts: 4 },
  { amount: 1, parts: 3 },
  { amount: 99999, parts: 6 },
  { amount: 45000, parts: 2 },
  { amount: 33333, parts: 33333 },
];

for (const testCase of CASES) {
  const shares = evenShares(testCase.amount, testCase.parts);
  // The only rule that really matters: nothing is lost and nothing is invented.
  check(
    `${testCase.amount}p over ${testCase.parts} adds back up`,
    sum(shares) === testCase.amount,
    `${sum(shares)} != ${testCase.amount}`
  );
  check(`${testCase.amount}p over ${testCase.parts} gives every part a share`, shares.length === testCase.parts);
  check(
    `${testCase.amount}p over ${testCase.parts} never differs by more than a paisa`,
    Math.max(...shares) - Math.min(...shares) <= 1,
    `${Math.min(...shares)}..${Math.max(...shares)}`
  );
  check(`${testCase.amount}p over ${testCase.parts} has no empty share`, shares.every((share) => share > 0) || testCase.amount < testCase.parts);
}

const thirds = evenShares(100000, 3);
console.log(`  ₹1000 in three: ${thirds.join(', ')} paise`);
check('the extra paisa goes to the first share', thirds[0] === 33334 && thirds[1] === 33333);

check('zero parts gives nothing', evenShares(1000, 0).length === 0);
check('a zero amount gives nothing', evenShares(0, 3).length === 0);
check('a negative amount gives nothing', evenShares(-500, 3).length === 0);

console.log('\nA bill shared with friends\n');

// ₹1200 dinner, you and three friends.
const dinner = splitEvenlyWithMe(120000, [1, 2, 3]);
check('one entry per friend, not per person', dinner.length === 3, String(dinner.length));
check('each friend owes a quarter', dinner.every((share) => share.amountPaise === 30000));
check('your own share is not recorded as a debt', sum(dinner.map((s) => s.amountPaise)) === 90000);

// ₹1000 between you and two friends: 333.34 / 333.33 / 333.33.
const uneven = splitEvenlyWithMe(100000, [1, 2]);
const theirTotal = sum(uneven.map((share) => share.amountPaise));
check('friends are not charged the rounding remainder', theirTotal === 66666, String(theirTotal));
check('you absorb the spare paisa', 100000 - theirTotal === 33334, String(100000 - theirTotal));
console.log(`  ₹1000 with two friends: they owe ${theirTotal}p, you spent ${100000 - theirTotal}p`);

check('no friends means no split', splitEvenlyWithMe(50000, []).length === 0);

console.log('\nWhat you actually spent\n');

const split = (over: Partial<SplitRow> = {}): SplitRow => ({
  personId: 1,
  amountPaise: 30000,
  direction: 'owed_to_me',
  settled: false,
  ...over,
});

check('your share is the bill minus what you fronted', myShareOf(120000, [split(), split({ personId: 2 }), split({ personId: 3 })]) === 30000);
// Being paid back does not turn a loan into an expense after the fact.
check(
  'a settled split still comes off your spending',
  myShareOf(120000, [split({ settled: true }), split({ personId: 2, settled: true })]) === 60000
);
check('no splits means you spent the lot', myShareOf(120000, []) === 120000);
// A share someone else fronted for you is your expense, so it must not reduce it.
check('money you owe does not reduce your spending', myShareOf(30000, [split({ direction: 'i_owe' })]) === 30000);
check('a split cannot push spending below zero', myShareOf(30000, [split({ amountPaise: 50000 })]) === 0);

console.log('\nWho owes whom\n');

const ledger: SplitRow[] = [
  split({ personId: 1, amountPaise: 30000 }),
  split({ personId: 1, amountPaise: 20000 }),
  split({ personId: 2, amountPaise: 45000 }),
  split({ personId: 3, amountPaise: 10000, direction: 'i_owe' }),
  // Already paid back, so it should not appear at all.
  split({ personId: 4, amountPaise: 99900, settled: true }),
];

const balances = outstandingBalances(ledger);
check('settled debts drop out', !balances.some((balance) => balance.personId === 4));
check('two debts to one person add up', balances.find((b) => b.personId === 1)?.netPaise === 50000);
check('what you owe is negative', balances.find((b) => b.personId === 3)?.netPaise === -10000);
check('the largest debt comes first', balances[0].personId === 1, String(balances[0].personId));
console.log('  ' + balances.map((b) => `person ${b.personId}: ${b.netPaise}p`).join(', '));

// Lending someone ₹500 and borrowing ₹500 back leaves nothing owed either way.
const square = outstandingBalances([
  split({ personId: 9, amountPaise: 50000 }),
  split({ personId: 9, amountPaise: 50000, direction: 'i_owe' }),
]);
check('someone square disappears rather than showing zero', square.length === 0);

const totals = totalOutstanding(ledger);
check('owed to you is summed', totals.owedToMe === 95000, String(totals.owedToMe));
check('what you owe is summed separately', totals.iOwe === 10000, String(totals.iOwe));
check('the two are never mixed', totals.owedToMe !== totals.iOwe);
check('an empty ledger owes nothing', totalOutstanding([]).owedToMe === 0);

console.log('\nAdding and removing people from a split\n');

// ₹1200 dinner. Adding friends one at a time must always leave the shares
// adding up, not just the first time.
let live: Shares = {};
live = toggleSharePerson(live, 1, 120000);
check('one friend takes half', live[1] === 60000, String(live[1]));

live = toggleSharePerson(live, 2, 120000);
check('adding a second re-divides rather than shrinking the first',
  live[1] === 40000 && live[2] === 40000, JSON.stringify(live));

live = toggleSharePerson(live, 3, 120000);
check('three friends take a quarter each', sharesTotal(live) === 90000, String(sharesTotal(live)));
check('your share is the remaining quarter', 120000 - sharesTotal(live) === 30000);

live = toggleSharePerson(live, 2, 120000);
check('removing someone drops them', !(2 in live), JSON.stringify(live));
check('and re-divides between who is left', live[1] === 40000 && live[3] === 40000);

live = toggleSharePerson(live, 1, 120000);
live = toggleSharePerson(live, 3, 120000);
check('removing everyone leaves no split', sharesTotal(live) === 0);

// Editing the amount after splitting must not leave shares that overshoot it.
const rescaled = toggleSharePerson(toggleSharePerson({}, 1, 120000), 2, 60000);
check('a changed amount re-divides against the new total',
  sharesTotal(rescaled) <= 60000, String(sharesTotal(rescaled)));

// Selecting someone before typing an amount must not create an empty share:
// replaceSplits would try to store it and the amount check would reject it.
const premature = toggleSharePerson({}, 1, 0);
check('a zero amount produces no shares', Object.keys(premature).length === 0, JSON.stringify(premature));
check('and no NaN total', sharesTotal(premature) === 0, String(sharesTotal(premature)));

console.log(failures === 0 ? '\nAll assertions passed\n' : `\n${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
