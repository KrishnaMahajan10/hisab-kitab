import type { Cell } from './biff';
import { parseLooseNumber } from './csv';
import type { StatementRow } from './phonepe';

/**
 * Reads a bank statement out of a tabular export — a .xls sheet or a delimited
 * file — without knowing which bank wrote it. Banks disagree on column names and
 * on how they signal direction, so the header row is matched against synonyms
 * and the rows are read through whichever shape that reveals.
 */

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11,
};

// Longer, more specific names first: a sheet with both "Transaction Date" and
// "Value Date" should use the date the payment happened.
const COLUMN_SYNONYMS = {
  date: [
    'transaction date', 'txn date', 'tran date', 'posting date', 'post date',
    'date of transaction', 'value date', 'date',
  ],
  description: [
    'transaction remarks', 'transaction details', 'transaction description',
    'narration', 'particulars', 'description', 'remarks', 'details', 'narrative',
  ],
  debit: [
    'withdrawal amount', 'withdrawal amt', 'debit amount', 'debit amt',
    'withdrawal', 'withdrawals', 'debit',
  ],
  credit: [
    'deposit amount', 'deposit amt', 'credit amount', 'credit amt',
    'deposit', 'deposits', 'credit',
  ],
  amount: ['transaction amount', 'amount', 'amt'],
  indicator: [
    'dr / cr', 'dr/cr', 'cr/dr', 'debit/credit', 'transaction type', 'type',
    'indicator',
  ],
  reference: [
    'transaction id', 'reference number', 'reference no', 'ref no', 'utr',
    'utr no', 'cheque number', 'cheque no', 'chq no', 'reference',
  ],
  balance: ['closing balance', 'available balance', 'running balance', 'balance'],
} as const;

export type ColumnMap = {
  date: number;
  description: number;
  debit: number;
  credit: number;
  amount: number;
  indicator: number;
  reference: number;
  balance: number;
};

export type TableParseResult = {
  rows: StatementRow[];
  skipped: number;
  headerRow: number;
  columns: ColumnMap | null;
  accountHint: string | null;
};

/**
 * The account this statement belongs to, taken from the title block above the
 * table. Every row in the file shares it, and without it an import lands with no
 * account attached at all.
 */
function findAccountHint(rows: Cell[][], headerRow: number): string | null {
  for (let index = 0; index < headerRow; index += 1) {
    for (const cell of rows[index] ?? []) {
      const raw = cell === null ? '' : String(cell);
      // A long unbroken digit run is an account number; dates and amounts break.
      const match = /\b(\d{9,20})\b/.exec(raw.replace(/\s/g, ''));
      if (match) return match[1].slice(-4);
    }
  }
  return null;
}

function text(cell: Cell): string {
  if (cell === null) return '';
  return String(cell).trim();
}

function normalizeHeader(cell: Cell): string {
  return text(cell)
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z/ ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function matchColumn(headers: string[], synonyms: readonly string[]): number {
  for (const synonym of synonyms) {
    const exact = headers.indexOf(synonym);
    if (exact >= 0) return exact;
  }
  for (const synonym of synonyms) {
    const partial = headers.findIndex((header) => header.includes(synonym));
    if (partial >= 0) return partial;
  }
  return -1;
}

function mapColumns(row: Cell[]): ColumnMap | null {
  const headers = row.map(normalizeHeader);

  const columns: ColumnMap = {
    date: matchColumn(headers, COLUMN_SYNONYMS.date),
    description: matchColumn(headers, COLUMN_SYNONYMS.description),
    debit: matchColumn(headers, COLUMN_SYNONYMS.debit),
    credit: matchColumn(headers, COLUMN_SYNONYMS.credit),
    amount: matchColumn(headers, COLUMN_SYNONYMS.amount),
    indicator: matchColumn(headers, COLUMN_SYNONYMS.indicator),
    reference: matchColumn(headers, COLUMN_SYNONYMS.reference),
    balance: matchColumn(headers, COLUMN_SYNONYMS.balance),
  };

  // "Debit"/"Credit" also appear inside a "Dr/Cr" indicator header; if the same
  // column answered both, the indicator reading is the correct one.
  if (columns.debit >= 0 && columns.debit === columns.indicator) columns.debit = -1;
  if (columns.credit >= 0 && columns.credit === columns.indicator) columns.credit = -1;
  if (columns.amount >= 0 && (columns.amount === columns.debit || columns.amount === columns.credit)) {
    columns.amount = -1;
  }

  const hasAmount = columns.debit >= 0 || columns.credit >= 0 || columns.amount >= 0;
  if (columns.date < 0 || !hasAmount) return null;
  return columns;
}

/**
 * Finds the header row. Statements bury it under a title block, and a stray line
 * can look header-ish, so every row is scored and the richest one wins.
 */
function findHeader(rows: Cell[][]): { index: number; columns: ColumnMap } | null {
  let best: { index: number; columns: ColumnMap; score: number } | null = null;

  const limit = Math.min(rows.length, 80);
  for (let index = 0; index < limit; index += 1) {
    const columns = mapColumns(rows[index]);
    if (!columns) continue;

    const score = Object.values(columns).filter((column) => column >= 0).length;
    if (!best || score > best.score) best = { index, columns, score };
  }

  return best ? { index: best.index, columns: best.columns } : null;
}

/** Excel keeps dates as days since 1899-12-30, preserving the 1900 leap bug. */
function fromExcelSerial(serial: number): number | null {
  if (!Number.isFinite(serial) || serial < 1 || serial > 100_000) return null;
  const days = Math.floor(serial);
  const base = Date.UTC(1899, 11, 30);
  const date = new Date(base + days * 24 * 60 * 60 * 1000);
  return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12).getTime();
}

