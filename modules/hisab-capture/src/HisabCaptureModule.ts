import { NativeModule, requireNativeModule } from 'expo';

import { HisabCaptureModuleEvents, PdfExtractResult, RawCapture } from './HisabCapture.types';

declare class HisabCaptureModule extends NativeModule<HisabCaptureModuleEvents> {
  hasSmsPermission(): boolean;
  isNotificationAccessGranted(): boolean;
  openNotificationAccessSettings(): void;
  pendingCount(): number;
  clearCaptureNotification(): void;
  getPendingCaptures(limit: number): Promise<RawCapture[]>;
  markConsumed(ids: number[]): Promise<void>;
  backfillSms(sinceMs: number, limit: number): Promise<number>;
  extractPdfText(uri: string, password: string | null): Promise<PdfExtractResult>;
}

export default requireNativeModule<HisabCaptureModule>('HisabCapture');
