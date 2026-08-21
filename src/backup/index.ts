import type { SQLiteDatabase } from 'expo-sqlite';

import { getSetting, setSetting } from '../db/repo';
import {
  backupFileName,
  downloadBackup,
  listBackups,
  pruneBackups,
  uploadBackup,
  type DriveBackup,
} from './drive';
import { applyBackup, buildBackup, parseBackup } from './payload';

export const LAST_DRIVE_BACKUP_KEY = 'drive.lastBackupAt';

const KEEP_BACKUPS = 10;

export {
  connect,
  disconnect,
  isConfigured,
  isConnected,
  NotConnectedError,
} from './googleAuth';
export { listBackups, type DriveBackup } from './drive';
export { buildBackup, parseBackup, applyBackup } from './payload';

export async function backupToDrive(db: SQLiteDatabase): Promise<DriveBackup> {
  const payload = await buildBackup(db);
  const uploaded = await uploadBackup(
    backupFileName(payload.exportedAt),
    JSON.stringify(payload)
  );
  await setSetting(db, LAST_DRIVE_BACKUP_KEY, payload.exportedAt);

  // The upload already succeeded; a failure to tidy up older snapshots must not
  // be reported to the user as a failed backup.
  try {
    await pruneBackups(KEEP_BACKUPS);
  } catch {
    // Next backup retries the prune.
  }

  return uploaded;
}

export async function restoreFromDrive(db: SQLiteDatabase, fileId: string): Promise<void> {
  const raw = await downloadBackup(fileId);
  await applyBackup(db, parseBackup(raw));
}

export async function restoreLatestFromDrive(db: SQLiteDatabase): Promise<DriveBackup> {
  const backups = await listBackups();
  const latest = backups[0];
  if (!latest) throw new Error('No backup found in Google Drive');
  await restoreFromDrive(db, latest.id);
  return latest;
}

export async function lastDriveBackupAt(db: SQLiteDatabase): Promise<string | null> {
  return getSetting(db, LAST_DRIVE_BACKUP_KEY);
}
