export type CaptureSource = 'sms' | 'notification';

export type RawCapture = {
  id: number;
  source: CaptureSource;
  sender: string;
  body: string;
  postedAt: number;
};

export type CaptureEventPayload = Omit<RawCapture, 'id'>;

export type PdfExtractErrorCode = 'password' | 'io' | 'parse' | 'memory';

export type PdfExtractResult = {
  ok: boolean;
  text: string | null;
  pageCount: number;
  error: PdfExtractErrorCode | null;
  message: string | null;
};

export type HisabCaptureModuleEvents = {
  onCapture: (payload: CaptureEventPayload) => void;
};
