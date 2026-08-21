export type CaptureOrigin = 'sms' | 'notification' | 'statement' | 'manual';

export function captureOrigin(row: {
  source: 'sms' | 'notification' | 'manual';
  raw_sender: string | null;
}): CaptureOrigin {
  if (row.raw_sender?.startsWith('statement:')) return 'statement';
  if (row.source === 'sms') return 'sms';
  if (row.source === 'notification') return 'notification';
  return 'manual';
}

const BADGES: Record<CaptureOrigin, string> = {
  sms: 'SMS',
  notification: 'NOTIF',
  statement: 'PDF',
  manual: 'MANUAL',
};

const DESCRIPTIONS: Record<CaptureOrigin, string> = {
  sms: 'Read from a bank SMS',
  notification: 'Read from a payment app notification',
  statement: 'Imported from a statement PDF',
  manual: 'Entered by hand',
};

export function originBadge(row: {
  source: 'sms' | 'notification' | 'manual';
  raw_sender: string | null;
}): string {
  return BADGES[captureOrigin(row)];
}

/**
 * Statement imports carry the bank's UTR / transaction id, stored as the last
 * segment of the dedup key. It is the reference you would quote to a bank when
 * tracing or disputing a payment, so it is worth showing.
 */
export function paymentReference(row: {
  reference?: string | null;
  dedup_key?: string | null;
}): string | null {
  if (row.reference && /^[A-Za-z0-9]{6,}$/.test(row.reference)) return row.reference;

  const key = row.dedup_key;
  if (!key || !key.startsWith('stmt|')) return null;
  const segments = key.split('|');
  if (segments.length < 3) return null;
  const reference = segments[2];
  return /^[A-Za-z0-9]{6,}$/.test(reference) ? reference : null;
}

export function originDescription(row: {
  source: 'sms' | 'notification' | 'manual';
  raw_sender: string | null;
}): string {
  return DESCRIPTIONS[captureOrigin(row)];
}

/**
 * What a row is called on screen. The user-set title wins; without one the
 * parsed merchant stands in, so a row is never nameless and editing a title
 * never has to overwrite what the bank actually said.
 */
export function displayTitle(
  row: { title?: string | null; merchant?: string | null },
  fallback = 'Unknown'
): string {
  return row.title?.trim() || row.merchant?.trim() || fallback;
}
