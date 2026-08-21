/**
 * Minimal reader for the OLE2 compound file format that legacy .xls workbooks
 * are wrapped in. Only what a bank statement needs: locate a named stream and
 * hand back its bytes.
 */

const SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];

const HEADER_SIZE = 512;
const DIFAT_HEADER_ENTRIES = 109;
const DIFAT_HEADER_OFFSET = 76;
const DIRECTORY_ENTRY_SIZE = 128;

const FREE_SECTOR = 0xffffffff;
const END_OF_CHAIN = 0xfffffffe;

const TYPE_STREAM = 2;
const TYPE_ROOT = 5;

export function looksLikeOle2(bytes: Uint8Array): boolean {
  if (bytes.length < HEADER_SIZE) return false;
  return SIGNATURE.every((byte, index) => bytes[index] === byte);
}

type Entry = { name: string; type: number; start: number; size: number };

function readChain(fat: Uint32Array, start: number, limit: number): number[] {
  const chain: number[] = [];
  let sector = start;
  // A malformed file must not spin: every sector may appear at most once.
  const seen = new Set<number>();
  while (sector !== END_OF_CHAIN && sector !== FREE_SECTOR && sector < limit) {
    if (seen.has(sector)) break;
    seen.add(sector);
    chain.push(sector);
    sector = fat[sector];
  }
  return chain;
}

export class Ole2File {
  private readonly view: DataView;
  private readonly sectorSize: number;
  private readonly miniSectorSize: number;
  private readonly miniCutoff: number;
  private readonly fat: Uint32Array;
  private readonly miniFat: Uint32Array;
  private readonly entries: Entry[];
  private readonly miniStream: Uint8Array;

  constructor(private readonly bytes: Uint8Array) {
    if (!looksLikeOle2(bytes)) throw new Error('Not an OLE2 compound file');

    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.sectorSize = 1 << this.view.getUint16(30, true);
    this.miniSectorSize = 1 << this.view.getUint16(32, true);
    this.miniCutoff = this.view.getUint32(56, true);

    this.fat = this.readFat();
    this.miniFat = this.readMiniFat();

    const found = this.readDirectory();
    this.entries = found.entries;
    this.miniStream = found.root
      ? this.readFromFat(found.root.start, found.root.size)
      : new Uint8Array(0);
  }

  private sectorOffset(sector: number): number {
    return HEADER_SIZE + sector * this.sectorSize;
  }

  private readFat(): Uint32Array {
    const sectorCount = this.view.getUint32(44, true);
    const sectors: number[] = [];

    for (let index = 0; index < DIFAT_HEADER_ENTRIES && sectors.length < sectorCount; index += 1) {
      const sector = this.view.getUint32(DIFAT_HEADER_OFFSET + index * 4, true);
      if (sector === FREE_SECTOR || sector === END_OF_CHAIN) break;
      sectors.push(sector);
    }

    // Workbooks needing more than 109 FAT sectors continue the list in DIFAT
    // sectors, each ending with a pointer to the next.
    let difat = this.view.getUint32(68, true);
    const perSector = this.sectorSize / 4 - 1;
    const seen = new Set<number>();
    while (
      difat !== END_OF_CHAIN &&
      difat !== FREE_SECTOR &&
      sectors.length < sectorCount &&
      !seen.has(difat)
    ) {
      seen.add(difat);
      const base = this.sectorOffset(difat);
      for (let index = 0; index < perSector && sectors.length < sectorCount; index += 1) {
        const sector = this.view.getUint32(base + index * 4, true);
        if (sector === FREE_SECTOR || sector === END_OF_CHAIN) break;
        sectors.push(sector);
      }
      difat = this.view.getUint32(base + perSector * 4, true);
    }

    const perFatSector = this.sectorSize / 4;
    const fat = new Uint32Array(sectors.length * perFatSector);
    sectors.forEach((sector, order) => {
      const base = this.sectorOffset(sector);
      for (let index = 0; index < perFatSector; index += 1) {
        fat[order * perFatSector + index] = this.view.getUint32(base + index * 4, true);
      }
    });
    return fat;
  }

  private readMiniFat(): Uint32Array {
    const start = this.view.getUint32(60, true);
    const count = this.view.getUint32(64, true);
    if (count === 0 || start === END_OF_CHAIN) return new Uint32Array(0);

    const chain = readChain(this.fat, start, this.fat.length).slice(0, count);
    const perSector = this.sectorSize / 4;
    const miniFat = new Uint32Array(chain.length * perSector);
    chain.forEach((sector, order) => {
      const base = this.sectorOffset(sector);
      for (let index = 0; index < perSector; index += 1) {
        miniFat[order * perSector + index] = this.view.getUint32(base + index * 4, true);
      }
    });
    return miniFat;
  }

  private readDirectory(): { entries: Entry[]; root: Entry | null } {
    const chain = readChain(this.fat, this.view.getUint32(48, true), this.fat.length);
    const perSector = this.sectorSize / DIRECTORY_ENTRY_SIZE;
    const entries: Entry[] = [];
    let root: Entry | null = null;

    for (const sector of chain) {
      const base = this.sectorOffset(sector);
      for (let index = 0; index < perSector; index += 1) {
        const offset = base + index * DIRECTORY_ENTRY_SIZE;
        if (offset + DIRECTORY_ENTRY_SIZE > this.bytes.length) break;

        const type = this.bytes[offset + 66];
        if (type !== TYPE_STREAM && type !== TYPE_ROOT) continue;

        const nameBytes = this.view.getUint16(offset + 64, true);
        let name = '';
        for (let position = 0; position + 1 < nameBytes; position += 2) {
          const code = this.view.getUint16(offset + position, true);
          if (code === 0) break;
          name += String.fromCharCode(code);
        }

        const entry: Entry = {
          name,
          type,
          start: this.view.getUint32(offset + 116, true),
          size: this.view.getUint32(offset + 120, true),
        };
        if (type === TYPE_ROOT) root = entry;
        else entries.push(entry);
      }
    }

    return { entries, root };
  }

  private readFromFat(start: number, size: number): Uint8Array {
    const chain = readChain(this.fat, start, this.fat.length);
    const out = new Uint8Array(size);
    let written = 0;
    for (const sector of chain) {
      if (written >= size) break;
      const base = this.sectorOffset(sector);
      const take = Math.min(this.sectorSize, size - written, this.bytes.length - base);
      if (take <= 0) break;
      out.set(this.bytes.subarray(base, base + take), written);
      written += take;
    }
    return written === size ? out : out.subarray(0, written);
  }

  private readFromMiniFat(start: number, size: number): Uint8Array {
    const chain = readChain(this.miniFat, start, this.miniFat.length);
    const out = new Uint8Array(size);
    let written = 0;
    for (const sector of chain) {
      if (written >= size) break;
      const base = sector * this.miniSectorSize;
      const take = Math.min(this.miniSectorSize, size - written, this.miniStream.length - base);
      if (take <= 0) break;
      out.set(this.miniStream.subarray(base, base + take), written);
      written += take;
    }
    return written === size ? out : out.subarray(0, written);
  }

  streamNames(): string[] {
    return this.entries.map((entry) => entry.name);
  }

  /** Streams below the cutoff live in the mini stream rather than their own sectors. */
  readStream(name: string): Uint8Array | null {
    const entry = this.entries.find((candidate) => candidate.name === name);
    if (!entry) return null;
    return entry.size < this.miniCutoff && this.miniFat.length > 0
      ? this.readFromMiniFat(entry.start, entry.size)
      : this.readFromFat(entry.start, entry.size);
  }
}
