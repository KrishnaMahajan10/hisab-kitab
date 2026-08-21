import type { RawCapture } from '../../modules/hisab-capture';
import { captureOrigin, type CaptureOrigin } from '../labels';

export type Direction = 'debit' | 'credit';

export type ParsedTransaction = {
  amountPaise: number;
  direction: Direction;
  last4: string | null;
  allLast4: string[];
  merchant: string | null;
  occurredAt: number;
  confidence: number;
  dedupKey: string;
  reference: string | null;
};

export const NEAR_DUPLICATE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Two sources rarely agree on the clock. A statement row may carry only a date,
 * landing hours from the SMS that reported the same payment, so a match across
 * sources is allowed a much wider window than one within a single source.
 */
export const CROSS_SOURCE_WINDOW_MS = 12 * 60 * 60 * 1000;

export type PaymentCandidate = {
  occurredAt: number;
  merchantIdentity: string | null;
  origin: CaptureOrigin;
};

/**
 * Whether a stored row and an incoming one are the same payment, given that
 * their amount and direction already match.
 *
 * Inside the tight window the times alone are convincing, and a missing
 * merchant on either side is tolerated. Beyond it, only a row from a *different*
 * source may match, and only with a positive merchant match — two same-amount
 * payments to the same shop hours apart in the same SMS feed are two payments,
 * not one.
 */
export function isSamePayment(
  candidate: PaymentCandidate,
  incoming: PaymentCandidate,
  tightMs = NEAR_DUPLICATE_WINDOW_MS,
  crossSourceMs = CROSS_SOURCE_WINDOW_MS
): boolean {
  const distance = Math.abs(candidate.occurredAt - incoming.occurredAt);

  if (distance <= tightMs) {
    if (candidate.merchantIdentity === null || incoming.merchantIdentity === null) return true;
    return merchantsMatch(candidate.merchantIdentity, incoming.merchantIdentity);
  }

  if (candidate.origin === incoming.origin) return false;
  if (distance > crossSourceMs) return false;
  return merchantsMatch(candidate.merchantIdentity, incoming.merchantIdentity);
}

// Bank SMS quotes the payment reference in several shapes. These are the same
// numbers a statement calls a UTR / transaction id, so extracting them lets an
// SMS-captured payment be matched against the same payment in a statement.
const REFERENCE_PATTERNS: RegExp[] = [
  // Banks write the rail, then optionally a direction code (ICICI/Axis send
  // "UPI/DR/<utr>/PAYEE"), then the number. The code segment is spelled out
  // rather than matched loosely so a payee name is never mistaken for a UTR.
  /\b(?:upi|imps|neft|rtgs)\s*[\/\-:]\s*(?:(?:dr|cr|p2a|p2m)\s*[\/\-:]\s*)?([A-Za-z0-9]{6,})/i,
  /\brrn\s*:?\s*([A-Za-z0-9]{6,})/i,
  /\b(?:txn|transaction)\s*(?:id|no\.?)\s*:?\s*([A-Za-z0-9]{6,})/i,
  /\bref(?:erence)?\s*(?:no\.?|number)?\s*:?\s*([A-Za-z0-9]{6,})/i,
  /\butr\s*(?:no\.?)?\s*:?\s*([A-Za-z0-9]{6,})/i,
];

export function extractReference(text: string): string | null {
  for (const pattern of REFERENCE_PATTERNS) {
    const match = pattern.exec(text);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * Two references refer to the same payment when they are equal, or when one is
 * a suffix/prefix of the other. Banks routinely quote a 6-digit fragment of a
 * 12-digit UTR in their SMS, so containment is the practical test. The 6-char
 * floor keeps short numbers from colliding by chance.
 */
export function referencesMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const left = a.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const right = b.toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (left.length < 6 || right.length < 6) return false;
  if (left === right) return true;
  const [longer, shorter] = left.length >= right.length ? [left, right] : [right, left];
  return longer.startsWith(shorter) || longer.endsWith(shorter);
}

/**
 * Merchant strings differ between sources for the same payee — a bank SMS says
 * "SWIGGY" where a PhonePe statement says "Swiggy Limited". Compare by
 * containment rather than equality, with a floor so short names do not collide.
 */
export function merchantsMatch(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.length < 4 || b.length < 4) return false;
  const [longer, shorter] = a.length >= b.length ? [a, b] : [b, a];
  return longer.includes(shorter);
}

const AMOUNT_PREFIXED = /(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)/i;
const AMOUNT_SUFFIXED = /\b([0-9][0-9,]*(?:\.[0-9]{1,2})?)\s*(?:rs\.?|inr|₹)/i;

const DEBIT_WORDS =
  /\b(debited|debit|spent|paid|withdrawn|purchase|deducted|sent|transferred)\b/i;
const CREDIT_WORDS = /\b(credited|credit|received|refund|refunded|deposited|cashback|salary)\b/i;
const MOVEMENT_WORDS =
  /\b(debited|debit|credited|credit|spent|paid|withdrawn|purchase|deducted|sent|transferred|received|refund|refunded|deposited|transaction|txn)\b/i;

