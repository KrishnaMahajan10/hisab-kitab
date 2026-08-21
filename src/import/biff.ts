import { Ole2File, looksLikeOle2 } from './ole2';

/**
 * Reader for the BIFF8 record stream inside a legacy .xls workbook — enough of
 * it to recover a sheet of values. Formulas are read from their cached result
 * rather than evaluated: a bank statement never depends on recalculation.
 */

export type Cell = string | number | null;
export type Sheet = { name: string; rows: Cell[][] };

const RECORD_BOF = 0x0809;
const RECORD_EOF = 0x000a;
const RECORD_CONTINUE = 0x003c;
const RECORD_SST = 0x00fc;
const RECORD_LABELSST = 0x00fd;
const RECORD_LABEL = 0x0204;
const RECORD_RSTRING = 0x00d6;
const RECORD_RK = 0x027e;
const RECORD_MULRK = 0x00bd;
const RECORD_NUMBER = 0x0203;
const RECORD_FORMULA = 0x0006;
const RECORD_STRING = 0x0207;
const RECORD_BOUNDSHEET = 0x0085;

const SUBSTREAM_WORKSHEET = 0x0010;

const MAX_CELLS = 200_000;

type Record = { type: number; data: Uint8Array; offset: number };

function readRecords(stream: Uint8Array): Record[] {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const records: Record[] = [];
  let position = 0;

  while (position + 4 <= stream.length) {
    const type = view.getUint16(position, true);
    const length = view.getUint16(position + 2, true);
    const start = position + 4;
    if (start + length > stream.length) break;
    records.push({ type, data: stream.subarray(start, start + length), offset: position });
    position = start + length;
  }
  return records;
}

/**
 * A BIFF8 string is a character count, a flags byte, then the characters —
 * one byte each when compressed, two when not. Rich-text runs and far-east
 * extensions are sized but never needed, so they are skipped.
 */
function readUnicodeString(
  data: Uint8Array,
  view: DataView,
  offset: number,
  lengthBytes: 1 | 2
): { value: string; next: number } {
  const count = lengthBytes === 2 ? view.getUint16(offset, true) : data[offset];
  let cursor = offset + lengthBytes;
  const flags = data[cursor];
  cursor += 1;

  const wide = (flags & 0x01) !== 0;
  const rich = (flags & 0x08) !== 0;
  const extended = (flags & 0x04) !== 0;

  let runs = 0;
  if (rich) {
    runs = view.getUint16(cursor, true);
    cursor += 2;
  }
  let extendedBytes = 0;
  if (extended) {
    extendedBytes = view.getUint32(cursor, true);
    cursor += 4;
  }

  let value = '';
  for (let index = 0; index < count; index += 1) {
    if (wide) {
      value += String.fromCharCode(view.getUint16(cursor, true));
      cursor += 2;
    } else {
      value += String.fromCharCode(data[cursor]);
      cursor += 1;
    }
  }

  return { value, next: cursor + runs * 4 + extendedBytes };
}

/**
 * The shared string table can outgrow one record and spill into CONTINUE
 * records. A string may be cut mid-way, and the continuation restates its own
 * compression flag — so the segments are walked rather than concatenated.
 */
