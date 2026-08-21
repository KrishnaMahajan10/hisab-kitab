import { getAccessToken } from './googleAuth';

const FILES_URL = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files';

/**
 * appDataFolder is a hidden, app-scoped folder: it does not appear in the user's
 * Drive, does not count against their quota view, and is removed when they
 * disconnect the app. Nothing here is a document they would ever open by hand.
 */
const SPACE = 'appDataFolder';

export type DriveBackup = {
  id: string;
  name: string;
  size: number;
  modifiedTime: string;
};

async function authorized(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAccessToken();
  const response = await fetch(url, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Drive ${response.status}: ${body.slice(0, 300)}`);
  }
  return response;
}

export function backupFileName(exportedAt: string): string {
  // Colons are legal in Drive names but awkward everywhere else.
  return `hisab-backup-${exportedAt.replace(/[:.]/g, '-')}.json`;
}

export async function uploadBackup(name: string, json: string): Promise<DriveBackup> {
  const boundary = `hisab-${Math.random().toString(36).slice(2)}`;
  const metadata = JSON.stringify({ name, parents: [SPACE], mimeType: 'application/json' });

  const body =
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${metadata}\r\n` +
    `--${boundary}\r\n` +
    'Content-Type: application/json; charset=UTF-8\r\n\r\n' +
    `${json}\r\n` +
    `--${boundary}--`;

  const response = await authorized(
    `${UPLOAD_URL}?uploadType=multipart&fields=id,name,size,modifiedTime`,
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    }
  );

  const file = (await response.json()) as Partial<DriveBackup>;
  return {
    id: file.id ?? '',
    name: file.name ?? name,
    size: Number(file.size ?? json.length),
    modifiedTime: file.modifiedTime ?? new Date().toISOString(),
  };
}

export async function listBackups(): Promise<DriveBackup[]> {
  const params = new URLSearchParams({
    spaces: SPACE,
    fields: 'files(id,name,size,modifiedTime)',
    orderBy: 'modifiedTime desc',
    pageSize: '50',
    q: "mimeType = 'application/json' and trashed = false",
  });
  const response = await authorized(`${FILES_URL}?${params.toString()}`);
  const data = (await response.json()) as { files?: Array<Partial<DriveBackup>> };
  return (data.files ?? []).map((file) => ({
    id: file.id ?? '',
    name: file.name ?? '',
    size: Number(file.size ?? 0),
    modifiedTime: file.modifiedTime ?? '',
  }));
}

export async function downloadBackup(fileId: string): Promise<string> {
  const response = await authorized(`${FILES_URL}/${fileId}?alt=media`);
  return response.text();
}

/**
 * Drive is the only copy of this data, so pruning keeps a window of snapshots
 * rather than one: a corrupt or accidentally-emptied database that gets backed
 * up should not be able to erase every earlier good backup.
 */
export async function pruneBackups(keep: number): Promise<number> {
  const backups = await listBackups();
  const stale = backups.slice(keep);
  let deleted = 0;
  for (const backup of stale) {
    try {
      await authorized(`${FILES_URL}/${backup.id}`, { method: 'DELETE' });
      deleted += 1;
    } catch {
      // A failed prune is not a failed backup; the next run retries.
    }
  }
  return deleted;
}
