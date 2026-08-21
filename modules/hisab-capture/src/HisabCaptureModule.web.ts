import { NativeModule, registerWebModule } from 'expo';

import { HisabCaptureModuleEvents, PdfExtractResult, RawCapture } from './HisabCapture.types';

class HisabCaptureWebModule extends NativeModule<HisabCaptureModuleEvents> {
  hasSmsPermission(): boolean {
    return false;
  }

  isNotificationAccessGranted(): boolean {
    return false;
  }

  openNotificationAccessSettings(): void {}

  pendingCount(): number {
    return 0;
  }

  clearCaptureNotification(): void {}

  async getPendingCaptures(_limit: number): Promise<RawCapture[]> {
    return [];
  }

  async markConsumed(_ids: number[]): Promise<void> {}

  async backfillSms(_sinceMs: number, _limit: number): Promise<number> {
    return 0;
  }

  async extractPdfText(_uri: string, _password: string | null): Promise<PdfExtractResult> {
    return { ok: false, text: null, pageCount: 0, error: 'io', message: 'Not supported on web' };
  }
}

export default registerWebModule(HisabCaptureWebModule, 'HisabCapture');
