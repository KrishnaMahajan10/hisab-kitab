import type { SQLiteDatabase } from 'expo-sqlite';

import { applyBackup, buildBackup, parseBackup, type BackupPayload } from './payload';

let failures = 0;
const check = (label: string, condition: boolean, detail = '') => {
  if (!condition) {
    failures += 1;
    console.log(`  FAIL  ${label} ${detail}`);
  }
};

type Statement = { sql: string; params: unknown[] };

function fakeDb(userVersion: number, rows: Record<string, unknown[]>) {
  const log: Statement[] = [];
  const db = {
    getFirstAsync: async (sql: string) =>
      sql.includes('user_version') ? { user_version: userVersion } : null,
    getAllAsync: async (sql: string) => {
      const table = /FROM (\w+)/.exec(sql)?.[1] ?? '';
      return rows[table] ?? [];
    },
    execAsync: async (sql: string) => {
      log.push({ sql, params: [] });
    },
    runAsync: async (sql: string, params: unknown[] = []) => {
      log.push({ sql, params });
    },
    withTransactionAsync: async (body: () => Promise<void>) => body(),
  } as unknown as SQLiteDatabase;
  return { db, log };
}

async function main(): Promise<void> {
  console.log('\nBackup payload\n');

  const source = fakeDb(4, {
    accounts: [{ id: 1, name: 'Cash' }],
  categories: [{ id: 1, name: 'Chai & snacks', kind: 'expense', builtin: 0 }],
  people: [{ id: 1, name: 'Rahul' }],
  splits: [{ id: 1, transaction_id: 7, person_id: 1, amount_paise: 30000, direction: 'owed_to_me' }],
    transactions: [{ id: 7, amount_paise: 12300, reference: '523401' }],
    category_rules: [{ pattern: 'swiggy', category: 'Food & Dining' }],
  });

  const built = await buildBackup(source.db);
  check('format is tagged', built.format === 'hisab-backup', built.format);
  check('schema version is captured', built.schemaVersion === 4, String(built.schemaVersion));
  check('accounts are included', built.accounts.length === 1);
  check('custom categories are included', built.categories.length === 1);
  check('transactions are included', built.transactions.length === 1);
  check('rules are included', built.category_rules.length === 1);
  check('exportedAt is ISO', !Number.isNaN(Date.parse(built.exportedAt)), built.exportedAt);

  const roundTripped = parseBackup(JSON.stringify(built));
  check('round-trips through JSON', roundTripped.schemaVersion === 4);

  let rejected = false;
  try {
    parseBackup(JSON.stringify({ format: 'something-else' }));
  } catch {
    rejected = true;
  }
  check('foreign files are rejected', rejected);

  // A backup from a newer schema carries columns this build has no place for.
  let refusedNewer = false;
  const older = fakeDb(3, {});
  try {
    await applyBackup(older.db, { ...built, schemaVersion: 9 });
  } catch {
    refusedNewer = true;
  }
  check('newer-schema backup is refused', refusedNewer);
  check('nothing was deleted on refusal', older.log.length === 0, String(older.log.length));

  const target = fakeDb(4, {});
  await applyBackup(target.db, built);
  const deletes = target.log.filter((entry) => entry.sql.startsWith('DELETE'));
  const inserts = target.log.filter((entry) => entry.sql.startsWith('INSERT'));
  check('every table is cleared', deletes.length === 6, String(deletes.length));
  check('every row is reinserted', inserts.length === 6, String(inserts.length));
  // Splits point at both a transaction and a person, so all three have to come
  // back or a restored ledger would owe money to nobody.
  check(
    'people are restored alongside the splits that name them',
    inserts.some((entry) => entry.params.includes('Rahul'))
  );
  check(
    'splits are cleared before the transactions they point at',
    target.log.findIndex((e) => e.sql.includes('DELETE FROM splits')) <
      target.log.findIndex((e) => e.sql.includes('DELETE FROM transactions'))
  );
  check(
    'a custom category is restored so the rows using it still resolve',
    inserts.some((entry) => entry.params.includes('Chai & snacks'))
  );
  check(
    'accounts are restored before transactions',
    target.log.findIndex((e) => e.sql.includes('INTO accounts')) <
      target.log.findIndex((e) => e.sql.includes('INTO transactions'))
  );
  check(
    'reference survives the round trip',
    inserts.some((entry) => entry.params.includes('523401'))
  );

  // An older backup is applied as-is: migrate() has already brought the live
  // schema forward, and missing columns simply keep their defaults.
  const forward = fakeDb(4, {});
  await applyBackup(forward.db, { ...built, schemaVersion: 2 } as BackupPayload);
  check(
    'older-schema backup still restores',
    forward.log.filter((entry) => entry.sql.startsWith('INSERT')).length === 6
  );

  console.log(failures === 0 ? '\nAll assertions passed\n' : `\n${failures} assertion(s) failed\n`);
  process.exit(failures === 0 ? 0 : 1);

}

void main();
