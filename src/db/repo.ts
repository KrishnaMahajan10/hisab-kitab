import type { SQLiteDatabase } from 'expo-sqlite';

import {
  categoryFromRules,
  type CategoryRule,
  type MatchType,
  type RuleField,
} from '../parse/categorize';
import { captureOrigin, type CaptureOrigin } from '../labels';
import {
  CROSS_SOURCE_WINDOW_MS,
  isSamePayment,
  referencesMatch,
} from '../parse/parse';

export type AccountKind = 'credit_card' | 'debit_card' | 'upi' | 'cash' | 'bank';

export type Account = {
  id: number;
  name: string;
  kind: AccountKind;
  last4: string | null;
  opening_balance: number;
  credit_limit: number | null;
  statement_day: number | null;
  due_day: number | null;
  archived: number;
  created_at: number;
};

export type Transaction = {
  id: number;
  account_id: number | null;
  amount_paise: number;
  direction: 'debit' | 'credit';
  title: string | null;
  merchant: string | null;
  category: string;
  occurred_at: number;
  note: string | null;
  source: 'sms' | 'notification' | 'manual';
  status: 'pending' | 'confirmed';
  confidence: number;
  raw_body: string | null;
  raw_sender: string | null;
  dedup_key: string | null;
  reference: string | null;
  created_at: number;
};

export type TransactionWithAccount = Transaction & { account_name: string | null };

// Which categories count as money moved rather than spent is now the user's
// choice, so the totals read it from the table instead of a fixed list.
const MOVED = '(SELECT name FROM categories WHERE money_moved = 1)';

/**
 * Spending, income and the moved-but-not-spent total, all read from one pass so
 * the three always agree. The category test lives inside each CASE rather than
 * in the WHERE clause so the entry count still covers every row in the period.
 */
function totalsSelect(prefix = ''): string {
  const category = `${prefix}category`;
  const amount = `${prefix}amount_paise`;
  const direction = `${prefix}direction`;
  return `COUNT(*) AS n,
            SUM(CASE WHEN ${direction} = 'debit'  AND ${category} NOT IN ${MOVED}
                     THEN ${amount} ELSE 0 END) AS spent,
            SUM(CASE WHEN ${direction} = 'credit' AND ${category} NOT IN ${MOVED}
                     THEN ${amount} ELSE 0 END) AS earned,
            SUM(CASE WHEN ${direction} = 'debit'  AND ${category} IN ${MOVED}
                     THEN ${amount} ELSE 0 END) AS moved`;
}

export async function listAccounts(db: SQLiteDatabase): Promise<Account[]> {
  return db.getAllAsync<Account>(
    'SELECT * FROM accounts WHERE archived = 0 ORDER BY kind, name'
  );
}

export async function findAccountByLast4(
  db: SQLiteDatabase,
  last4: string
): Promise<Account | null> {
  return db.getFirstAsync<Account>(
    'SELECT * FROM accounts WHERE last4 = ? AND archived = 0 LIMIT 1',
    [last4]
  );
}

export async function findAccountByName(
  db: SQLiteDatabase,
  name: string
): Promise<Account | null> {
  return db.getFirstAsync<Account>(
    'SELECT * FROM accounts WHERE name = ? AND archived = 0 LIMIT 1',
    [name]
  );
}

export async function createAccount(
  db: SQLiteDatabase,
  input: {
    name: string;
    kind: AccountKind;
    last4?: string | null;
    openingBalance?: number;
    creditLimit?: number | null;
    statementDay?: number | null;
    dueDay?: number | null;
  }
): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO accounts
       (name, kind, last4, opening_balance, credit_limit, statement_day, due_day, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.name,
      input.kind,
      input.last4 ?? null,
      input.openingBalance ?? 0,
      input.creditLimit ?? null,
      input.statementDay ?? null,
      input.dueDay ?? null,
      Date.now(),
    ]
  );
  return result.lastInsertRowId;
}