const DATE_NUMERIC = /^(\d{1,4})[-/.](\d{1,2})[-/.](\d{2,4})$/;
const DATE_MONTH_NAME = /^(\d{1,2})[-/ ]([A-Za-z]{3,9})[-/ ](\d{2,4})$/;
const DATE_MONTH_FIRST = /^([A-Za-z]{3,9})[-/ ](\d{1,2}),?[-/ ](\d{2,4})$/;

function buildDate(day: number, month: number, year: number): number | null {
  if (month < 0 || month > 11 || day < 1 || day > 31) return null;
  const fullYear = year < 100 ? (year > 70 ? 1900 + year : 2000 + year) : year;
  if (fullYear < 1970 || fullYear > 2200) return null;
  const date = new Date(fullYear, month, day, 12);
  if (date.getDate() !== day || date.getMonth() !== month) return null;
  return date.getTime();
}

/**
 * Indian statements write day-first. The ambiguous case is only ever resolved
 * one way here, deliberately: a wrong guess would file a payment in the wrong
 * month, and day-first is what every bank in the country exports.
 */
export function parseTableDate(cell: Cell): number | null {
  if (typeof cell === 'number') return fromExcelSerial(cell);

  const raw = text(cell);
  if (!raw) return null;

  // A timestamp attached to the date is fine; only the day is used.
  const head = raw.split(/[ T]/)[0];

  const named = DATE_MONTH_NAME.exec(head) ?? DATE_MONTH_NAME.exec(raw);
  if (named) {
    const month = MONTHS[named[2].slice(0, 4).toLowerCase()] ?? MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (month !== undefined) {
      const built = buildDate(Number(named[1]), month, Number(named[3]));
      if (built !== null) return built;
    }
  }

  const monthFirst = DATE_MONTH_FIRST.exec(head) ?? DATE_MONTH_FIRST.exec(raw);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].slice(0, 4).toLowerCase()] ?? MONTHS[monthFirst[1].slice(0, 3).toLowerCase()];
    if (month !== undefined) {
      const built = buildDate(Number(monthFirst[2]), month, Number(monthFirst[3]));
      if (built !== null) return built;
    }
  }

  const numeric = DATE_NUMERIC.exec(head);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[2]);
    const third = Number(numeric[3]);
    // A four-digit leading group is an ISO date; otherwise day comes first.
    return numeric[1].length === 4
      ? buildDate(third, second - 1, first)
      : buildDate(first, second - 1, third);
  }

  return null;
}

function amountOf(cell: Cell): number | null {
  if (typeof cell === 'number') return cell;
  const raw = text(cell);
  if (!raw || raw === '-' || raw === '--') return null;
  return parseLooseNumber(raw);
}

const VPA = /@/;
const SEGMENT_NOISE = new Set([
  'upi', 'imps', 'neft', 'rtgs', 'ach', 'achcr', 'achdr', 'mmt', 'nach', 'ecs',
  'inft', 'bil', 'bpay', 'bbps', 'atm', 'pos', 'vps', 'ips', 'cms', 'onl',
  'payment fr', 'pay to bha', 'collect re', 'transfer', 'dr', 'cr',
]);

/**
 * The payment reference inside a statement narration. Banks slot the UTR into a
 * slash-delimited field with no label — "UPI/SAFA ARBAZ/.../659315937795/ICI71.."
 * — so it is found by shape rather than by a keyword.
 */
