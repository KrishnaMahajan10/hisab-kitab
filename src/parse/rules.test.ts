import {
  categoryFromRules,
  orderRules,
  ruleMatches,
  suggestCategory,
  type CategoryRule,
  type RuleSubject,
} from './categorize';

let failures = 0;
const check = (label: string, condition: boolean, detail = '') => {
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  ${label} ${detail}`);
  }
};

let nextId = 1;
const rule = (over: Partial<CategoryRule> = {}): CategoryRule => ({
  id: nextId++,
  pattern: 'swiggy',
  category: 'Food & Dining',
  field: 'any',
  matchType: 'contains',
  direction: null,
  minPaise: null,
  maxPaise: null,
  priority: 100,
  enabled: true,
  origin: 'manual',
  hits: 0,
  ...over,
});

const txn = (over: Partial<RuleSubject> = {}): RuleSubject => ({
  merchant: 'Swiggy',
  title: null,
  note: null,
  rawText: 'Rs.450 spent on card x1234 at SWIGGY',
  direction: 'debit',
  amountPaise: 45000,
  ...over,
});

console.log('\nHow a pattern is matched\n');

check('contains matches anywhere', ruleMatches(rule(), txn()));
check('matching ignores case', ruleMatches(rule({ pattern: 'SWIGGY' }), txn()));
check('a word that is absent does not match', !ruleMatches(rule({ pattern: 'blinkit' }), txn()));

check(
  'starts_with is anchored to the front',
  ruleMatches(rule({ field: 'merchant', matchType: 'starts_with', pattern: 'swi' }), txn())
);
check(
  'starts_with rejects a middle match',
  !ruleMatches(rule({ field: 'merchant', matchType: 'starts_with', pattern: 'iggy' }), txn())
);
check(
  'ends_with is anchored to the end',
  ruleMatches(rule({ field: 'merchant', matchType: 'ends_with', pattern: 'iggy' }), txn())
);
check(
  'equals needs the whole field',
  ruleMatches(rule({ field: 'merchant', matchType: 'equals', pattern: 'swiggy' }), txn())
);
check(
  'equals rejects a partial field',
  !ruleMatches(rule({ field: 'merchant', matchType: 'equals', pattern: 'swig' }), txn())
);
check(
  'regex matches',
  ruleMatches(rule({ matchType: 'regex', pattern: 'swi(ggy|rl)' }), txn())
);
check(
  'regex is case-insensitive like the rest',
  ruleMatches(rule({ matchType: 'regex', pattern: 'SWI(GGY|RL)' }), txn())
);
check(
  'regex can anchor to the field it is given',
  ruleMatches(rule({ field: 'merchant', matchType: 'regex', pattern: '^swiggy$' }), txn())
);

// A half-typed regex must not take categorisation down with it.
check(
  'a broken regex simply does not match',
  !ruleMatches(rule({ matchType: 'regex', pattern: 'swiggy(' }), txn())
);
check('an empty pattern never matches', !ruleMatches(rule({ pattern: '' }), txn()));

console.log('\nWhich field is searched\n');

const noted = txn({ merchant: null, note: 'lunch with swiggy voucher', rawText: '' });
check('the note is searched when asked for', ruleMatches(rule({ field: 'note' }), noted));
check('the merchant field ignores the note', !ruleMatches(rule({ field: 'merchant' }), noted));
check('any searches everything', ruleMatches(rule({ field: 'any' }), noted));

const titled = txn({ merchant: 'PAYTMQR283', title: 'Monthly rent', rawText: '' });
check(
  'a hand-written title is searched',
  ruleMatches(rule({ field: 'title', pattern: 'rent', category: 'Rent' }), titled)
);
// The title is what the user chose to call it, so it must outrank the bank's
// text when they wrote a rule against it.
check(
  'any also sees the title',
  ruleMatches(rule({ field: 'any', pattern: 'monthly rent' }), titled)
);

console.log('\nDirection and amount conditions\n');

check('a debit rule matches a debit', ruleMatches(rule({ direction: 'debit' }), txn()));
check(
  'a debit rule does not match a credit',
  !ruleMatches(rule({ direction: 'debit' }), txn({ direction: 'credit' }))
);
check('no direction set matches both', ruleMatches(rule(), txn({ direction: 'credit' })));

check('an amount above the floor matches', ruleMatches(rule({ minPaise: 40000 }), txn()));
check('an amount below the floor does not', !ruleMatches(rule({ minPaise: 50000 }), txn()));
check('an amount below the ceiling matches', ruleMatches(rule({ maxPaise: 50000 }), txn()));
check('an amount above the ceiling does not', !ruleMatches(rule({ maxPaise: 40000 }), txn()));
check(
  'a band matches inside it',
  ruleMatches(rule({ minPaise: 40000, maxPaise: 50000 }), txn())
);
check(
  'the bounds are inclusive',
  ruleMatches(rule({ minPaise: 45000, maxPaise: 45000 }), txn())
);

// The point of amount bounds: one word, two meanings depending on the size.
const transfer = txn({ merchant: 'ASHOK CHHA', rawText: 'UPI/ASHOK CHHA/9422761991@ibl' });
const rentRule = rule({ pattern: 'ashok', category: 'Rent', minPaise: 100000 });
const giftRule = rule({ pattern: 'ashok', category: 'Gifts & Donations', maxPaise: 99999 });
check(
  'a large payment reads as rent',
  categoryFromRules([rentRule, giftRule], { ...transfer, amountPaise: 200000 })?.category === 'Rent'
);
check(
  'a small payment to the same person reads as a gift',
  categoryFromRules([rentRule, giftRule], { ...transfer, amountPaise: 50000 })?.category ===
    'Gifts & Donations'
);

console.log('\nDisabled rules\n');

check('a disabled rule never matches', !ruleMatches(rule({ enabled: false }), txn()));
check(
  'a disabled rule is skipped in favour of the next',
  categoryFromRules(
    [rule({ enabled: false, category: 'Shopping' }), rule({ category: 'Food & Dining' })],
    txn()
  )?.category === 'Food & Dining'
);

console.log('\nWhich rule wins\n');

const low = rule({ priority: 1, category: 'Rent' });
const high = rule({ priority: 900, category: 'Shopping' });
check('the lower priority number wins', categoryFromRules([high, low], txn())?.category === 'Rent');
check('order in the array does not decide it', categoryFromRules([low, high], txn())?.category === 'Rent');

const learned = rule({ origin: 'learned', category: 'Shopping', hits: 99 });
const manual = rule({ origin: 'manual', category: 'Rent', hits: 0 });
// The learned rule is the app's guess; the hand-written one is the correction.
check(
  'at equal priority a hand-written rule beats a learned one',
  categoryFromRules([learned, manual], txn())?.category === 'Rent'
);

const seenOften = rule({ origin: 'learned', category: 'Rent', hits: 50 });
const seenOnce = rule({ origin: 'learned', category: 'Shopping', hits: 1 });
check(
  'between learned rules the better-used one wins',
  categoryFromRules([seenOnce, seenOften], txn())?.category === 'Rent'
);

const ordered = orderRules([high, low, manual]);
check('ordering is stable and puts priority first', ordered[0].priority === 1);
check('no rules means no match', categoryFromRules([], txn()) === null);
check('no matching rule means no match', categoryFromRules([rule({ pattern: 'zzz' })], txn()) === null);

console.log('\nRules against the built-in keywords\n');

// A rule must beat the keyword list, which is the whole reason to write one.
check(
  'a rule overrides a built-in keyword',
  suggestCategory('Swiggy', 'paid at SWIGGY', 'debit', [
    rule({ pattern: 'swiggy', category: 'Entertainment' }),
  ]) === 'Entertainment'
);
check(
  'the keyword list still applies when no rule matches',
  suggestCategory('Swiggy', 'paid at SWIGGY', 'debit', [rule({ pattern: 'zzz' })]) ===
    'Food & Dining'
);
check(
  'with no rules at all the keywords decide',
  suggestCategory('Blinkit', 'paid at BLINKIT', 'debit', []) === 'Groceries'
);
check(
  'an unmatched debit falls back to Other',
  suggestCategory('Nobody', 'paid at NOBODY', 'debit', []) === 'Other'
);
check(
  'an unmatched credit falls back to Other Income',
  suggestCategory('Nobody', 'received from NOBODY', 'credit', []) === 'Other Income'
);

// Amount conditions only work if the amount reaches the matcher.
check(
  'suggestCategory passes the amount through to the rules',
  suggestCategory('Ashok', 'UPI/ASHOK', 'debit', [rule({ pattern: 'ashok', category: 'Rent', minPaise: 100000 })], {
    amountPaise: 200000,
  }) === 'Rent'
);
check(
  'an amount below the floor falls through to the keywords',
  suggestCategory('Ashok', 'UPI/ASHOK', 'debit', [rule({ pattern: 'ashok', category: 'Rent', minPaise: 100000 })], {
    amountPaise: 5000,
  }) === 'Other'
);
check(
  'suggestCategory passes the title through',
  suggestCategory('PAYTMQR283', 'UPI/PAYTMQR283', 'debit', [
    rule({ field: 'title', pattern: 'rent', category: 'Rent' }),
  ], { title: 'Monthly rent' }) === 'Rent'
);

console.log(failures === 0 ? '\nAll assertions passed\n' : `\n${failures} assertion(s) failed\n`);
process.exit(failures === 0 ? 0 : 1);
