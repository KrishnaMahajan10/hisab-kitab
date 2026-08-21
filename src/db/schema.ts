import type { SQLiteDatabase } from 'expo-sqlite';

import { extractReference } from '../parse/parse';

export const DATABASE_NAME = 'hisab.db';
const DATABASE_VERSION = 7;

export const EXPENSE_CATEGORIES = [
  'Food & Dining',
  'Groceries',
  'Transport',
  'Fuel',
  'Travel',
  'Shopping',
  'Clothing',
  'Electronics',
  'Bills & Utilities',
  'Mobile & Internet',
  'Rent',
  'Household',
  'Domestic Help',
  'Health',
  'Fitness',
  'Personal Care',
  'Education',
  'Kids & Family',
  'Pets',
  'Entertainment',
  'Subscriptions',
  'Insurance',
  'Loan & EMI',
  'Credit Card Payment',
  'Taxes & Fees',
  'Bank Charges',
  'Gifts & Donations',
  'Cash Withdrawal',
  'Investments',
  'Transfers',
  'Other',
] as const;

export const INCOME_CATEGORIES = [
  'Salary',
  'Freelance',
  'Business',
  'Interest & Dividends',
  'Refunds & Cashback',
  'Rent Received',
  'Gifts Received',
  'Investments',
  'Transfers',
  'Other Income',
] as const;

/**
 * Categories where money moves rather than leaves. Sending cash to your own
 * second account, paying off a card whose spends are already recorded, or
 * pulling notes out of an ATM are all relocations of your own money: counting
 * them as spending would inflate every total, and counting the receiving leg of
 * a self-transfer as income would inflate that too.
 *
 * The rows are still kept and still shown — only the totals ignore them.
 */
export const MONEY_MOVED_CATEGORIES = [
  'Transfers',
  'Credit Card Payment',
  'Cash Withdrawal',
] as const;

const MONEY_MOVED_SET = new Set<string>(MONEY_MOVED_CATEGORIES);

export function isMoneyMoved(category: string): boolean {
  return MONEY_MOVED_SET.has(category);
}

export const CATEGORIES = Array.from(
  new Set<string>([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES])
);

export type Category = (typeof EXPENSE_CATEGORIES)[number] | (typeof INCOME_CATEGORIES)[number];

const INCOME_CATEGORY_SET = new Set<string>(INCOME_CATEGORIES);

export function isIncomeCategory(category: string): boolean {
  return INCOME_CATEGORY_SET.has(category);
}

/**
 * The lists above are now seed data only: they populate the categories table on
 * first run, and nothing reads them at runtime. Pickers use the live list from
 * the categories context instead.
 */