export function referenceFromNarration(narration: string): string | null {
  const segments = narration.split(/[\/|]/).map((segment) => segment.trim());

  const twelve = segments.find((segment) => /^\d{12}$/.test(segment));
  if (twelve) return twelve;

  const numeric = segments.filter((segment) => /^\d{9,}$/.test(segment));
  if (numeric.length > 0) {
    return numeric.reduce((longest, segment) =>
      segment.length > longest.length ? segment : longest
    );
  }

  return null;
}

/**
 * The payee inside a statement narration. The first segment that reads like a
 * name wins: a leading all-digits segment is a reference, an "@" makes it a VPA,
 * and the rail and direction words are noise.
 */
export function merchantFromNarration(narration: string): string | null {
  const segments = narration.split(/[\/|]/).map((segment) => segment.trim());

  for (const segment of segments) {
    if (!segment) continue;
    if (/^\d+$/.test(segment)) continue;
    if (VPA.test(segment)) continue;
    if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(segment)) continue;
    if (SEGMENT_NOISE.has(segment.toLowerCase())) continue;
    if (!/[A-Za-z]{3}/.test(segment)) continue;

    const cleaned = segment.replace(/\s+/g, ' ').trim();
    if (cleaned.length < 3) continue;

    if (cleaned === cleaned.toUpperCase() && cleaned.length > 3) {
      return cleaned
        .toLowerCase()
        .split(' ')
        .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
        .join(' ');
    }
    return cleaned;
  }

  return null;
}

const DEBIT_INDICATOR = /^(dr|debit|withdrawal|w)$/i;
const CREDIT_INDICATOR = /^(cr|credit|deposit|d)$/i;

function directionAndAmount(
  row: Cell[],
  columns: ColumnMap
): { direction: 'debit' | 'credit'; amountPaise: number } | null {
  const debit = columns.debit >= 0 ? amountOf(row[columns.debit]) : null;
  const credit = columns.credit >= 0 ? amountOf(row[columns.credit]) : null;

  // Separate columns: the populated, non-zero one decides. Banks fill the other
  // with 0.00 or a dash rather than leaving it blank.
  if (debit !== null && Math.abs(debit) > 0) {
    return { direction: 'debit', amountPaise: Math.round(Math.abs(debit) * 100) };
  }
  if (credit !== null && Math.abs(credit) > 0) {
    return { direction: 'credit', amountPaise: Math.round(Math.abs(credit) * 100) };
  }

  if (columns.amount < 0) return null;
  const amount = amountOf(row[columns.amount]);
  if (amount === null || amount === 0) return null;

  if (columns.indicator >= 0) {
    const indicator = text(row[columns.indicator]);
    if (DEBIT_INDICATOR.test(indicator)) {
      return { direction: 'debit', amountPaise: Math.round(Math.abs(amount) * 100) };
    }
    if (CREDIT_INDICATOR.test(indicator)) {
      return { direction: 'credit', amountPaise: Math.round(Math.abs(amount) * 100) };
    }
  }

  // A single signed column: negative is money leaving.
  return {
    direction: amount < 0 ? 'debit' : 'credit',
    amountPaise: Math.round(Math.abs(amount) * 100),
  };
}

/**
 * Reads every transaction the grid contains. Rows that are not transactions —
 * title blocks, opening balances, the legend at the foot of an ICICI statement —
 * have no date or no amount and are counted as skipped rather than guessed at.
 */
export function parseTable(rows: Cell[][]): TableParseResult {
  const header = findHeader(rows);
  if (!header) {
    return { rows: [], skipped: rows.length, headerRow: -1, columns: null, accountHint: null };
  }

  const accountHint = findAccountHint(rows, header.index);

  const { columns } = header;
  const out: StatementRow[] = [];
  let skipped = 0;

  for (let index = header.index + 1; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || row.every((cell) => cell === null)) continue;

    const occurredAt = parseTableDate(row[columns.date] ?? null);
    if (occurredAt === null) {
      skipped += 1;
      continue;
    }

    const movement = directionAndAmount(row, columns);
    if (!movement) {
      skipped += 1;
      continue;
    }

    const narration = columns.description >= 0 ? text(row[columns.description]) : '';
    const referenceCell = columns.reference >= 0 ? text(row[columns.reference]) : '';
    const reference =
      referenceFromNarration(narration) ??
      (/^[A-Za-z0-9]{6,}$/.test(referenceCell) ? referenceCell : null);

    out.push({
      amountPaise: movement.amountPaise,
      direction: movement.direction,
      merchant: merchantFromNarration(narration),
      occurredAt,
      // A statement column carries a date, never a clock time.
      hasExactTime: false,
      accountMask: accountHint,
      reference,
      rawLine: narration || row.map(text).filter(Boolean).join(' '),
    });
  }

  return { rows: out, skipped, headerRow: header.index, columns, accountHint };
}
