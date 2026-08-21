import { isIncomeCategory, type Category } from '../db/schema';

const KEYWORD_MAP: Array<{ category: Category; keywords: string[] }> = [
  {
    category: 'Food & Dining',
    keywords: [
      'swiggy', 'zomato', 'dominos', 'pizza', 'mcdonald', 'kfc', 'burger',
      'starbucks', 'cafe', 'coffee', 'restaurant', 'dhaba', 'eatsure', 'faasos',
      'behrouz', 'biryani', 'chaayos', 'barbeque', 'bakery', 'sweets', 'juice',
      'eatfit', 'box8', 'wow momo', 'haldiram',
    ],
  },
  {
    category: 'Groceries',
    keywords: [
      'blinkit', 'zepto', 'bigbasket', 'dmart', 'd-mart', 'instamart', 'grofers',
      'reliance fresh', 'more retail', 'kirana', 'supermarket', 'jiomart',
      'licious', 'country delight', 'milk', 'dairy', 'vegetable', 'sabzi',
      'spencers', 'star bazaar',
    ],
  },
  {
    category: 'Fuel',
    keywords: [
      'petrol', 'diesel', 'fuel', 'hpcl', 'iocl', 'bpcl', 'shell', 'indian oil',
      'hp petrol', 'bharat petroleum', 'nayara', 'jio-bp',
    ],
  },
  {
    category: 'Transport',
    keywords: [
      'uber', 'ola', 'rapido', 'yulu', 'blusmart', 'metro', 'dmrc', 'bmtc',
      'parking', 'toll', 'fastag', 'auto', 'cab', 'bounce', 'quick ride',
    ],
  },
  {
    category: 'Travel',
    keywords: [
      'irctc', 'redbus', 'indigo', 'air india', 'vistara', 'spicejet', 'akasa',
      'makemytrip', 'goibibo', 'yatra', 'cleartrip', 'ixigo', 'oyo', 'airbnb',
      'booking.com', 'agoda', 'railway', 'abhibus', 'easemytrip',
    ],
  },
  {
    category: 'Clothing',
    keywords: [
      'myntra', 'ajio', 'zudio', 'westside', 'lifestyle', 'shoppers stop',
      'pantaloons', 'max fashion', 'h&m', 'zara', 'uniqlo', 'levis', 'bata',
      'urbanic', 'snitch', 'nike', 'adidas', 'puma', 'skechers',
    ],
  },
  {
    category: 'Electronics',
    keywords: [
      'croma', 'reliance digital', 'vijay sales', 'apple store', 'oneplus',
      'samsung', 'boat', 'noise', 'dell', 'lenovo', 'hp store', 'jbl',
    ],
  },
  {
    category: 'Shopping',
    keywords: [
      'amazon', 'flipkart', 'meesho', 'tatacliq', 'tata cliq', 'nykaa',
      'decathlon', 'lenskart', 'ikea', 'pepperfry', 'urban ladder', 'firstcry',
      'snapdeal', 'jiomart shopping',
    ],
  },
  {
    category: 'Mobile & Internet',
    keywords: [
      'airtel', 'jio', 'vodafone', 'vi recharge', 'bsnl', 'act fibernet',
      'hathway', 'excitel', 'broadband', 'recharge', 'mobile bill', 'postpaid',
      'prepaid',
    ],
  },
  {
    category: 'Bills & Utilities',
    keywords: [
      'electricity', 'mseb', 'msedcl', 'adani electricity', 'tata power',
      'bescom', 'torrent power', 'gas bill', 'mahanagar gas', 'indane',
      'water bill', 'municipal', 'dth', 'tatasky', 'tata play', 'dish tv',
      'bill payment', 'bbps',
    ],
  },
  {
    category: 'Rent',
    keywords: ['rent', 'nobroker', 'landlord', 'house rent', 'pg rent', 'lease'],
  },
  {
    category: 'Household',
    keywords: [
      'maintenance', 'society', 'plumber', 'electrician', 'carpenter', 'repair',
      'urban company', 'urbanclap', 'housejoy', 'pest control', 'laundry',
    ],
  },
  {
    category: 'Domestic Help',
    keywords: ['maid', 'cook', 'househelp', 'house help', 'driver salary', 'nanny', 'bai'],
  },
  {
    category: 'Fitness',
    keywords: ['cult', 'cultfit', 'gym', 'fitness', 'anytime fitness', 'gold gym', 'yoga', 'zumba'],
  },
  {
    category: 'Personal Care',
    keywords: [
      'salon', 'barber', 'spa', 'lakme', 'naturals', 'jawed habib', 'grooming',
      'beardo', 'mamaearth', 'purplle',
    ],
  },
  {
    category: 'Health',
    keywords: [
      'pharmeasy', 'apollo', 'netmeds', '1mg', 'tata 1mg', 'medplus',
      'hospital', 'clinic', 'diagnostic', 'thyrocare', 'dr lal', 'pharmacy',
      'practo', 'medical', 'dentist', 'lab test', 'healthians',
    ],
  },
  {
    category: 'Education',
    keywords: [
      'udemy', 'coursera', 'byju', 'unacademy', 'vedantu', 'upgrad', 'physics wallah',
      'school fee', 'college', 'university', 'tuition', 'exam fee', 'coaching',
      'skillshare', 'pluralsight',
    ],
  },
  {
    category: 'Kids & Family',
    keywords: ['firstcry', 'toys', 'daycare', 'creche', 'hamleys', 'kids', 'baby', 'diaper'],
  },
  {
    category: 'Pets',
    keywords: ['pet', 'heads up for tails', 'supertails', 'vet', 'dog food', 'cat food'],
  },
  {
    category: 'Subscriptions',
    keywords: [
      'netflix', 'prime video', 'amazon prime', 'hotstar', 'jiocinema', 'sonyliv',
      'zee5', 'spotify', 'youtube premium', 'apple music', 'gaana', 'wynk',
      'icloud', 'google one', 'dropbox', 'notion', 'chatgpt', 'openai', 'claude',
      'adobe', 'microsoft 365', 'canva', 'github',
    ],
  },
  {
    category: 'Entertainment',
    keywords: [
      'bookmyshow', 'pvr', 'inox', 'cinepolis', 'cinema', 'movie', 'steam',
      'playstation', 'xbox', 'nintendo', 'dream11', 'gaming',
    ],
  },
  {
    category: 'Insurance',
    keywords: [
      'insurance', 'lic ', 'policybazaar', 'hdfc life', 'icici pru', 'max life',
      'star health', 'niva bupa', 'acko', 'digit', 'premium due', 'term plan',
    ],
  },
  {
    category: 'Loan & EMI',
    keywords: [
      'emi', 'loan', 'home loan', 'car loan', 'personal loan', 'bajaj finserv',
      'installment', 'instalment', 'nach debit', 'ecs debit',
    ],
  },
  {
    category: 'Credit Card Payment',
    keywords: [
      'credit card payment', 'card payment', 'cred', 'billdesk cc', 'cc payment',
      'creditcard bill',
    ],
  },
  {
    category: 'Taxes & Fees',
    keywords: ['income tax', 'gst', 'tds', 'advance tax', 'challan', 'stamp duty', 'traffic fine'],
  },
  {
    category: 'Bank Charges',
    keywords: [
      'service charge', 'annual fee', 'late fee', 'penalty', 'convenience fee',
      'processing fee', 'gst on', 'amc charge', 'sms charge',
    ],
  },
  {
    category: 'Gifts & Donations',
    keywords: ['donation', 'temple', 'charity', 'ngo', 'gift', 'giveindia', 'akshaya patra'],
  },
  {
    category: 'Cash Withdrawal',
    keywords: ['atm', 'cash withdrawal', 'cash wdl', 'atw ', 'nfs cash'],
  },
  {
    category: 'Investments',
    keywords: [
      'zerodha', 'groww', 'upstox', 'angel one', 'kuvera', 'mutual fund', 'sip',
      'nps', 'ppf', 'etmoney', 'smallcase', 'indmoney', 'paytm money', 'coin',
      'nifty', 'demat', 'sovereign gold',
    ],
  },
  {
    category: 'Salary',
    keywords: ['salary', 'payroll', 'sal cr', 'stipend', 'wages', 'neft salary'],
  },
  {
    category: 'Freelance',
    keywords: ['freelance', 'consulting', 'contract payment', 'upwork', 'fiverr', 'invoice paid'],
  },
  {
    category: 'Interest & Dividends',
    keywords: ['interest', 'int cr', 'dividend', 'fd interest', 'savings interest', 'coupon'],
  },
  {
    category: 'Refunds & Cashback',
    keywords: ['refund', 'reversal', 'reversed', 'cashback', 'chargeback', 'returned'],
  },
  {
    category: 'Rent Received',
    keywords: ['rent received', 'rent credit', 'tenant'],
  },
  {
    category: 'Transfers',
    keywords: ['self transfer', 'own account', 'imps', 'neft', 'rtgs'],
  },
];

