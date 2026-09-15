import {
  EMPTY_FLOW,
  parseBalanceInput,
  projectBalance,
  projectBalanceWithPending,
  readingTakenAt,
  type BalanceFlow,
} from './balance';

let failures = 0;
const check = (label: string, condition: boolean, detail = '') => {
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  ${label} ${detail}`);
  }
};

const flow = (partial: Partial<BalanceFlow>): BalanceFlow => ({ ...EMPTY_FLOW, ...partial });

console.log('\nBalance projected from a reading\n');

check('a reading with nothing since stands as it is', projectBalance(4500000, EMPTY_FLOW) === 4500000);
check(
  'spending comes off',
  projectBalance(4500000, flow({ outflow: 120000 })) === 4380000,
  String(projectBalance(4500000, flow({ outflow: 120000 })))
);
check('money in goes on', projectBalance(4500000, flow({ inflow: 8000000 })) === 12500000);
check(
  'in and out settle against each other',
  projectBalance(4500000, flow({ inflow: 8000000, outflow: 120000 })) === 12380000
);

// A transfer to your own second account, an ATM withdrawal and a card bill are
// all the same money changing pots. Applying them would take it off a second
// time, after the spends they paid for were already counted.
check(
  'money that only changed pots leaves the balance alone',
  projectBalance(4500000, flow({ moved: 2000000 })) === 4500000
);

// An overdrawn account is a real state, and so is one that a forgotten income
// has not caught up with yet.
check('the balance may go negative', projectBalance(50000, flow({ outflow: 120000 })) === -70000);

console.log('\nUnreviewed rows\n');

const pending = flow({ outflow: 120000, pendingNet: -300000, pendingCount: 2 });
check('the headline ignores what has not been reviewed', projectBalance(4500000, pending) === 4380000);
check(
  'the second figure believes it',
  projectBalanceWithPending(4500000, pending) === 4080000,
  String(projectBalanceWithPending(4500000, pending))
);
check(
  'pending money arriving pushes the other way',
  projectBalanceWithPending(4500000, flow({ pendingNet: 250000 })) === 4750000
);

console.log('\nWhen a reading is true\n');

const now = new Date(2026, 8, 15, 15, 42, 30);

// Read off the bank app at lunchtime, the figure already has the morning's
// payments in it. Subtracting them again would report money you no longer have.
check(
  'a reading taken today is true as of this moment',
  readingTakenAt(new Date(2026, 8, 15), now) === now.getTime()
);
check(
  'the time of day the picker returns does not matter',
  readingTakenAt(new Date(2026, 8, 15, 0, 0, 0), now) === now.getTime()
);

// "I had ₹5,000 on the 7th" is a claim about the day, so the 7th's own spending
// still counts against it.
check(
  'a back-dated reading starts at the top of its day',
  readingTakenAt(new Date(2026, 8, 7, 18, 0, 0), now) === new Date(2026, 8, 7).getTime()
);
check(
  'a date in the future has no reading, so it falls back to now',
  readingTakenAt(new Date(2026, 8, 20), now) === now.getTime()
);

console.log('\nTyped amounts\n');

check('plain rupees', parseBalanceInput('45000') === 4500000);
check('paise are kept', parseBalanceInput('45000.75') === 4500075);
check('rounded to the paisa', parseBalanceInput('10.005') === 1001, String(parseBalanceInput('10.005')));
check('grouping separators are ignored', parseBalanceInput('45,000.50') === 4500050);
check('a rupee sign is ignored', parseBalanceInput('₹ 45,000') === 4500000);

// Unlike a transaction amount, zero and negative are both real balances.
check('an empty account is zero, not nothing', parseBalanceInput('0') === 0);
check('an overdraft is allowed', parseBalanceInput('-2500') === -250000);

check('an empty box is nothing', parseBalanceInput('') === null);
check('a lone minus is still being typed', parseBalanceInput('-') === null);
check('words are refused', parseBalanceInput('abc') === null);

console.log(failures === 0 ? '\nAll assertions passed\n' : `\n${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
