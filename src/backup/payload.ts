import type { SQLiteDatabase } from 'expo-sqlite';

export const BACKUP_FORMAT = 'hisab-backup';
export const BACKUP_TABLES = [
  'accounts',
  'categories',
  'transactions',
  'category_rules',
] as const;

export type BackupPayload = {
  format: typeof BACKUP_FORMAT;
  version: number;
  schemaVersion: number;
  exportedAt: string;
  accounts: unknown[];
  categories: unknown[];
  transactions: unknown[];
  category_rules: unknown[];
};

async function schemaVersion(db: SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  return row?.user_version ?? 0;
}

export async function buildBackup(db: SQLiteDatabase): Promise<BackupPayload> {
  const payload = {
    format: BACKUP_FORMAT,
    version: 1,
    schemaVersion: await schemaVersion(db),
    exportedAt: new Date().toISOString(),
  } as BackupPayload;

  for (const table of BACKUP_TABLES) {
    payload[table] = await db.getAllAsync(`SELECT * FROM ${table}`);
  }
  return payload;
}

export function parseBackup(raw: string): BackupPayload {
  const parsed = JSON.parse(raw);
  if (parsed?.format !== BACKUP_FORMAT) throw new Error('Not a Hisab backup file');
  return parsed as BackupPayload;
}

/**
 * Replaces every row with the backup's rows. A backup written by a newer schema
 * is refused rather than half-applied: its columns would not exist here, and a
 * partial restore is worse than no restore.
 */
export async function applyBackup(db: SQLiteDatabase, payload: BackupPayload): Promise<void> {
  const current = await schemaVersion(db);
  if (typeof payload.schemaVersion === 'number' && payload.schemaVersion > current) {
    throw new Error(
      `Backup was written by a newer version of Hisab (schema ${payload.schemaVersion} > ${current}). Update the app first.`
    );
  }

  await db.withTransactionAsync(async () => {
    await db.execAsync('DELETE FROM transactions');
    await db.execAsync('DELETE FROM category_rules');
    await db.execAsync('DELETE FROM categories');
    await db.execAsync('DELETE FROM accounts');

    for (const table of BACKUP_TABLES) {
      const rows = payload[table];
      if (!Array.isArray(rows)) continue;
      for (const row of rows) {
        const columns = Object.keys(row as Record<string, unknown>);
        if (columns.length === 0) continue;
        const placeholders = columns.map(() => '?').join(',');
        await db.runAsync(
          `INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`,
          columns.map((column) => (row as Record<string, unknown>)[column] as never)
        );
      }
    }
  });
}
