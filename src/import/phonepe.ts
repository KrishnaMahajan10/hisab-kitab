export type StatementRow = {
  amountPaise: number;
  direction: 'debit' | 'credit';
  merchant: string | null;
  occurredAt: number;
  hasExactTime: boolean;
  accountMask: string | null;
  reference: string | null;
  rawLine: string;
};

export type StatementParseResult = {
  format: 'phonepe' | 'unknown';
  rows: StatementRow[];
  skipped: number;
};

const DATE_LINE = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/;
const TIME_LINE = /^(\d{1,2}):(\d{2})\s*(am|pm)$/i;
const TXN_LINE = /^(DEBIT|CREDIT)\s+₹\s*([\d,]+(?:\.\d{1,2})?)\s*(?:\t|\s{2,})?(.*)$/i;
const TXN_ID_LINE = /^(?:Bharat Connect )?Transaction ID\s+(\S+)/i;
const UTR_LINE = /^UTR No\.\s+(\S+)/i;
const PAID_BY_LINE = /^Paid by\s+(\S+)/i;

const BARE_TYPE = /^(DEBIT|CREDIT)$/i;
const BARE_AMOUNT = /^₹\s*([\d,]+(?:\.\d{1,2})?)$/;
const TYPE_WITH_AMOUNT = /^(DEBIT|CREDIT)\s+₹\s*([\d,]+(?:\.\d{1,2})?)$/i;

// PDFBox with sortByPosition merges a whole table row onto one line:
//   "Aug 19, 2026 Paid to S SQUARE HOSPITALITY DEBIT ₹100"
const COMBINED_ROW =
  /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})\s+(.+?)\s+(DEBIT|CREDIT)\s+₹\s*([\d,]+(?:\.\d{1,2})?)$/i;

// ...and merges the time with the transaction id:
//   "08:51 pm Transaction ID T2608192051120944645731"
const TIME_WITH_ID =
  /^(\d{1,2}):(\d{2})\s*(am|pm)\s+(?:Bharat Connect )?Transaction ID\s+(\S+)/i;

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

const MERCHANT_PREFIXES = [
  /^paid to\s+/i,
  /^received from\s+/i,
  /^refund from\s+/i,
  /^money sent to\s+/i,
  /^money received from\s+/i,
];

export function looksLikePhonePeStatement(text: string): boolean {
  return /Transaction Statement for/i.test(text) && /UTR No\./i.test(text);
}