export async function migrate(db: SQLiteDatabase): Promise<void> {
  await db.execAsync('PRAGMA journal_mode = WAL');
  await db.execAsync('PRAGMA foreign_keys = ON');

  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;

  if (current >= DATABASE_VERSION) return;

  if (current < 1) {
    await db.execAsync(`
      CREATE TABLE accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('credit_card','debit_card','upi','cash','bank')),
        last4 TEXT,
        opening_balance INTEGER NOT NULL DEFAULT 0,
        credit_limit INTEGER,
        statement_day INTEGER,
        due_day INTEGER,
        archived INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE UNIQUE INDEX idx_accounts_last4
        ON accounts (last4, kind) WHERE last4 IS NOT NULL;

      CREATE TABLE transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
        amount_paise INTEGER NOT NULL CHECK (amount_paise > 0),
        direction TEXT NOT NULL CHECK (direction IN ('debit','credit')),
        merchant TEXT,
        category TEXT NOT NULL DEFAULT 'Other',
        occurred_at INTEGER NOT NULL,
        note TEXT,
        source TEXT NOT NULL CHECK (source IN ('sms','notification','manual')),
        status TEXT NOT NULL CHECK (status IN ('pending','confirmed')),
        confidence REAL NOT NULL DEFAULT 1,
        raw_body TEXT,
        raw_sender TEXT,
        dedup_key TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX idx_txn_status ON transactions (status, occurred_at DESC);
      CREATE INDEX idx_txn_occurred ON transactions (occurred_at DESC);
      CREATE INDEX idx_txn_account ON transactions (account_id, occurred_at DESC);

      CREATE TABLE category_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT NOT NULL UNIQUE,
        category TEXT NOT NULL,
        hits INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);

    await db.runAsync(
      `INSERT INTO accounts (name, kind, last4, opening_balance, created_at)
       VALUES (?, 'cash', NULL, 0, ?)`,
      ['Cash', Date.now()]
    );
  }

  if (current < 2) {
    await db.runAsync(
      "UPDATE transactions SET category = 'Other Income' WHERE category = 'Income'"
    );
    await db.runAsync(
      "UPDATE category_rules SET category = 'Other Income' WHERE category = 'Income'"
    );
  }

  if (current < 3) {
    await db.execAsync('ALTER TABLE transactions ADD COLUMN reference TEXT');
    await db.execAsync('CREATE INDEX idx_txn_reference ON transactions (reference)');

    // Statement rows already carried the bank reference inside dedup_key
    // ("stmt|<format>|<utr>"). Lift it into the new column so cross-source
    // matching works for rows imported before this migration.
    const legacy = await db.getAllAsync<{ id: number; dedup_key: string }>(
      "SELECT id, dedup_key FROM transactions WHERE dedup_key LIKE 'stmt|%'"
    );
    for (const row of legacy) {
      const segments = row.dedup_key.split('|');
      const reference = segments[2];
      if (reference && /^[A-Za-z0-9]{6,}$/.test(reference)) {
        await db.runAsync('UPDATE transactions SET reference = ? WHERE id = ?', [
          reference,
          row.id,
        ]);
      }
    }
  }

  if (current < 4) {
    // Rows captured before the reference patterns learned the "UPI/DR/<utr>"
    // and "UPI:<utr>" shapes stored no reference, so cross-source matching had
    // nothing to match on. The original message is still in raw_body, so re-run
    // extraction over it rather than leaving those references lost.
    const unreferenced = await db.getAllAsync<{ id: number; raw_body: string }>(
      'SELECT id, raw_body FROM transactions WHERE reference IS NULL AND raw_body IS NOT NULL'
    );
    for (const row of unreferenced) {
      const reference = extractReference(row.raw_body);
      if (reference) {
        await db.runAsync('UPDATE transactions SET reference = ? WHERE id = ?', [
          reference,
          row.id,
        ]);
      }
    }
  }

  if (current < 5) {
    // A title the user can edit, kept separate from the parsed merchant so
    // renaming a row never destroys what the bank actually said. Null means
    // "no title yet" and the merchant is shown instead.
    await db.execAsync('ALTER TABLE transactions ADD COLUMN title TEXT');
  }

  if (current < 6) {
    // Rules grow from "this merchant means this category" into conditions the
    // user writes: which field to look at, how to match it, and optional
    // direction and amount bounds. The table is rebuilt rather than altered
    // because the old UNIQUE on pattern would stop you writing two rules for
    // the same word that differ only by amount.
    await db.execAsync(`
      CREATE TABLE category_rules_v6 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pattern TEXT NOT NULL,
        category TEXT NOT NULL,
        field TEXT NOT NULL DEFAULT 'any'
          CHECK (field IN ('any','merchant','title','note')),
        match_type TEXT NOT NULL DEFAULT 'contains'
          CHECK (match_type IN ('contains','starts_with','ends_with','equals','regex')),
        direction TEXT CHECK (direction IN ('debit','credit')),
        min_paise INTEGER,
        max_paise INTEGER,
        priority INTEGER NOT NULL DEFAULT 100,
        enabled INTEGER NOT NULL DEFAULT 1,
        origin TEXT NOT NULL DEFAULT 'learned' CHECK (origin IN ('learned','manual')),
        hits INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER NOT NULL
      );

      INSERT INTO category_rules_v6 (pattern, category, hits, created_at)
        SELECT pattern, category, hits, created_at FROM category_rules;

      DROP TABLE category_rules;
    `);
    await db.execAsync('ALTER TABLE category_rules_v6 RENAME TO category_rules');

    // Rules are read on every capture and every imported row, always in the
    // same order.
    await db.execAsync(`
      CREATE INDEX idx_rules_order ON category_rules (enabled, priority, hits DESC)
    `);
  }

  if (current < 7) {
    // Categories move out of the code and into a table so they can be added,
    // renamed and hidden. Transactions still store the name as plain text: a
    // rename updates them in step, and a backup stays readable on its own.
    await db.execAsync(`
      CREATE TABLE categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL CHECK (kind IN ('expense','income','both')),
        money_moved INTEGER NOT NULL DEFAULT 0,
        archived INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        builtin INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX idx_categories_kind ON categories (archived, kind, sort_order);
    `);

    const now = Date.now();
    const seeded = new Map<string, 'expense' | 'income' | 'both'>();
    for (const name of EXPENSE_CATEGORIES) seeded.set(name, 'expense');
    for (const name of INCOME_CATEGORIES) {
      // A few names are offered on both sides; seeding income second would
      // otherwise hide the expense half of them.
      seeded.set(name, seeded.has(name) ? 'both' : 'income');
    }

    let order = 0;
    for (const [name, kind] of seeded) {
      await db.runAsync(
        `INSERT INTO categories (name, kind, money_moved, sort_order, builtin, created_at)
         VALUES (?, ?, ?, ?, 1, ?)`,
        [name, kind, isMoneyMoved(name) ? 1 : 0, order, now]
      );
      order += 1;
    }

    // Anything already recorded under a name the seed does not know about — a
    // hand-typed category from an old backup — is kept rather than lost.
    const orphans = await db.getAllAsync<{ category: string }>(
      'SELECT DISTINCT category FROM transactions WHERE category NOT IN (SELECT name FROM categories)'
    );
    for (const orphan of orphans) {
      await db.runAsync(
        `INSERT OR IGNORE INTO categories (name, kind, sort_order, builtin, created_at)
         VALUES (?, 'both', ?, 0, ?)`,
        [orphan.category, order, now]
      );
      order += 1;
    }
  }

  await db.execAsync(`PRAGMA user_version = ${DATABASE_VERSION}`);
}
