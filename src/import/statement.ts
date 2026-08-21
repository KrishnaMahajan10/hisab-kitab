import type { SQLiteDatabase } from 'expo-sqlite';

import { File } from 'expo-file-system';

import HisabCapture, { type PdfExtractErrorCode } from '../../modules/hisab-capture';
import {
  createAccount,
  findAccountByLast4,
  findAccountByName,
  findNearDuplicate,
  insertTransaction,
  listRules,
} from '../db/repo';
import { suggestCategory } from '../parse/categorize';
import { CROSS_SOURCE_WINDOW_MS, NEAR_DUPLICATE_WINDOW_MS } from '../parse/parse';
import type { Cell } from './biff';
import { looksLikeXls, readXlsSheets } from './biff';
import { looksLikeDelimitedText, readCsvGrid } from './csv';
import {
  looksLikePhonePeStatement,
  maskDigits,
  parsePhonePeStatement,
  type StatementRow,
} from './phonepe';
import { parseTable, type TableParseResult } from './table';

export const STATEMENT_MIME_TYPES = [
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
  'text/comma-separated-values',
  'text/tab-separated-values',
  'text/plain',
  'application/octet-stream',
];

export type ImportOutcome =
  | { status: 'ok'; imported: number; duplicates: number; unparsed: number; format: string }
  | { status: 'needs-password' }
  | { status: 'unsupported'; preview: string }
  | { status: 'error'; code: PdfExtractErrorCode | 'unknown'; message: string };

async function resolveAccount(
  db: SQLiteDatabase,
  mask: string | null
): Promise<number | null> {
  const digits = maskDigits(mask);
  if (!digits) return null;

  if (digits.length === 4) {
    const existing = await findAccountByLast4(db, digits);
    if (existing) return existing.id;
    try {
      return await createAccount(db, { name: `Card ••${digits}`, kind: 'debit_card', last4: digits });
    } catch {
      const retry = await findAccountByLast4(db, digits);
      return retry?.id ?? null;
    }
  }

  const name = `UPI ••${digits}`;
  const existing = await findAccountByName(db, name);
  if (existing) return existing.id;
  try {
    return await createAccount(db, { name, kind: 'upi', last4: null });
  } catch {
    const retry = await findAccountByName(db, name);
    return retry?.id ?? null;
  }
}

async function insertRows(
  db: SQLiteDatabase,
  rows: StatementRow[],
  format: string
): Promise<{ imported: number; duplicates: number }> {
  const rules = await listRules(db);
  let imported = 0;
  let duplicates = 0;

  for (const row of rows) {
    const merchantIdentity = row.merchant
      ? row.merchant.toLowerCase().replace(/[^a-z0-9]/g, '') || null
      : null;

    // A date-only row carries no clock time to compare, so it has nothing to
    // gain from the tight window and relies entirely on the cross-source rule.
    if (row.reference || row.hasExactTime || merchantIdentity) {
      const duplicate = await findNearDuplicate(db, {
        amountPaise: row.amountPaise,
        direction: row.direction,
        merchantIdentity,
        occurredAt: row.occurredAt,
        origin: 'statement',
        windowMs: row.hasExactTime ? NEAR_DUPLICATE_WINDOW_MS : 0,
        crossSourceWindowMs: CROSS_SOURCE_WINDOW_MS,
        reference: row.reference,
      });
      if (duplicate) {
        duplicates += 1;
        continue;
      }
    }

    const accountId = await resolveAccount(db, row.accountMask);
    const category = suggestCategory(row.merchant, row.rawLine, row.direction, rules, {
      amountPaise: row.amountPaise,
    });
    const dedupKey = row.reference
      ? `stmt|${format}|${row.reference}`
      : `stmt|${format}|${row.occurredAt}|${row.amountPaise}|${merchantIdentity ?? 'x'}`;

    const inserted = await insertTransaction(db, {
      accountId,
      amountPaise: row.amountPaise,
      direction: row.direction,
      merchant: row.merchant,
      category,
      occurredAt: row.occurredAt,
      source: 'manual',
      status: 'pending',
      confidence: row.merchant ? 1 : 0.6,
      rawBody: row.rawLine,
      rawSender: `statement:${format}`,
      dedupKey,
      reference: row.reference,
    });

    if (inserted) imported += 1;
    else duplicates += 1;
  }

  return { imported, duplicates };
}

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04];