export async function insertTransaction(
  db: SQLiteDatabase,
  input: {
    accountId: number | null;
    amountPaise: number;
    direction: 'debit' | 'credit';
    title?: string | null;
    merchant: string | null;
    category: string;
    occurredAt: number;
    note?: string | null;
    source: 'sms' | 'notification' | 'manual';
    status: 'pending' | 'confirmed';
    confidence?: number;
    rawBody?: string | null;
    rawSender?: string | null;
    dedupKey: string;
    reference?: string | null;
  }
): Promise<boolean> {
  const result = await db.runAsync(
    `INSERT OR IGNORE INTO transactions
       (account_id, amount_paise, direction, title, merchant, category, occurred_at, note,
        source, status, confidence, raw_body, raw_sender, dedup_key, reference, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.accountId,
      input.amountPaise,
      input.direction,
      input.title ?? null,
      input.merchant,
      input.category,
      input.occurredAt,
      input.note ?? null,
      input.source,
      input.status,
      input.confidence ?? 1,
      input.rawBody ?? null,
      input.rawSender ?? null,
      input.dedupKey,
      input.reference ?? null,
      Date.now(),
    ]
  );
  return result.changes > 0;
}

export async function findNearDuplicate(
  db: SQLiteDatabase,
  input: {
    amountPaise: number;
    direction: 'debit' | 'credit';
    merchantIdentity: string | null;
    occurredAt: number;
    origin: CaptureOrigin;
    windowMs: number;
    crossSourceWindowMs?: number;
    reference?: string | null;
  }
): Promise<Transaction | null> {
  // A matching payment reference is proof of the same payment regardless of how
  // the merchant was spelled or how far apart the two sources timestamped it.
  if (input.reference) {
    const byReference = await db.getAllAsync<Transaction>(
      'SELECT * FROM transactions WHERE reference IS NOT NULL AND amount_paise = ? AND direction = ?',
      [input.amountPaise, input.direction]
    );
    const hit = byReference.find((candidate) =>
      referencesMatch(candidate.reference, input.reference ?? null)
    );
    if (hit) return hit;
  }

  // Rows from another source can sit hours away, so the query has to reach that
  // far even though most matches are decided inside the tight window.
  const crossSourceWindowMs = input.crossSourceWindowMs ?? CROSS_SOURCE_WINDOW_MS;
  const searchMs = Math.max(input.windowMs, crossSourceWindowMs);

  const candidates = await db.getAllAsync<Transaction>(
    `SELECT * FROM transactions
      WHERE amount_paise = ?
        AND direction = ?
        AND occurred_at BETWEEN ? AND ?
      ORDER BY ABS(occurred_at - ?) ASC`,
    [
      input.amountPaise,
      input.direction,
      input.occurredAt - searchMs,
      input.occurredAt + searchMs,
      input.occurredAt,
    ]
  );

  const normalize = (value: string | null): string | null => {
    if (!value) return null;
    const cleaned = value.toLowerCase().replace(/[^a-z0-9]/g, '');
    return cleaned.length >= 3 ? cleaned : null;
  };

  const incoming = {
    occurredAt: input.occurredAt,
    merchantIdentity: input.merchantIdentity,
    origin: input.origin,
  };

  for (const candidate of candidates) {
    const match = isSamePayment(
      {
        occurredAt: candidate.occurred_at,
        // A hand-entered row has no parsed merchant; its title is the payee, and
        // without it every manual row would match on amount and time alone.
        merchantIdentity: normalize(candidate.merchant ?? candidate.title),
        origin: captureOrigin(candidate),
      },
      incoming,
      input.windowMs,
      crossSourceWindowMs
    );
    if (match) return candidate;
  }
  return null;
}

export async function listPending(db: SQLiteDatabase): Promise<TransactionWithAccount[]> {
  return db.getAllAsync<TransactionWithAccount>(
    `SELECT t.*, a.name AS account_name
       FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.status = 'pending'
      ORDER BY t.occurred_at DESC`
  );
}

export async function countPending(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    "SELECT COUNT(*) AS n FROM transactions WHERE status = 'pending'"
  );
  return row?.n ?? 0;
}


export type HistoryFilter = {
  search?: string;
  source?: 'all' | 'sms' | 'notification' | 'statement' | 'manual';
  from?: number | null;
  to?: number | null;
  categories?: string[];
  limit: number;
  offset: number;
};

function buildHistoryWhere(
  filter: Omit<HistoryFilter, 'limit' | 'offset'>
): { sql: string; params: Array<string | number> } {
  const clauses = ["t.status = 'confirmed'"];
  const params: Array<string | number> = [];

  const search = filter.search?.trim();
  if (search) {
    clauses.push(
      '(t.title LIKE ? OR t.merchant LIKE ? OR t.note LIKE ? OR t.category LIKE ?)'
    );
    const like = `%${search}%`;
    params.push(like, like, like, like);
  }

  switch (filter.source) {
    case 'sms':
      clauses.push("t.source = 'sms'");
      break;
    case 'notification':
      clauses.push("t.source = 'notification'");
      break;
    case 'statement':
      clauses.push("t.raw_sender LIKE 'statement:%'");
      break;
    case 'manual':
      clauses.push(
        "t.source = 'manual' AND (t.raw_sender IS NULL OR t.raw_sender NOT LIKE 'statement:%')"
      );
      break;
    default:
      break;
  }

  // Half-open range so a midnight transaction lands in exactly one period.
  if (typeof filter.from === 'number') {
    clauses.push('t.occurred_at >= ?');
    params.push(filter.from);
  }
  if (typeof filter.to === 'number') {
    clauses.push('t.occurred_at < ?');
    params.push(filter.to);
  }

  // An empty list means "no category filter", not "match nothing".
  if (filter.categories && filter.categories.length > 0) {
    const placeholders = filter.categories.map(() => '?').join(',');
    clauses.push(`t.category IN (${placeholders})`);
    params.push(...filter.categories);
  }

  return { sql: clauses.join(' AND '), params };
}

export async function listHistory(
  db: SQLiteDatabase,
  filter: HistoryFilter
): Promise<TransactionWithAccount[]> {
  const where = buildHistoryWhere(filter);
  return db.getAllAsync<TransactionWithAccount>(
    `SELECT t.*, a.name AS account_name
       FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id
      WHERE ${where.sql}
      ORDER BY t.occurred_at DESC, t.id DESC
      LIMIT ? OFFSET ?`,
    [...where.params, filter.limit, filter.offset]
  );
}

export async function historySummary(
  db: SQLiteDatabase,
  filter: Omit<HistoryFilter, 'limit' | 'offset'>
): Promise<{ count: number; spent: number; earned: number; moved: number }> {
  const where = buildHistoryWhere(filter);
  const row = await db.getFirstAsync<{
    n: number;
    spent: number | null;
    earned: number | null;
    moved: number | null;
  }>(
    `SELECT ${totalsSelect('t.')}
       FROM transactions t
      WHERE ${where.sql}`,
    where.params
  );
  return {
    count: row?.n ?? 0,
    spent: row?.spent ?? 0,
    earned: row?.earned ?? 0,
    moved: row?.moved ?? 0,
  };
}

export async function updateTransaction(
  db: SQLiteDatabase,
  id: number,
  patch: {
    accountId: number | null;
    amountPaise: number;
    direction: 'debit' | 'credit';
    title: string | null;
    merchant: string | null;
    category: string;
    occurredAt: number;
    note: string | null;
  }
): Promise<void> {
  await db.runAsync(
    `UPDATE transactions
        SET account_id = ?,
            amount_paise = ?,
            direction = ?,
            title = ?,
            merchant = ?,
            category = ?,
            occurred_at = ?,
            note = ?
      WHERE id = ?`,
    [
      patch.accountId,
      patch.amountPaise,
      patch.direction,
      patch.title,
      patch.merchant,
      patch.category,
      patch.occurredAt,
      patch.note,
      id,
    ]
  );
}

export async function confirmTransaction(
  db: SQLiteDatabase,
  id: number,
  patch: {
    accountId: number | null;
    category: string;
    amountPaise: number;
    direction: 'debit' | 'credit';
    title: string | null;
    merchant: string | null;
    note: string | null;
  }
): Promise<void> {
  await db.runAsync(
    `UPDATE transactions
        SET status = 'confirmed',
            account_id = ?,
            category = ?,
            amount_paise = ?,
            direction = ?,
            title = ?,
            merchant = ?,
            note = ?
      WHERE id = ?`,
    [
      patch.accountId,
      patch.category,
      patch.amountPaise,
      patch.direction,
      patch.title,
      patch.merchant,
      patch.note,
      id,
    ]
  );
}

export async function deleteTransaction(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM transactions WHERE id = ?', [id]);
}

type RuleRow = {
  id: number;
  pattern: string;
  category: string;
  field: RuleField;
  match_type: MatchType;
  direction: 'debit' | 'credit' | null;
  min_paise: number | null;
  max_paise: number | null;
  priority: number;
  enabled: number;
  origin: 'learned' | 'manual';
  hits: number;
};

function toRule(row: RuleRow): CategoryRule {
  return {
    id: row.id,
    pattern: row.pattern,
    category: row.category,
    field: row.field,
    matchType: row.match_type,
    direction: row.direction,
    minPaise: row.min_paise,
    maxPaise: row.max_paise,
    priority: row.priority,
    enabled: row.enabled !== 0,
    origin: row.origin,
    hits: row.hits,
  };
}

const RULE_COLUMNS =
  'id, pattern, category, field, match_type, direction, min_paise, max_paise, priority, enabled, origin, hits';

/**
 * Records the correction the user just made as a rule. Learned rules are always
 * the simple shape — a merchant word, matched anywhere — so one is only ever
 * created or updated per pattern, leaving the rules the user wrote by hand
 * untouched.
 */
export async function learnRule(
  db: SQLiteDatabase,
  pattern: string,
  category: string
): Promise<void> {
  const existing = await db.getFirstAsync<{ id: number }>(
    `SELECT id FROM category_rules
      WHERE pattern = ? AND origin = 'learned' AND field = 'any' AND match_type = 'contains'
      LIMIT 1`,
    [pattern]
  );

  if (existing) {
    await db.runAsync(
      'UPDATE category_rules SET category = ?, hits = hits + 1 WHERE id = ?',
      [category, existing.id]
    );
    return;
  }

  await db.runAsync(
    `INSERT INTO category_rules (pattern, category, origin, hits, created_at)
     VALUES (?, ?, 'learned', 1, ?)`,
    [pattern, category, Date.now()]
  );
}

export async function listRules(db: SQLiteDatabase): Promise<CategoryRule[]> {
  const rows = await db.getAllAsync<RuleRow>(
    `SELECT ${RULE_COLUMNS} FROM category_rules ORDER BY priority, hits DESC, id`
  );
  return rows.map(toRule);
}

export type RuleInput = {
  pattern: string;
  category: string;
  field: RuleField;
  matchType: MatchType;
  direction: 'debit' | 'credit' | null;
  minPaise: number | null;
  maxPaise: number | null;
  priority: number;
  enabled: boolean;
};

export async function createRule(db: SQLiteDatabase, input: RuleInput): Promise<number> {
  const result = await db.runAsync(
    `INSERT INTO category_rules
       (pattern, category, field, match_type, direction, min_paise, max_paise,
        priority, enabled, origin, hits, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', 0, ?)`,
    [
      input.pattern,
      input.category,
      input.field,
      input.matchType,
      input.direction,
      input.minPaise,
      input.maxPaise,
      input.priority,
      input.enabled ? 1 : 0,
      Date.now(),
    ]
  );
  return result.lastInsertRowId;
}

/**
 * Editing a learned rule makes it the user's own: they have taken charge of it,
 * and a later correction elsewhere must not silently rewrite their version.
 */
export async function updateRule(
  db: SQLiteDatabase,
  id: number,
  input: RuleInput
): Promise<void> {
  await db.runAsync(
    `UPDATE category_rules
        SET pattern = ?, category = ?, field = ?, match_type = ?, direction = ?,
            min_paise = ?, max_paise = ?, priority = ?, enabled = ?, origin = 'manual'
      WHERE id = ?`,
    [
      input.pattern,
      input.category,
      input.field,
      input.matchType,
      input.direction,
      input.minPaise,
      input.maxPaise,
      input.priority,
      input.enabled ? 1 : 0,
      id,
    ]
  );
}

export async function setRuleEnabled(
  db: SQLiteDatabase,
  id: number,
  enabled: boolean
): Promise<void> {
  await db.runAsync('UPDATE category_rules SET enabled = ? WHERE id = ?', [
    enabled ? 1 : 0,
    id,
  ]);
}

export async function deleteRule(db: SQLiteDatabase, id: number): Promise<void> {
  await db.runAsync('DELETE FROM category_rules WHERE id = ?', [id]);
}

/**
 * Re-runs the rules over transactions already stored. A new rule is close to
 * useless if it only affects what arrives next, and the preview counts let the
 * user see the damage before agreeing to it.
 */
export async function applyRulesToExisting(
  db: SQLiteDatabase,
  options: { includeConfirmed: boolean; dryRun: boolean }
): Promise<{ examined: number; changed: number }> {
  const rules = await listRules(db);
  if (rules.length === 0) return { examined: 0, changed: 0 };

  const rows = await db.getAllAsync<Transaction>(
    options.includeConfirmed
      ? 'SELECT * FROM transactions'
      : "SELECT * FROM transactions WHERE status = 'pending'"
  );

  let changed = 0;
  const updates: Array<{ id: number; category: string }> = [];

  for (const row of rows) {
    const matched = categoryFromRules(rules, {
      merchant: row.merchant,
      title: row.title,
      note: row.note,
      rawText: row.raw_body ?? '',
      direction: row.direction,
      amountPaise: row.amount_paise,
    });
    if (!matched || matched.category === row.category) continue;
    changed += 1;
    updates.push({ id: row.id, category: matched.category });
  }

  if (!options.dryRun && updates.length > 0) {
    await db.withTransactionAsync(async () => {
      for (const update of updates) {
        await db.runAsync('UPDATE transactions SET category = ? WHERE id = ?', [
          update.category,
          update.id,
        ]);
      }
    });
  }

  return { examined: rows.length, changed };
}

export type RangeSummary = {
  count: number;
  spent: number;
  earned: number;
  moved: number;
  byCategory: Array<{ category: string; total: number }>;
  byAccount: Array<{ account_name: string | null; total: number }>;
};

function rangeClause(
  from: number | null,
  to: number | null,
  column = 'occurred_at'
): { sql: string; params: number[] } {
  const clauses: string[] = [];
  const params: number[] = [];
  if (typeof from === 'number') {
    clauses.push(`${column} >= ?`);
    params.push(from);
  }
  if (typeof to === 'number') {
    clauses.push(`${column} < ?`);
    params.push(to);
  }
  return { sql: clauses.length ? ` AND ${clauses.join(' AND ')}` : '', params };
}

export async function rangeSummary(
  db: SQLiteDatabase,
  from: number | null,
  to: number | null
): Promise<RangeSummary> {
  const plain = rangeClause(from, to);
  const prefixed = rangeClause(from, to, 't.occurred_at');

  const totals = await db.getFirstAsync<{
    n: number;
    spent: number | null;
    earned: number | null;
    moved: number | null;
  }>(
    `SELECT ${totalsSelect()}
       FROM transactions
      WHERE status = 'confirmed'${plain.sql}`,
    plain.params
  );

  // The breakdowns answer "where did my money go", so a relocation of your own
  // money would only crowd out the categories you actually spent in.
  const byCategory = await db.getAllAsync<{ category: string; total: number }>(
    `SELECT category, SUM(amount_paise) AS total
       FROM transactions
      WHERE status = 'confirmed'
        AND direction = 'debit'
        AND category NOT IN ${MOVED}${plain.sql}
      GROUP BY category
      ORDER BY total DESC`,
    plain.params
  );

  const byAccount = await db.getAllAsync<{ account_name: string | null; total: number }>(
    `SELECT a.name AS account_name, SUM(t.amount_paise) AS total
       FROM transactions t
       LEFT JOIN accounts a ON a.id = t.account_id
      WHERE t.status = 'confirmed'
        AND t.direction = 'debit'
        AND t.category NOT IN ${MOVED}${prefixed.sql}
      GROUP BY a.name
      ORDER BY total DESC`,
    prefixed.params
  );

  return {
    count: totals?.n ?? 0,
    spent: totals?.spent ?? 0,
    earned: totals?.earned ?? 0,
    moved: totals?.moved ?? 0,
    byCategory,
    byAccount,
  };
}

export async function getSetting(
  db: SQLiteDatabase,
  key: string
): Promise<string | null> {
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM settings WHERE key = ?',
    [key]
  );
  return row?.value ?? null;
}

