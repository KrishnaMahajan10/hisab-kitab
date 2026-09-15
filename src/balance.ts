/**
 * Working out what your money should stand at right now.
 *
 * The app only ever sees movements, never the balance itself, so it cannot know
 * what you have until you tell it once. A snapshot is that one reading: "this
 * is what I had at this moment". Everything captured after it is applied on top,
 * and the result is a figure you can hold against your bank app to see whether
 * anything went unrecorded.
 *
 * The reading and the monthly cycle are independent. You can take a reading
 * today while your months still run from the 7th — the cycle decides which
 * spending is grouped together, the reading decides where the running total
 * starts from.
 */

export type BalanceFlow = {
  /** Confirmed money in, ignoring anything that only moved between your pots. */
  inflow: number;
  /** Confirmed money out, at full face value including shares you fronted. */
  outflow: number;
  /** Confirmed money that only changed pots, shown but never applied. */
  moved: number;
  /** What the still-unreviewed rows would add or take away, as one signed figure. */
  pendingNet: number;
  pendingCount: number;
};

export const EMPTY_FLOW: BalanceFlow = {
  inflow: 0,
  outflow: 0,
  moved: 0,
  pendingNet: 0,
  pendingCount: 0,
};

/**
 * The balance a reading implies once everything captured since it is applied.
 *
 * Debits count at their full amount even when part of the payment was somebody
 * else's share: that money did leave your account, and it comes back as its own
 * credit when they pay you. This is the one place the arithmetic deliberately
 * differs from the spending totals, which count only your share.
 */
export function projectBalance(openingPaise: number, flow: BalanceFlow): number {
  return openingPaise + flow.inflow - flow.outflow;
}

/** The same figure once the unreviewed rows are believed too. */
export function projectBalanceWithPending(openingPaise: number, flow: BalanceFlow): number {
  return projectBalance(openingPaise, flow) + flow.pendingNet;
}

/**
 * The moment a reading belongs to.
 *
 * A reading taken today is true as of now: whatever you already paid this
 * morning is part of the number you just read off your bank app, and taking it
 * off again would count it twice. A back-dated reading is taken at the start of
 * its day instead — "I had ₹5,000 on the 7th" is a claim about the day, and
 * everything that happened on the 7th should count against it.
 *
 * A date in the future has no reading to give, so it is pulled back to now.
 */
export function readingTakenAt(chosen: Date, now: Date): number {
  const sameDay =
    chosen.getFullYear() === now.getFullYear() &&
    chosen.getMonth() === now.getMonth() &&
    chosen.getDate() === now.getDate();
  if (sameDay || chosen.getTime() > now.getTime()) return now.getTime();
  return new Date(chosen.getFullYear(), chosen.getMonth(), chosen.getDate()).getTime();
}

/**
 * Rupees typed into a box, as paise. Unlike an amount on a transaction this may
 * be zero or negative: an account can be empty, and one can be overdrawn.
 */
export function parseBalanceInput(text: string): number | null {
  const cleaned = text.replace(/[,₹\s]/g, '');
  if (cleaned === '' || cleaned === '-') return null;
  const value = Number.parseFloat(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100);
}