export const MATCH_TYPES = ['contains', 'starts_with', 'ends_with', 'equals', 'regex'] as const;
export type MatchType = (typeof MATCH_TYPES)[number];

export const RULE_FIELDS = ['any', 'merchant', 'title', 'note'] as const;
export type RuleField = (typeof RULE_FIELDS)[number];

export type CategoryRule = {
  id: number;
  pattern: string;
  category: string;
  field: RuleField;
  matchType: MatchType;
  direction: 'debit' | 'credit' | null;
  minPaise: number | null;
  maxPaise: number | null;
  priority: number;
  enabled: boolean;
  origin: 'learned' | 'manual';
  hits: number;
};

/** What a rule is tested against. */
export type RuleSubject = {
  merchant: string | null;
  title: string | null;
  note: string | null;
  rawText: string;
  direction: 'debit' | 'credit';
  amountPaise: number;
};

function haystackFor(subject: RuleSubject, field: RuleField): string {
  switch (field) {
    case 'merchant':
      return (subject.merchant ?? '').toLowerCase();
    case 'title':
      return (subject.title ?? '').toLowerCase();
    case 'note':
      return (subject.note ?? '').toLowerCase();
    default:
      return [subject.title, subject.merchant, subject.note, subject.rawText]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
  }
}

function textMatches(haystack: string, pattern: string, matchType: MatchType): boolean {
  if (matchType === 'regex') {
    try {
      // Case-insensitive to match how every other mode behaves.
      return new RegExp(pattern, 'i').test(haystack);
    } catch {
      // A rule the user is still typing must not break categorisation.
      return false;
    }
  }

  const needle = pattern.toLowerCase();
  switch (matchType) {
    case 'starts_with':
      return haystack.startsWith(needle);
    case 'ends_with':
      return haystack.endsWith(needle);
    case 'equals':
      return haystack.trim() === needle;
    default:
      return haystack.includes(needle);
  }
}