const NOISE_WORDS =
  /\b(otp|one[- ]time password|verification code|do not share|dont share|will expire|pre-?approved|loan offer|apply now|cashback offer|statement is ready|e-?mandate|autopay reminder|failed|declined|reversed|unsuccessful)\b/i;

const LAST4_MASKED = /\b(?:x{2,}|\*{2,}|•{2,})\s*(\d{4})\b/i;
const LAST4_LABELLED =
  /(?:a\/c|ac|acct|account|card|vpa)[^0-9a-z]{0,12}?(?:no\.?|ending|ending in)?[^0-9]{0,6}(\d{4})\b/i;

const DATE_NUMERIC = /\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/;
const DATE_MONTH_NAME = /\b(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s'](\d{2,4})\b/;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const MERCHANT_STRATEGIES: RegExp[] = [
  /\binfo:?\s*(?:upi|imps|neft|ach|mmt)?[\/\-]?[a-z0-9]*[\/\-]([A-Za-z0-9&\- ']{3,40})/i,
  /\bvpa\s+([a-z0-9._\-]+)@[a-z]+/i,
  /\b(?:at|to|towards|by|from)\s+([A-Za-z0-9][A-Za-z0-9&\-_ ']{2,40})/i,
  /\b\d{1,2}[-/][A-Za-z0-9]{2,3}[-/]\d{2,4}\s+([A-Z][A-Z0-9&\-']+(?:\s+[A-Z][A-Z0-9&\-']+)*)/,
  /\b(?:paid to|sent to|received from)\s+([A-Za-z0-9][A-Za-z0-9&\-_ ']{2,40})/i,
];

const JUNK_TAIL =
  /\b(avl|avlbl|available|bal|balance|lmt|limit|ref|refno|info|not you|call|upi|txn|a\/c|on|dated|inr|rs|card|ac)\b.*$/i;

const MERCHANT_STOPWORDS = new Set([
  'your', 'you', 'the', 'a', 'an', 'account', 'card', 'bank', 'upi', 'vpa',
  'ref', 'avl', 'bal', 'balance', 'limit', 'info', 'txn', 'transaction',
]);

function toPaise(raw: string): number | null {
  const value = Number.parseFloat(raw.replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

function extractAmount(text: string): { paise: number; index: number } | null {
  const prefixed = AMOUNT_PREFIXED.exec(text);
  if (prefixed) {
    const paise = toPaise(prefixed[1]);
    if (paise !== null) return { paise, index: prefixed.index };
  }
  const suffixed = AMOUNT_SUFFIXED.exec(text);
  if (suffixed) {
    const paise = toPaise(suffixed[1]);
    if (paise !== null) return { paise, index: suffixed.index };
  }
  return null;
}

function nearestDistance(text: string, source: RegExp, anchor: number): number | null {
  const scanner = new RegExp(source.source, 'gi');
  let best: number | null = null;
  let match: RegExpExecArray | null;
  while ((match = scanner.exec(text)) !== null) {
    const distance = Math.abs(match.index - anchor);
    if (best === null || distance < best) best = distance;
  }
  return best;
}

function extractDirection(text: string, amountIndex: number): Direction | null {
  const debit = nearestDistance(text, DEBIT_WORDS, amountIndex);
  const credit = nearestDistance(text, CREDIT_WORDS, amountIndex);
  if (debit === null && credit === null) return null;
  if (credit === null) return 'debit';
  if (debit === null) return 'credit';
  return credit < debit ? 'credit' : 'debit';
}

function extractLast4(text: string): string | null {
  return LAST4_MASKED.exec(text)?.[1] ?? LAST4_LABELLED.exec(text)?.[1] ?? null;
}

/**
 * Every account or card number quoted in the message, in the order they appear.
 * A self-transfer names two ("debited from A/c XX1234 and credited to A/c
 * XX5678"), and only the pair reveals what the message actually was — a single
 * number cannot tell a transfer apart from a payment to a stranger.
 */
function extractAllLast4(text: string): string[] {
  const found: Array<{ index: number; value: string }> = [];

  for (const pattern of [LAST4_MASKED, LAST4_LABELLED]) {
    const scanner = new RegExp(pattern.source, 'gi');
    let match: RegExpExecArray | null;
    while ((match = scanner.exec(text)) !== null) {
      if (match[1]) found.push({ index: match.index, value: match[1] });
      // A zero-length match would spin forever otherwise.
      if (scanner.lastIndex === match.index) scanner.lastIndex += 1;
    }
  }

  found.sort((left, right) => left.index - right.index);

  const unique: string[] = [];
  for (const entry of found) {
    if (!unique.includes(entry.value)) unique.push(entry.value);
  }
  return unique;
}

/**
 * Moving money between two accounts that are both yours is a relocation, not a
 * payment. Two of the numbers in the message being accounts you already hold is
 * the only reliable signal for it: the wording ("IMPS", "NEFT", "transfer") says
 * nothing about who the other side belongs to.
 */
export function isSelfTransfer(
  last4s: readonly string[],
  ownedLast4: ReadonlySet<string>
): boolean {
  let owned = 0;
  for (const last4 of last4s) {
    if (ownedLast4.has(last4)) owned += 1;
    if (owned >= 2) return true;
  }
  return false;
}

function cleanMerchant(raw: string): string | null {
  let value = raw.replace(/\s+/g, ' ').trim();

  const sentenceCut = value.search(/[.;!?](\s|$)/);
  if (sentenceCut > 0) value = value.slice(0, sentenceCut);

  value = value.replace(JUNK_TAIL, '').trim();
  value = value.replace(/\s+[A-Za-z]$/, '').trim();
  value = value.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '').trim();

  if (value.length < 3) return null;
  if (/^\d+$/.test(value)) return null;
  if (MERCHANT_STOPWORDS.has(value.toLowerCase())) return null;

  if (value === value.toUpperCase() && value.length > 3) {
    value = value
      .toLowerCase()
      .split(' ')
      .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
      .join(' ');
  }
  return value;
}

function extractMerchant(text: string): string | null {
  for (const pattern of MERCHANT_STRATEGIES) {
    const match = pattern.exec(text);
    if (match?.[1]) {
      const cleaned = cleanMerchant(match[1]);
      if (cleaned) return cleaned;
    }
  }
  return null;
}

function extractOccurredAt(text: string, fallback: number): number {
  const fallbackDate = new Date(fallback);

  const build = (day: number, month: number, year: number): number | null => {
    if (month < 0 || month > 11 || day < 1 || day > 31) return null;
    const fullYear = year < 100 ? 2000 + year : year;
    const candidate = new Date(fullYear, month, day, 12, 0, 0);
    const time = candidate.getTime();
    if (!Number.isFinite(time)) return null;
    if (Math.abs(time - fallback) > 45 * 24 * 60 * 60 * 1000) return null;
    if (
      candidate.getFullYear() === fallbackDate.getFullYear() &&
      candidate.getMonth() === fallbackDate.getMonth() &&
      candidate.getDate() === fallbackDate.getDate()
    ) {
      return fallback;
    }
    return time;
  };

  const named = DATE_MONTH_NAME.exec(text);
  if (named) {
    const month = MONTHS[named[2].toLowerCase()];
    if (month !== undefined) {
      const result = build(Number(named[1]), month, Number(named[3]));
      if (result !== null) return result;
    }
  }

  const numeric = DATE_NUMERIC.exec(text);
  if (numeric) {
    const result = build(Number(numeric[1]), Number(numeric[2]) - 1, Number(numeric[3]));
    if (result !== null) return result;
  }

  return fallback;
}

function hashString(input: string): string {
  let hash = 5381;
  for (let index = 0; index < input.length; index += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(index)) | 0;
  }
  return (hash >>> 0).toString(36);
}

export function captureDedupKey(capture: RawCapture): string {
  return `${capture.source}|${capture.sender}|${capture.postedAt}|${hashString(capture.body)}`;
}

export function merchantIdentity(merchant: string | null): string | null {
  if (!merchant) return null;
  const normalized = merchant.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalized.length >= 3 ? normalized : null;
}

export function parseCapture(capture: RawCapture): ParsedTransaction | null {
  const text = capture.body.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  if (NOISE_WORDS.test(text)) return null;
  if (!MOVEMENT_WORDS.test(text)) return null;

  const amount = extractAmount(text);
  if (!amount) return null;

  const direction = extractDirection(text, amount.index);
  if (direction === null) return null;

  const last4 = extractLast4(text);
  const allLast4 = extractAllLast4(text);
  const merchant = extractMerchant(text);
  const occurredAt = extractOccurredAt(text, capture.postedAt);

  let confidence = 0.5;
  if (merchant) confidence += 0.3;
  if (last4) confidence += 0.2;

  return {
    amountPaise: amount.paise,
    direction,
    last4,
    allLast4,
    merchant,
    occurredAt,
    confidence: Math.min(confidence, 1),
    dedupKey: captureDedupKey(capture),
    reference: extractReference(text),
  };
}

/** The parts of a stored row that decide whether a statement outranks it. */
export type CapturedRow = {
  status: 'pending' | 'confirmed';
  source: 'sms' | 'notification' | 'manual';
  raw_sender: string | null;
};
/**
 * Whether an imported statement row should take the place of a row already
 * captured from a message.
 *
 * A statement is the bank's own record: the amount is exact, the payee is spelled
 * in full, and the reference is complete rather than a fragment quoted in an SMS.
 * So when the same payment is sitting in the review queue, the statement version
 * replaces it and the review request disappears.
 *
 * A row that has already been reviewed is never touched. The category, title and
 * account on it are the user's decisions, and re-importing a statement must not
 * quietly undo them.
 */
export function statementSupersedes(
  existing: CapturedRow,
  row: { reference: string | null }
): boolean {
  if (existing.status !== 'pending') return false;
  // Another statement import is not better information, just the same file again.
  if (captureOrigin(existing) === 'statement') return false;
  // Without a reference the match was a heuristic, and a heuristic is not strong
  // enough to justify deleting something.
  return row.reference !== null;
}

