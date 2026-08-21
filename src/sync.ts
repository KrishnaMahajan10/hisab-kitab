import type { SQLiteDatabase } from 'expo-sqlite';

import HisabCapture, { type RawCapture } from '../modules/hisab-capture';
import {
  createAccount,
  findAccountByLast4,
  findNearDuplicate,
  insertTransaction,
  listAccounts,
  listRules,
  type AccountKind,
} from './db/repo';
import { captureOrigin } from './labels';
import { suggestCategory } from './parse/categorize';
import {
  isSelfTransfer,
  merchantIdentity,
  NEAR_DUPLICATE_WINDOW_MS,
  parseCapture,
} from './parse/parse';

const DRAIN_LIMIT = 200;

function guessAccountKind(text: string): AccountKind {
  const lower = text.toLowerCase();
  if (lower.includes('credit card') || lower.includes('cc ')) return 'credit_card';
  if (lower.includes('debit card')) return 'debit_card';
  if (lower.includes('upi') || lower.includes('vpa')) return 'upi';
  return 'bank';
}

async function resolveAccountId(
  db: SQLiteDatabase,
  last4: string | null,
  rawText: string,
  ownedLast4: Set<string>
): Promise<number | null> {
  if (!last4) return null;
  const existing = await findAccountByLast4(db, last4);
  if (existing) return existing.id;

  const kind = guessAccountKind(rawText);
  try {
    const id = await createAccount(db, {
      name: `Card ••${last4}`,
      kind,
      last4,
    });
    // Later captures in this same batch must see the account that was just
    // created, or the second leg of a transfer would not recognise the first.
    ownedLast4.add(last4);
    return id;
  } catch {
    const retry = await findAccountByLast4(db, last4);
    if (retry) ownedLast4.add(last4);
    return retry?.id ?? null;
  }
}

export type DrainResult = { imported: number; skipped: number };

export async function drainCaptures(db: SQLiteDatabase): Promise<DrainResult> {
  let captures: RawCapture[] = [];
  try {
    captures = await HisabCapture.getPendingCaptures(DRAIN_LIMIT);
  } catch {
    return { imported: 0, skipped: 0 };
  }

  if (captures.length === 0) return { imported: 0, skipped: 0 };

  const [rules, accounts] = await Promise.all([listRules(db), listAccounts(db)]);
  const ownedLast4 = new Set(
    accounts.map((account) => account.last4).filter((last4): last4 is string => last4 !== null)
  );
  const consumedIds: number[] = [];
  let imported = 0;
  let skipped = 0;

  for (const capture of captures) {
    consumedIds.push(capture.id);

    const parsed = parseCapture(capture);
    if (!parsed) {
      skipped += 1;
      continue;
    }

    const duplicate = await findNearDuplicate(db, {
      amountPaise: parsed.amountPaise,
      direction: parsed.direction,
      merchantIdentity: merchantIdentity(parsed.merchant),
      occurredAt: parsed.occurredAt,
      origin: captureOrigin({ source: capture.source, raw_sender: capture.sender }),
      windowMs: NEAR_DUPLICATE_WINDOW_MS,
      reference: parsed.reference,
    });
    if (duplicate) {
      skipped += 1;
      continue;
    }

    // Read before resolveAccountId so the destination account is judged on
    // whether it was already yours, not on the source account it just created.
    const selfTransfer = isSelfTransfer(parsed.allLast4, ownedLast4);

    const accountId = await resolveAccountId(db, parsed.last4, capture.body, ownedLast4);
    const category = selfTransfer
      ? 'Transfers'
      : suggestCategory(parsed.merchant, capture.body, parsed.direction, rules, {
          amountPaise: parsed.amountPaise,
        });

    const inserted = await insertTransaction(db, {
      accountId,
      amountPaise: parsed.amountPaise,
      direction: parsed.direction,
      merchant: parsed.merchant,
      category,
      occurredAt: parsed.occurredAt,
      source: capture.source,
      status: 'pending',
      confidence: parsed.confidence,
      rawBody: capture.body,
      rawSender: capture.sender,
      dedupKey: parsed.dedupKey,
      reference: parsed.reference,
    });

    if (inserted) imported += 1;
    else skipped += 1;
  }

  if (consumedIds.length > 0) {
    try {
      await HisabCapture.markConsumed(consumedIds);
    } catch {
      // queue rows stay pending; next drain retries and dedup_key prevents duplicates
    }
  }

  return { imported, skipped };
}

export async function backfillLastDays(db: SQLiteDatabase, days: number): Promise<DrainResult> {
  const since = Date.now() - days * 24 * 60 * 60 * 1000;
  try {
    await HisabCapture.backfillSms(since, 2000);
  } catch {
    return { imported: 0, skipped: 0 };
  }
  return drainCaptures(db);
}