export async function setSetting(
  db: SQLiteDatabase,
  key: string,
  value: string
): Promise<void> {
  await db.runAsync(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value]
  );
}

export type CategoryKind = 'expense' | 'income' | 'both';

export type CategoryRecord = {
  id: number;
  name: string;
  kind: CategoryKind;
  moneyMoved: boolean;
  archived: boolean;
  sortOrder: number;
  builtin: boolean;
};

type CategoryRow = {
  id: number;
  name: string;
  kind: CategoryKind;
  money_moved: number;
  archived: number;
  sort_order: number;
  builtin: number;
};

function toCategory(row: CategoryRow): CategoryRecord {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    moneyMoved: row.money_moved !== 0,
    archived: row.archived !== 0,
    sortOrder: row.sort_order,
    builtin: row.builtin !== 0,
  };
}

export async function listCategories(db: SQLiteDatabase): Promise<CategoryRecord[]> {
  const rows = await db.getAllAsync<CategoryRow>(
    'SELECT id, name, kind, money_moved, archived, sort_order, builtin FROM categories ORDER BY sort_order, name'
  );
  return rows.map(toCategory);
}

/** Trimmed and collapsed, so "  Pet   food " and "Pet food" cannot both exist. */
export function normalizeCategoryName(raw: string): string {
  return raw.replace(/\s+/g, ' ').trim();
}