function readSharedStrings(records: Record[]): string[] {
  const sstIndex = records.findIndex((record) => record.type === RECORD_SST);
  if (sstIndex < 0) return [];

  const segments: Uint8Array[] = [records[sstIndex].data];
  for (let index = sstIndex + 1; index < records.length; index += 1) {
    if (records[index].type !== RECORD_CONTINUE) break;
    segments.push(records[index].data);
  }

  const first = segments[0];
  const firstView = new DataView(first.buffer, first.byteOffset, first.byteLength);
  const unique = firstView.getUint32(4, true);

  let segment = 0;
  let cursor = 8;

  const remaining = (): number => segments[segment].length - cursor;
  const advance = (): boolean => {
    while (segment < segments.length && remaining() <= 0) {
      segment += 1;
      cursor = 0;
    }
    return segment < segments.length;
  };

  const byteAt = (position: number): number => segments[segment][position];
  const viewOf = (): DataView => {
    const current = segments[segment];
    return new DataView(current.buffer, current.byteOffset, current.byteLength);
  };

  const strings: string[] = [];

  for (let index = 0; index < unique; index += 1) {
    if (!advance()) break;

    let view = viewOf();
    const count = view.getUint16(cursor, true);
    cursor += 2;
    if (!advance()) break;

    let flags = byteAt(cursor);
    cursor += 1;
    let wide = (flags & 0x01) !== 0;
    const rich = (flags & 0x08) !== 0;
    const extended = (flags & 0x04) !== 0;

    let runs = 0;
    if (rich) {
      view = viewOf();
      runs = view.getUint16(cursor, true);
      cursor += 2;
    }
    let extendedBytes = 0;
    if (extended) {
      view = viewOf();
      extendedBytes = view.getUint32(cursor, true);
      cursor += 4;
    }

    let value = '';
    for (let character = 0; character < count; character += 1) {
      if (remaining() <= 0) {
        // Crossing into a CONTINUE record: its first byte is a fresh flag, and
        // the rest of this same string may switch width.
        segment += 1;
        cursor = 0;
        if (segment >= segments.length) break;
        flags = byteAt(cursor);
        cursor += 1;
        wide = (flags & 0x01) !== 0;
      }
      if (wide) {
        if (remaining() < 2) {
          segment += 1;
          cursor = 0;
          if (segment >= segments.length) break;
          flags = byteAt(cursor);
          cursor += 1;
          wide = (flags & 0x01) !== 0;
        }
        value += String.fromCharCode(viewOf().getUint16(cursor, true));
        cursor += 2;
      } else {
        value += String.fromCharCode(byteAt(cursor));
        cursor += 1;
      }
    }

    let skip = runs * 4 + extendedBytes;
    while (skip > 0 && segment < segments.length) {
      const take = Math.min(skip, remaining());
      cursor += take;
      skip -= take;
      if (skip > 0) {
        segment += 1;
        cursor = 0;
      }
    }

    strings.push(value);
  }

  return strings;
}

/** RK values pack a float or a scaled integer into 32 bits. */
function decodeRk(view: DataView, offset: number): number {
  const raw = view.getUint32(offset, true);
  const isInteger = (raw & 0x02) !== 0;
  const isScaled = (raw & 0x01) !== 0;

  let value: number;
  if (isInteger) {
    // A signed 30-bit integer in the high bits; >> coerces to int32 first, so
    // a negative value sign-extends without any extra handling.
    value = raw >> 2;
  } else {
    const buffer = new ArrayBuffer(8);
    new DataView(buffer).setUint32(4, raw & 0xfffffffc, true);
    value = new DataView(buffer).getFloat64(0, true);
  }
  return isScaled ? value / 100 : value;
}

function sheetNames(records: Record[]): string[] {
  const names: string[] = [];
  for (const record of records) {
    if (record.type !== RECORD_BOUNDSHEET) continue;
    const view = new DataView(record.data.buffer, record.data.byteOffset, record.data.byteLength);
    names.push(readUnicodeString(record.data, view, 6, 1).value);
  }
  return names;
}

export function looksLikeXls(bytes: Uint8Array): boolean {
  return looksLikeOle2(bytes);
}

/**
 * Every worksheet in the workbook, as a grid of values. Rows and columns are
 * placed by their stored index, so gaps come back as nulls rather than shifting
 * later cells left — a shifted column would silently pair the wrong amount with
 * a transaction.
 */