/**
 * Whether one rule applies. Every condition the rule sets must hold; conditions
 * it leaves unset are not tested, so a rule with only a pattern behaves exactly
 * as the old learned rules did.
 */
export function ruleMatches(rule: CategoryRule, subject: RuleSubject): boolean {
  if (!rule.enabled) return false;
  if (!rule.pattern) return false;
  if (rule.direction !== null && rule.direction !== subject.direction) return false;
  if (rule.minPaise !== null && subject.amountPaise < rule.minPaise) return false;
  if (rule.maxPaise !== null && subject.amountPaise > rule.maxPaise) return false;
  return textMatches(haystackFor(subject, rule.field), rule.pattern, rule.matchType);
}

/**
 * Rules are tried lowest priority number first. A rule the user wrote outranks
 * one the app inferred at the same priority, because the app's guess is what
 * they were correcting.
 */
export function orderRules(rules: readonly CategoryRule[]): CategoryRule[] {
  return [...rules].sort((left, right) => {
    if (left.priority !== right.priority) return left.priority - right.priority;
    if (left.origin !== right.origin) return left.origin === 'manual' ? -1 : 1;
    if (left.hits !== right.hits) return right.hits - left.hits;
    return left.id - right.id;
  });
}

/** The first matching rule's category, or null when none apply. */
export function categoryFromRules(
  rules: readonly CategoryRule[],
  subject: RuleSubject
): CategoryRule | null {
  for (const rule of orderRules(rules)) {
    if (ruleMatches(rule, subject)) return rule;
  }
  return null;
}

export function suggestCategory(
  merchant: string | null,
  rawText: string,
  direction: 'debit' | 'credit',
  rules: readonly CategoryRule[] = [],
  subject?: Partial<Pick<RuleSubject, 'title' | 'note' | 'amountPaise'>>
): string {
  const haystack = `${merchant ?? ''} ${rawText}`.toLowerCase();

  const matched = categoryFromRules(rules, {
    merchant,
    title: subject?.title ?? null,
    note: subject?.note ?? null,
    rawText,
    direction,
    amountPaise: subject?.amountPaise ?? 0,
  });
  if (matched) return matched.category;

  for (const entry of KEYWORD_MAP) {
    const incomeOnly = isIncomeCategory(entry.category) && entry.category !== 'Transfers'
      && entry.category !== 'Investments';
    if (direction === 'debit' && incomeOnly) continue;
    if (direction === 'credit' && !isIncomeCategory(entry.category)) continue;
    if (entry.keywords.some((keyword) => haystack.includes(keyword))) {
      return entry.category;
    }
  }

  return direction === 'credit' ? 'Other Income' : 'Other';
}

export function ruleKeyFor(merchant: string | null): string | null {
  if (!merchant) return null;
  const normalized = merchant.trim().toLowerCase();
  return normalized.length >= 3 ? normalized : null;
}