function toPaise(raw: string): number | null {
  const value = Number.parseFloat(raw.replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

function isMetaLine(line: string): boolean {
  return (
    BARE_TYPE.test(line) ||
    DATE_LINE.test(line) ||
    TIME_LINE.test(line) ||
    TXN_ID_LINE.test(line) ||
    UTR_LINE.test(line) ||
    PAID_BY_LINE.test(line)
  );
}

/**
 * Different PDF text extractors group lines differently. pdf-parse emits
 * "DEBIT ₹100\tPaid to X" on a single line, while PDFBox may split the type,
 * amount and detail across two or three lines. Re-flow all shapes into the
 * single-line form so the parser below only handles one case.
 */
export function normalizeLines(input: string[]): string[] {
  const out: string[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const line = input[index];

    if (BARE_TYPE.test(line)) {
      const amountMatch = BARE_AMOUNT.exec(input[index + 1] ?? '');
      if (amountMatch) {
        const detail = input[index + 2] ?? '';
        const useDetail = detail.length > 0 && !isMetaLine(detail);
        out.push(`${line.toUpperCase()} ₹${amountMatch[1]}\t${useDetail ? detail : ''}`);
        index += useDetail ? 2 : 1;
        continue;
      }
    }

    const withAmount = TYPE_WITH_AMOUNT.exec(line);
    if (withAmount) {
      const detail = input[index + 1] ?? '';
      if (detail.length > 0 && !isMetaLine(detail)) {
        out.push(`${withAmount[1].toUpperCase()} ₹${withAmount[2]}\t${detail}`);
        index += 1;
        continue;
      }
    }

    out.push(line);
  }

  return out;
}

function buildTimestamp(
  date: { month: number; day: number; year: number },
  time: { hour: number; minute: number; meridiem: string } | null
): { ms: number; exact: boolean } {
  if (!time) {
    return { ms: new Date(date.year, date.month, date.day, 12, 0, 0).getTime(), exact: false };
  }
  let hour = time.hour % 12;
  if (time.meridiem.toLowerCase() === 'pm') hour += 12;
  return {
    ms: new Date(date.year, date.month, date.day, hour, time.minute, 0).getTime(),
    exact: true,
  };
}

function cleanMerchant(detail: string): string | null {
  let value = detail.replace(/\s+/g, ' ').trim();
  if (!value) return null;

  for (const prefix of MERCHANT_PREFIXES) {
    if (prefix.test(value)) {
      value = value.replace(prefix, '').trim();
      break;
    }
  }

  value = value.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '').trim();
  if (value.length < 2) return null;

  if (value === value.toUpperCase() && /[A-Z]{3}/.test(value)) {
    value = value
      .toLowerCase()
      .split(' ')
      .map((word) => (word ? word[0].toUpperCase() + word.slice(1) : word))
      .join(' ');
  }
  return value;
}

export function parsePhonePeStatement(text: string): StatementParseResult {
  const rawLines = text
    .split('\n')
    .map((line) => line.replace(/ /g, ' ').trim())
    .filter(Boolean);
  const lines = normalizeLines(rawLines);

  const rows: StatementRow[] = [];
  let skipped = 0;

  let pendingDate: { month: number; day: number; year: number } | null = null;
  let pendingTime: { hour: number; minute: number; meridiem: string } | null = null;
  let current: StatementRow | null = null;
  let currentDate: { month: number; day: number; year: number } | null = null;

  const applyTime = (time: { hour: number; minute: number; meridiem: string }) => {
    if (!current || !currentDate || current.hasExactTime) return;
    const stamp = buildTimestamp(currentDate, time);
    current.occurredAt = stamp.ms;
    current.hasExactTime = stamp.exact;
  };

  for (const line of lines) {
    const combined = COMBINED_ROW.exec(line);
    if (combined) {
      const month = MONTHS[combined[1].toLowerCase()];
      const paise = toPaise(combined[6]);
      if (month === undefined || paise === null) {
        skipped += 1;
        current = null;
        continue;
      }
      currentDate = { month, day: Number(combined[2]), year: Number(combined[3]) };
      const stamp = buildTimestamp(currentDate, null);
      current = {
        amountPaise: paise,
        direction: combined[5].toUpperCase() === 'CREDIT' ? 'credit' : 'debit',
        merchant: cleanMerchant(combined[4]),
        occurredAt: stamp.ms,
        hasExactTime: false,
        accountMask: null,
        reference: null,
        rawLine: line,
      };
      rows.push(current);
      pendingDate = currentDate;
      pendingTime = null;
      continue;
    }

    const timeWithId = TIME_WITH_ID.exec(line);
    if (timeWithId) {
      applyTime({
        hour: Number(timeWithId[1]),
        minute: Number(timeWithId[2]),
        meridiem: timeWithId[3],
      });
      if (current && !current.reference) current.reference = timeWithId[4];
      continue;
    }

    const dateMatch = DATE_LINE.exec(line);
    if (dateMatch) {
      const month = MONTHS[dateMatch[1].toLowerCase()];
      if (month !== undefined) {
        pendingDate = { month, day: Number(dateMatch[2]), year: Number(dateMatch[3]) };
        pendingTime = null;
        // A standalone date line starts a new row, so the previous row is finished.
        // Without this, a later time line could be applied to the wrong transaction.
        current = null;
      }
      continue;
    }

    const timeMatch = TIME_LINE.exec(line);
    if (timeMatch) {
      pendingTime = {
        hour: Number(timeMatch[1]),
        minute: Number(timeMatch[2]),
        meridiem: timeMatch[3],
      };
      applyTime(pendingTime);
      continue;
    }

    const txnMatch = TXN_LINE.exec(line);
    if (txnMatch) {
      const paise = toPaise(txnMatch[2]);
      if (paise === null || !pendingDate) {
        skipped += 1;
        current = null;
        continue;
      }
      const stamp = buildTimestamp(pendingDate, pendingTime);
      currentDate = pendingDate;
      current = {
        amountPaise: paise,
        direction: txnMatch[1].toUpperCase() === 'CREDIT' ? 'credit' : 'debit',
        merchant: cleanMerchant(txnMatch[3] ?? ''),
        occurredAt: stamp.ms,
        hasExactTime: stamp.exact,
        accountMask: null,
        reference: null,
        rawLine: line,
      };
      rows.push(current);
      continue;
    }

    if (!current) continue;

    const idMatch = TXN_ID_LINE.exec(line);
    if (idMatch) {
      if (!current.reference) current.reference = idMatch[1];
      continue;
    }

    const utrMatch = UTR_LINE.exec(line);
    if (utrMatch) {
      current.reference = utrMatch[1];
      continue;
    }

    const paidByMatch = PAID_BY_LINE.exec(line);
    if (paidByMatch) {
      current.accountMask = paidByMatch[1];
      continue;
    }
  }

  return { format: 'phonepe', rows, skipped };
}

export function maskDigits(mask: string | null): string | null {
  if (!mask) return null;
  const digits = mask.replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}