export function readXlsSheets(bytes: Uint8Array): Sheet[] {
  const container = new Ole2File(bytes);
  // Excel 97 and later name it Workbook; Excel 5 wrote Book.
  const workbook = container.readStream('Workbook') ?? container.readStream('Book');
  if (!workbook) throw new Error('No workbook stream in this .xls file');

  const records = readRecords(workbook);
  const strings = readSharedStrings(records);
  const names = sheetNames(records);

  const sheets: Sheet[] = [];
  let grid: Map<number, Map<number, Cell>> | null = null;
  let cells = 0;
  let pendingString: { row: number; column: number } | null = null;

  const put = (row: number, column: number, value: Cell) => {
    if (!grid || cells >= MAX_CELLS) return;
    let line = grid.get(row);
    if (!line) {
      line = new Map<number, Cell>();
      grid.set(row, line);
    }
    line.set(column, value);
    cells += 1;
  };

  const flush = () => {
    if (!grid) return;
    let maxRow = -1;
    for (const row of grid.keys()) if (row > maxRow) maxRow = row;
    const rows: Cell[][] = [];
    for (let row = 0; row <= maxRow; row += 1) {
      const line = grid.get(row);
      if (!line) {
        rows.push([]);
        continue;
      }
      let maxColumn = -1;
      for (const column of line.keys()) if (column > maxColumn) maxColumn = column;
      const out: Cell[] = [];
      for (let column = 0; column <= maxColumn; column += 1) {
        out.push(line.get(column) ?? null);
      }
      rows.push(out);
    }
    sheets.push({ name: names[sheets.length] ?? `Sheet${sheets.length + 1}`, rows });
    grid = null;
  };

  for (const record of records) {
    const view = new DataView(record.data.buffer, record.data.byteOffset, record.data.byteLength);

    switch (record.type) {
      case RECORD_BOF: {
        // Only worksheet substreams carry cells; the globals substream is first.
        if (record.data.length >= 4 && view.getUint16(2, true) === SUBSTREAM_WORKSHEET) {
          flush();
          grid = new Map<number, Map<number, Cell>>();
        }
        break;
      }
      case RECORD_EOF: {
        flush();
        break;
      }
      case RECORD_LABELSST: {
        const index = view.getUint32(6, true);
        put(view.getUint16(0, true), view.getUint16(2, true), strings[index] ?? '');
        break;
      }
      case RECORD_LABEL:
      case RECORD_RSTRING: {
        const parsed = readUnicodeString(record.data, view, 6, 2);
        put(view.getUint16(0, true), view.getUint16(2, true), parsed.value);
        break;
      }
      case RECORD_NUMBER: {
        put(view.getUint16(0, true), view.getUint16(2, true), view.getFloat64(6, true));
        break;
      }
      case RECORD_RK: {
        put(view.getUint16(0, true), view.getUint16(2, true), decodeRk(view, 6));
        break;
      }
      case RECORD_MULRK: {
        const row = view.getUint16(0, true);
        const first = view.getUint16(2, true);
        const count = Math.floor((record.data.length - 6) / 6);
        for (let index = 0; index < count; index += 1) {
          put(row, first + index, decodeRk(view, 4 + index * 6 + 2));
        }
        break;
      }
      case RECORD_FORMULA: {
        const row = view.getUint16(0, true);
        const column = view.getUint16(2, true);
        // A cached string result is announced here and delivered by the next
        // STRING record; anything else is a plain number.
        if (record.data[6] === 0x00 && view.getUint16(12, true) === 0xffff) {
          pendingString = { row, column };
        } else if (view.getUint16(12, true) === 0xffff) {
          put(row, column, null);
        } else {
          put(row, column, view.getFloat64(6, true));
        }
        break;
      }
      case RECORD_STRING: {
        if (pendingString) {
          const parsed = readUnicodeString(record.data, view, 0, 2);
          put(pendingString.row, pendingString.column, parsed.value);
          pendingString = null;
        }
        break;
      }
      default:
        break;
    }
  }

  flush();
  return sheets;
}