export async function createCategory(
  db: SQLiteDatabase,
  input: { name: string; kind: CategoryKind; moneyMoved: boolean }
): Promise<number> {
  const name = normalizeCategoryName(input.name);
  const last = await db.getFirstAsync<{ next: number }>(
    'SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM categories'
  );
  const result = await db.runAsync(
    `INSERT INTO categories (name, kind, money_moved, sort_order, builtin, created_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
    [name, input.kind, input.moneyMoved ? 1 : 0, last?.next ?? 1, Date.now()]
  );
  return result.lastInsertRowId;
}

/**
 * Renames a category everywhere at once. Transactions and rules store the name
 * as text, so a rename that touched only this table would orphan every row
 * already filed under the old name.
 */
export async function renameCategory(
  db: SQLiteDatabase,
  id: number,
  rawName: string
): Promise<{ transactions: number; rules: number }> {
  const name = normalizeCategoryName(rawName);
  const current = await db.getFirstAsync<{ name: string }>(
    'SELECT name FROM categories WHERE id = ?',
    [id]
  );
  if (!current) throw new Error('That category no longer exists');
  if (current.name === name) return { transactions: 0, rules: 0 };

  const clash = await db.getFirstAsync<{ id: number }>(
    'SELECT id FROM categories WHERE name = ? AND id <> ?',
    [name, id]
  );
  if (clash) throw new Error(`"${name}" already exists`);

  let transactions = 0;
  let rules = 0;
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE categories SET name = ? WHERE id = ?', [name, id]);
    const movedTxns = await db.runAsync(
      'UPDATE transactions SET category = ? WHERE category = ?',
      [name, current.name]
    );
    const movedRules = await db.runAsync(
      'UPDATE category_rules SET category = ? WHERE category = ?',
      [name, current.name]
    );
    transactions = movedTxns.changes;
    rules = movedRules.changes;
  });

  return { transactions, rules };
}

export async function updateCategoryFlags(
  db: SQLiteDatabase,
  id: number,
  input: { kind: CategoryKind; moneyMoved: boolean }
): Promise<void> {
  await db.runAsync('UPDATE categories SET kind = ?, money_moved = ? WHERE id = ?', [
    input.kind,
    input.moneyMoved ? 1 : 0,
    id,
  ]);
}

export async function setCategoryArchived(
  db: SQLiteDatabase,
  id: number,
  archived: boolean
): Promise<void> {
  await db.runAsync('UPDATE categories SET archived = ? WHERE id = ?', [archived ? 1 : 0, id]);
}

export async function countCategoryUsage(
  db: SQLiteDatabase,
  name: string
): Promise<{ transactions: number; rules: number }> {
  const txns = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM transactions WHERE category = ?',
    [name]
  );
  const rules = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM category_rules WHERE category = ?',
    [name]
  );
  return { transactions: txns?.n ?? 0, rules: rules?.n ?? 0 };
}

/**
 * Only ever removes a category nothing points at. A category still in use is
 * hidden instead, because deleting it would leave transactions filed under a
 * name the app no longer knows.
 */
export async function deleteCategory(db: SQLiteDatabase, id: number): Promise<void> {
  const row = await db.getFirstAsync<{ name: string; builtin: number }>(
    'SELECT name, builtin FROM categories WHERE id = ?',
    [id]
  );
  if (!row) return;

  const usage = await countCategoryUsage(db, row.name);
  if (usage.transactions > 0 || usage.rules > 0) {
    throw new Error('This category is still in use — hide it instead.');
  }
  await db.runAsync('DELETE FROM categories WHERE id = ?', [id]);
}
