import type { Cell } from './biff';

/**
 * Delimited-text reader for statements exported as CSV or TSV. Follows RFC 4180
 * quoting: a quoted field may hold the delimiter, a newline, or a doubled quote.
 */

const DELIMITERS = [',', ';', '\t', '|'] as const;

/**
 * The delimiter is whichever candidate splits the most lines into the same
 * number of fields — counting occurrences alone would pick the comma out of
 * "1,234.00" in a semicolon-separated file.
 */
export function sniffDelimiter(text: string): string {
  const lines = text
    .split(/\r\n|\r|\n/)
    .filter((line) => line.trim().length > 0)
    .slice(0, 40);
  if (lines.length === 0) return ',';

  let best = ',';
  let bestScore = -1;

  for (const delimiter of DELIMITERS) {
    const counts = lines.map((line) => splitLine(line, delimiter).length);
    const frequency = new Map<number, number>();
    for (const count of counts) {
      if (count < 2) continue;
      frequency.set(count, (frequency.get(count) ?? 0) + 1);
    }

    let agreement = 0;
    let width = 0;
    for (const [count, lineCount] of frequency) {
      if (lineCount > agreement || (lineCount === agreement && count > width)) {
        agreement = lineCount;
        width = count;
      }
    }

    const score = agreement * width;
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }

  return best;
}

function splitLine(line: string, delimiter: string): string[] {
  const fields: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quoted) {
      if (character === '"') {
        if (line[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === delimiter) {
      fields.push(field);
      field = '';
    } else {
      field += character;
    }
  }

  fields.push(field);
  return fields;
}

/**
 * A number written for people — "1,234.50", "(200.00)" for a negative, "₹ 40",
 * "1 234,50" in the European style — read back as a number. Anything that is
 * not clearly numeric comes back null rather than NaN.
 */
export function parseLooseNumber(raw: string): number | null {
  let text = raw.trim();
  if (!text) return null;

  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1);
  }

  text = text.replace(/[₹$€£]|inr|rs\.?/gi, '').replace(/\s/g, '').trim();
  if (text.startsWith('-')) {
    negative = true;
    text = text.slice(1);
  }
  if (text.startsWith('+')) text = text.slice(1);

  const trailing = /(cr|dr)$/i.exec(text);
  if (trailing) {
    if (trailing[1].toLowerCase() === 'dr') negative = true;
    text = text.slice(0, -2);
  }

  if (!text || !/[0-9]/.test(text)) return null;

  // Whichever separator comes last is the decimal point; the other groups digits.
  const lastComma = text.lastIndexOf(',');
  const lastDot = text.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    text =
      lastComma > lastDot
        ? text.replace(/\./g, '').replace(',', '.')
        : text.replace(/,/g, '');
  } else if (lastComma >= 0) {
    const decimals = text.length - lastComma - 1;
    text = decimals === 3 ? text.replace(/,/g, '') : text.replace(',', '.');
  }

  if (!/^[0-9]*\.?[0-9]*$/.test(text)) return null;

  const value = Number.parseFloat(text);
  if (!Number.isFinite(value)) return null;
  return negative ? -value : value;
}

export function looksLikeDelimitedText(text: string): boolean {
  const head = text.slice(0, 4000);
  // A NUL byte means this is a binary file wearing a text extension.
  if (head.includes(String.fromCharCode(0))) return false;
  const delimiter = sniffDelimiter(head);
  return head.split(/\r\n|\r|\n/).some((line) => splitLine(line, delimiter).length >= 3);
}

/**
 * Splits delimited text into a grid. Cells that read as numbers are returned as
 * numbers so the same downstream code handles CSV and .xls identically.
 */
export function readCsvGrid(text: string): Cell[][] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const delimiter = sniffDelimiter(body);

  const rows: Cell[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.some((value) => value.trim().length > 0)) {
      rows.push(
        row.map((value) => {
          const trimmed = value.trim();
          if (!trimmed) return null;
          // Only a bare number becomes a number; "15/08/2026" stays text.
          if (/^[-+(]?[\d,. ]+\)?$/.test(trimmed)) {
            const parsed = parseLooseNumber(trimmed);
            if (parsed !== null) return parsed;
          }
          return trimmed;
        })
      );
    }
    row = [];
  };

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];
    if (quoted) {
      if (character === '"') {
        if (body[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === delimiter) {
      endField();
    } else if (character === '\n') {
      endRow();
    } else if (character === '\r') {
      if (body[index + 1] === '\n') index += 1;
      endRow();
    } else {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) endRow();
  return rows;
}
