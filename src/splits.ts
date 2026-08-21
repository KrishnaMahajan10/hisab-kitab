/**
 * Working out who owes what when a payment is shared.
 *
 * Money is integer paise throughout, so an even split rarely divides cleanly:
 * ₹1,000 between three people is 33333.33 paise each. Rounding every share the
 * same way loses or invents paise, and a ledger that does not add up is worse
 * than no ledger — so the remainder is handed out one paisa at a time.
 */

export type SplitDirection = 'owed_to_me' | 'i_owe';

export type SplitShare = { personId: number; amountPaise: number };

/**
 * Splits an amount into `parts` shares that sum exactly to the original. The
 * first shares are the larger ones when it does not divide evenly, so the payer
 * is never the one left short by a rounding choice.
 */
export function evenShares(amountPaise: number, parts: number): number[] {
  if (parts <= 0 || amountPaise <= 0) return [];

  const base = Math.floor(amountPaise / parts);
  let remainder = amountPaise - base * parts;

  const shares: number[] = [];
  for (let index = 0; index < parts; index += 1) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    shares.push(base + extra);
  }
  return shares;
}

/**
 * An even split of a bill between you and some friends: you keep one share and
 * each of them owes theirs. Your own share is never recorded as a split, because
 * it is money you really did spend.
 */
export function splitEvenlyWithMe(
  amountPaise: number,
  personIds: readonly number[]
): SplitShare[] {
  if (personIds.length === 0) return [];

  // One share for each friend plus one for you.
  const shares = evenShares(amountPaise, personIds.length + 1);
  // Nothing to divide yet — selecting someone before typing an amount must not
  // produce a share with no value in it.
  if (shares.length === 0) return [];
  // Your share is dropped, so give the others the smaller shares and absorb the
  // spare paise yourself.
  const theirs = shares.slice(1);
  return personIds.map((personId, index) => ({
    personId,
    amountPaise: theirs[index],
  }));
}

export type SplitRow = {
  personId: number;
  amountPaise: number;
  direction: SplitDirection;
  settled: boolean;
};

/**
 * What a split leaves you spending on a payment of your own. Every share you
 * assigned to someone else comes off, whether or not they have paid you back:
 * the money was never yours to spend, and settlement only changes when it
 * returned, not whether it was ever an expense.
 */
export function myShareOf(amountPaise: number, splits: readonly SplitRow[]): number {
  const lentOut = splits
    .filter((split) => split.direction === 'owed_to_me')
    .reduce((total, split) => total + split.amountPaise, 0);
  return Math.max(0, amountPaise - lentOut);
}

export type PersonBalance = { personId: number; netPaise: number };

/**
 * The net position with each person, counting only what is still outstanding.
 * Positive means they owe you; negative means you owe them. Someone who is
 * square drops out entirely rather than showing as a zero.
 */
export function outstandingBalances(splits: readonly SplitRow[]): PersonBalance[] {
  const totals = new Map<number, number>();

  for (const split of splits) {
    if (split.settled) continue;
    const signed = split.direction === 'owed_to_me' ? split.amountPaise : -split.amountPaise;
    totals.set(split.personId, (totals.get(split.personId) ?? 0) + signed);
  }

  return [...totals.entries()]
    .filter(([, netPaise]) => netPaise !== 0)
    .map(([personId, netPaise]) => ({ personId, netPaise }))
    .sort((left, right) => right.netPaise - left.netPaise);
}

/** Totals across everyone, for a single headline figure. */
export function totalOutstanding(splits: readonly SplitRow[]): {
  owedToMe: number;
  iOwe: number;
} {
  let owedToMe = 0;
  let iOwe = 0;
  for (const balance of outstandingBalances(splits)) {
    if (balance.netPaise > 0) owedToMe += balance.netPaise;
    else iOwe += -balance.netPaise;
  }
  return { owedToMe, iOwe };
}

/**
 * Shares as personId -> paise. Empty means the payment is not shared and the
 * whole amount is the user's own spending.
 */
export type Shares = Record<number, number>;

export function sharesTotal(shares: Shares): number {
  return Object.values(shares).reduce((total, share) => total + share, 0);
}

/**
 * Re-divides a bill evenly between the user and whoever is selected. Toggling
 * anyone recomputes every share, because a split that no longer adds up to the
 * bill would quietly corrupt the totals.
 */
export function toggleSharePerson(
  shares: Shares,
  personId: number,
  amountPaise: number
): Shares {
  const ids = new Set(Object.keys(shares).map(Number));
  if (ids.has(personId)) ids.delete(personId);
  else ids.add(personId);

  const next: Shares = {};
  for (const share of splitEvenlyWithMe(amountPaise, [...ids])) {
    next[share.personId] = share.amountPaise;
  }
  return next;
}