function looksLikeZip(bytes: Uint8Array): boolean {
  return ZIP_SIGNATURE.every((byte, index) => bytes[index] === byte);
}

/**
 * Imports a statement from a spreadsheet or delimited file. The format is decided
 * by content rather than by the file name: banks hand out .xls files that are
 * really CSV, and .txt files that are really tab-separated.
 */
async function importTabularStatement(
  db: SQLiteDatabase,
  uri: string
): Promise<ImportOutcome> {
  let grids: Cell[][][];

  try {
    const file = new File(uri);
    const bytes = await file.bytes();

    if (looksLikeZip(bytes)) {
      return {
        status: 'unsupported',
        preview:
          'This is a .xlsx workbook, which is a compressed archive. Re-save it as "Excel 97-2003 (.xls)" or as CSV and import that.',
      };
    }

    if (looksLikeXls(bytes)) {
      grids = readXlsSheets(bytes).map((sheet) => sheet.rows);
    } else {
      const text = await file.text();
      if (!looksLikeDelimitedText(text)) {
        return {
          status: 'unsupported',
          preview: text.slice(0, 220) || 'The file held no readable rows.',
        };
      }
      grids = [readCsvGrid(text)];
    }
  } catch (error) {
    return { status: 'error', code: 'unknown', message: String(error) };
  }

  // A workbook may carry the statement on any sheet, with empty ones alongside.
  let parsed: TableParseResult | null = null;
  for (const grid of grids) {
    const attempt = parseTable(grid);
    if (attempt.rows.length > 0) {
      parsed = attempt;
      break;
    }
    if (!parsed && attempt.columns) parsed = attempt;
  }

  if (!parsed || !parsed.columns) {
    return {
      status: 'unsupported',
      preview:
        'No transaction table found. The file needs a header row naming a date column and either a debit/credit pair or an amount column.',
    };
  }

  if (parsed.rows.length === 0) {
    return {
      status: 'error',
      code: 'parse',
      message: `Found the table but read no transactions from it. ${parsed.skipped} rows were skipped.`,
    };
  }

  const { imported, duplicates } = await insertRows(db, parsed.rows, 'table');

  return {
    status: 'ok',
    imported,
    duplicates,
    unparsed: parsed.skipped,
    format: 'table',
  };
}

/**
 * Entry point for every statement file. PDFs go to the native text extractor and
 * the PhonePe parser; everything else is read as a table.
 */
export async function importStatementFile(
  db: SQLiteDatabase,
  uri: string,
  fileName: string | null,
  password: string | null
): Promise<ImportOutcome> {
  const name = (fileName ?? uri).toLowerCase();
  if (name.endsWith('.pdf')) return importStatementPdf(db, uri, password);
  return importTabularStatement(db, uri);
}

export async function importStatementPdf(
  db: SQLiteDatabase,
  uri: string,
  password: string | null
): Promise<ImportOutcome> {
  let extracted;
  try {
    extracted = await HisabCapture.extractPdfText(uri, password);
  } catch (error) {
    return { status: 'error', code: 'unknown', message: String(error) };
  }

  if (!extracted.ok || !extracted.text) {
    if (extracted.error === 'password') return { status: 'needs-password' };
    return {
      status: 'error',
      code: extracted.error ?? 'unknown',
      message: extracted.message ?? 'Could not read the PDF',
    };
  }

  const text = extracted.text;

  if (!looksLikePhonePeStatement(text)) {
    const preview = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 6)
      .join(' | ');
    return { status: 'unsupported', preview };
  }

  const parsed = parsePhonePeStatement(text);
  if (parsed.rows.length === 0) {
    const preview = text
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, 14)
      .map((line, index) => `${index}: ${line}`)
      .join('\n');
    return {
      status: 'error',
      code: 'parse',
      message: `No transactions found.\n\nExtracted lines:\n${preview.slice(0, 700)}`,
    };
  }

  const { imported, duplicates } = await insertRows(db, parsed.rows, parsed.format);

  return {
    status: 'ok',
    imported,
    duplicates,
    unparsed: parsed.skipped,
    format: parsed.format,
  };
}
