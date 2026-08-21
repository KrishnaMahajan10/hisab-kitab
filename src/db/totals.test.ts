import {
  CATEGORIES,
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  isIncomeCategory,
  isMoneyMoved,
  MONEY_MOVED_CATEGORIES,
} from './schema';

let failures = 0;
const check = (label: string, condition: boolean, detail = '') => {
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  ${label} ${detail}`);
  }
};

console.log('\nMoney moved rather than spent\n');

// A typo here would silently stop excluding the category from every total, with
// nothing on screen to show it had stopped working.
for (const category of MONEY_MOVED_CATEGORIES) {
  check(`"${category}" is a real category`, CATEGORIES.includes(category), 'not in CATEGORIES');
  check(`"${category}" is offered on the expense side`, EXPENSE_CATEGORIES.includes(category));
  check(`"${category}" is recognised as moved`, isMoneyMoved(category));
}
console.log('  ' + MONEY_MOVED_CATEGORIES.join('  ·  '));

console.log('\nCategories that must still count\n');

const MUST_COUNT = [
  'Food & Dining',
  'Groceries',
  'Rent',
  'Fuel',
  'Investments',
  'Salary',
  'Other',
  'Other Income',
];
for (const category of MUST_COUNT) {
  check(`"${category}" still counts`, !isMoneyMoved(category));
}
console.log('  ' + MUST_COUNT.join('  ·  '));

check('an unknown category counts', !isMoneyMoved('Something New'));
check('the check is case sensitive, matching stored values', !isMoneyMoved('transfers'));

// Transfers exists on both sides: the debit leg leaves one account and the
// credit leg lands in the other, and both must drop out of the totals.
check('Transfers is offered as income too', INCOME_CATEGORIES.includes('Transfers'));
check('Transfers reads as income', isIncomeCategory('Transfers'));
check('the credit leg is excluded as well', isMoneyMoved('Transfers'));

// Investments is the deliberate exception: buying a fund is money leaving, and
// it stays in the spending total until asked otherwise.
check('Investments is not treated as moved', !isMoneyMoved('Investments'));

console.log(failures === 0 ? '\nAll assertions passed\n' : `\n${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
