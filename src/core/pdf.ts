/**
 * PDF reader owned by this repository.
 * The bytes stay in the caller. This file does not import another PDF library.
 * Flate streams use the platform DecompressionStream, which is zlib, not a PDF parser.
 */

const NO_READ = "This PDF could not be read.";

type Name = { readonly name: string };
type Ref = { readonly ref: readonly [number, number] };
type Dict = Map<string, Value>;
type Value = null | boolean | number | string | Name | Ref | Value[] | Dict | Stream;
type Stream = { readonly dict: Dict; readonly data: Uint8Array };

type Loc =
  | { readonly kind: "offset"; readonly offset: number }
  | { readonly kind: "compressed"; readonly stream: number; readonly index: number };

const encoder = new TextEncoder();
const decoder = new TextDecoder("latin1");

function keyword(bytes: Uint8Array, at: number, word: string): boolean {
  const want = encoder.encode(word);
  if (at + want.length > bytes.length) return false;
  for (let i = 0; i < want.length; i += 1) if (bytes[at + i] !== want[i]) return false;
  return true;
}

function isSpace(byte: number): boolean {
  return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
}

function isDelim(byte: number): boolean {
  return (
    isSpace(byte) ||
    byte === 40 ||
    byte === 41 ||
    byte === 60 ||
    byte === 62 ||
    byte === 91 ||
    byte === 93 ||
    byte === 123 ||
    byte === 125 ||
    byte === 47 ||
    byte === 37
  );
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const leftDist = Math.abs(estimate - left);
  const upDist = Math.abs(estimate - up);
  const diag = Math.abs(estimate - upLeft);
  if (leftDist <= upDist && leftDist <= diag) return left;
  if (upDist <= diag) return up;
  return upLeft;
}

/** Undo a PDF PNG predictor. `columns` is the sample width in bytes. */
export function unpredict(data: Uint8Array, columns: number, predictor: number): Uint8Array {
  if (predictor < 10) return data;
  if (columns < 1) throw new Error(NO_READ);
  const rows: Uint8Array[] = [];
  let prev = new Uint8Array(columns);
  let at = 0;
  while (at < data.length) {
    const tag = data[at] ?? 0;
    at += 1;
    if (at + columns > data.length) throw new Error(NO_READ);
    const out = new Uint8Array(columns);
    for (let column = 0; column < columns; column += 1) {
      const raw = data[at + column] ?? 0;
      const left = column > 0 ? (out[column - 1] ?? 0) : 0;
      const up = prev[column] ?? 0;
      const upLeft = column > 0 ? (prev[column - 1] ?? 0) : 0;
      if (tag === 1) out[column] = (raw + left) & 255;
      else if (tag === 2) out[column] = (raw + up) & 255;
      else if (tag === 3) out[column] = (raw + ((left + up) >> 1)) & 255;
      else if (tag === 4) out[column] = (raw + paeth(left, up, upLeft)) & 255;
      else out[column] = raw;
    }
    at += columns;
    prev = out;
    rows.push(out);
  }
  const joined = new Uint8Array(rows.reduce((sum, row) => sum + row.length, 0));
  let offset = 0;
  for (const row of rows) {
    joined.set(row, offset);
    offset += row.length;
  }
  return joined;
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

class Reader {
  pos = 0;
  bytes: Uint8Array;
  xref = new Map<number, Loc>();
  objects = new Map<number, Value>();
  streams = new Map<number, Value[]>();

  constructor(bytes: Uint8Array) {
    this.bytes = bytes;
  }

  async count(): Promise<number> {
    if (!this.hasHeader()) throw new Error(NO_READ);
    const start = this.findStartxref();
    const trailer = await this.xrefFrom(start);
    if (trailer.has("Encrypt")) throw new Error(NO_READ);
    const root = await this.deref(trailer.get("Root"));
    if (!isDict(root)) throw new Error(NO_READ);
    const pages = await this.deref(root.get("Pages"));
    return this.walk(pages, new Set<string>());
  }

  private hasHeader(): boolean {
    const window = decoder.decode(this.bytes.subarray(0, Math.min(this.bytes.length, 1024)));
    return window.includes("%PDF-");
  }

  private findStartxref(): number {
    const marker = encoder.encode("startxref");
    let found = -1;
    for (let at = 0; at + marker.length <= this.bytes.length; at += 1) {
      if (keyword(this.bytes, at, "startxref")) found = at;
    }
    if (found < 0) throw new Error(NO_READ);
    this.pos = found + marker.length;
    this.skip();
    const offset = this.number();
    if (offset === undefined || offset < 0) throw new Error(NO_READ);
    return offset;
  }

  private async xrefFrom(start: number): Promise<Dict> {
    let trailer: Dict | undefined;
    let offset = start;
    const seen = new Set<number>();
    while (!seen.has(offset)) {
      seen.add(offset);
      this.pos = offset;
      this.skip();
      if (keyword(this.bytes, this.pos, "xref")) {
        const parsed = this.classicXref();
        trailer ??= parsed;
        const prev = parsed.get("Prev");
        if (typeof prev !== "number") break;
        offset = prev;
        continue;
      }
      const value = await this.object();
      if (!isStream(value) || nameOf(value.dict.get("Type")) !== "XRef") throw new Error(NO_READ);
      const parsed = await this.xrefStream(value);
      trailer ??= parsed;
      const prev = parsed.get("Prev");
      if (typeof prev !== "number") break;
      offset = prev;
    }
    if (!trailer) throw new Error(NO_READ);
    return trailer;
  }

  private classicXref(): Dict {
    this.word("xref");
    for (;;) {
      this.skip();
      if (keyword(this.bytes, this.pos, "trailer")) break;
      const first = this.number();
      const count = this.number();
      if (first === undefined || count === undefined) throw new Error(NO_READ);
      for (let index = 0; index < count; index += 1) {
        this.skip();
        const line = this.line();
        const match = /^(\d{10}) (\d{5}) ([nf])/.exec(line);
        if (!match) throw new Error(NO_READ);
        const objectNumber = first + index;
        if (this.xref.has(objectNumber)) continue;
        if (match[3] === "n") {
          this.xref.set(objectNumber, { kind: "offset", offset: Number(match[1]) });
        }
      }
    }
    this.word("trailer");
    const trailer = this.value();
    if (!isDict(trailer)) throw new Error(NO_READ);
    return trailer;
  }

  private async xrefStream(stream: Stream): Promise<Dict> {
    const widths = ints(stream.dict.get("W"));
    if (widths.length !== 3) throw new Error(NO_READ);
    const [typeWidth, field2Width, field3Width] = widths as [number, number, number];
    const row = typeWidth + field2Width + field3Width;
    if (row < 1) throw new Error(NO_READ);
    let data = await this.filtered(stream);
    const parms = await this.deref(stream.dict.get("DecodeParms"));
    const predictor = isDict(parms) && typeof parms.get("Predictor") === "number" ? (parms.get("Predictor") as number) : 1;
    const columns =
      isDict(parms) && typeof parms.get("Columns") === "number" ? (parms.get("Columns") as number) : row;
    if (predictor >= 10) data = unpredict(data, columns, predictor);
    const index = ints(stream.dict.get("Index"));
    const size = stream.dict.get("Size");
    const subsections = index.length > 0 ? index : [0, typeof size === "number" ? size : 0];
    let at = 0;
    for (let pair = 0; pair + 1 < subsections.length; pair += 2) {
      const first = subsections[pair] ?? 0;
      const count = subsections[pair + 1] ?? 0;
      for (let entry = 0; entry < count; entry += 1) {
        if (at + row > data.length) throw new Error(NO_READ);
        const type = typeWidth === 0 ? 1 : readInt(data, at, typeWidth);
        at += typeWidth;
        const field2 = readInt(data, at, field2Width);
        at += field2Width;
        const field3 = readInt(data, at, field3Width);
        at += field3Width;
        const objectNumber = first + entry;
        if (this.xref.has(objectNumber) || type === 0) continue;
        if (type === 1) this.xref.set(objectNumber, { kind: "offset", offset: field2 });
        else if (type === 2) this.xref.set(objectNumber, { kind: "compressed", stream: field2, index: field3 });
        else throw new Error(NO_READ);
      }
    }
    return stream.dict;
  }

  private async filtered(stream: Stream): Promise<Uint8Array> {
    const filter = stream.dict.get("Filter");
    const name = nameOf(filter) ?? (Array.isArray(filter) ? nameOf(filter[0]) : undefined);
    if (!name) return stream.data;
    if (name !== "FlateDecode") throw new Error(NO_READ);
    if (Array.isArray(filter) && filter.length > 1) throw new Error(NO_READ);
    return inflate(stream.data);
  }

  private async deref(value: Value | undefined): Promise<Value | undefined> {
    if (!isRef(value)) return value;
    const [number] = value.ref;
    const cached = this.objects.get(number);
    if (cached !== undefined) return cached;
    const loc = this.xref.get(number);
    if (!loc) throw new Error(NO_READ);
    if (loc.kind === "offset") {
      this.pos = loc.offset;
      const parsed = await this.object();
      this.objects.set(number, parsed);
      return parsed;
    }
    const packed = await this.objectStream(loc.stream);
    const item = packed[loc.index];
    if (item === undefined) throw new Error(NO_READ);
    this.objects.set(number, item);
    return item;
  }

  private async objectStream(number: number): Promise<Value[]> {
    const cached = this.streams.get(number);
    if (cached) return cached;
    const value = await this.deref(ref(number));
    if (!isStream(value) || nameOf(value.dict.get("Type")) !== "ObjStm") throw new Error(NO_READ);
    const count = value.dict.get("N");
    const first = value.dict.get("First");
    if (typeof count !== "number" || typeof first !== "number") throw new Error(NO_READ);
    const data = await this.filtered(value);
    const header = decoder.decode(data.subarray(0, first));
    const pairs = header.trim().split(/\s+/).map(Number);
    if (pairs.length < count * 2 || pairs.some((part) => !Number.isInteger(part))) throw new Error(NO_READ);
    const saved = this.bytes;
    const savedPos = this.pos;
    const objects: Value[] = [];
    for (let index = 0; index < count; index += 1) {
      const start = first + (pairs[index * 2 + 1] ?? 0);
      this.bytes = data;
      this.pos = start;
      objects.push(this.value());
    }
    this.bytes = saved;
    this.pos = savedPos;
    this.streams.set(number, objects);
    return objects;
  }

  private async walk(value: Value | undefined, seen: Set<string>): Promise<number> {
    const page = await this.deref(value);
    if (!isDict(page)) throw new Error(NO_READ);
    const type = nameOf(page.get("Type"));
    if (type === "Page") return 1;
    const kids = page.get("Kids");
    if (!Array.isArray(kids)) {
      const count = page.get("Count");
      if (type === "Pages" && typeof count === "number") return count;
      throw new Error(NO_READ);
    }
    let total = 0;
    for (const kid of kids) {
      const key = isRef(kid) ? `${kid.ref[0]} ${kid.ref[1]}` : "";
      if (key && seen.has(key)) throw new Error(NO_READ);
      if (key) seen.add(key);
      total += await this.walk(kid, seen);
    }
    return total;
  }

  private async object(): Promise<Value> {
    this.skip();
    this.number();
    this.number();
    this.word("obj");
    const value = this.value();
    this.skip();
    if (!isDict(value) || !keyword(this.bytes, this.pos, "stream")) return value;
    this.word("stream");
    if (this.bytes[this.pos] === 13) this.pos += 1;
    if (this.bytes[this.pos] === 10) this.pos += 1;
    const length = await this.deref(value.get("Length"));
    if (typeof length !== "number" || length < 0 || this.pos + length > this.bytes.length) {
      throw new Error(NO_READ);
    }
    const data = this.bytes.subarray(this.pos, this.pos + length);
    this.pos += length;
    return { dict: value, data };
  }

  private value(): Value {
    this.skip();
    const byte = this.bytes[this.pos];
    if (byte === 60 && this.bytes[this.pos + 1] === 60) return this.dict();
    if (byte === 91) return this.array();
    if (byte === 40) return this.literal();
    if (byte === 60) return this.hex();
    if (byte === 47) return { name: this.rawName() };
    if (keyword(this.bytes, this.pos, "true") && this.boundary(4)) {
      this.pos += 4;
      return true;
    }
    if (keyword(this.bytes, this.pos, "false") && this.boundary(5)) {
      this.pos += 5;
      return false;
    }
    if (keyword(this.bytes, this.pos, "null") && this.boundary(4)) {
      this.pos += 4;
      return null;
    }
    const first = this.number();
    if (first === undefined) throw new Error(NO_READ);
    const mark = this.pos;
    this.skip();
    const second = this.number();
    if (second !== undefined) {
      this.skip();
      if (keyword(this.bytes, this.pos, "R") && this.boundary(1)) {
        this.pos += 1;
        return { ref: [first, second] };
      }
    }
    this.pos = mark;
    return first;
  }

  private dict(): Dict {
    this.pos += 2;
    const dict: Dict = new Map();
    for (;;) {
      this.skip();
      if (this.bytes[this.pos] === 62 && this.bytes[this.pos + 1] === 62) {
        this.pos += 2;
        return dict;
      }
      if (this.bytes[this.pos] !== 47) throw new Error(NO_READ);
      const key = this.rawName();
      dict.set(key, this.value());
    }
  }

  private array(): Value[] {
    this.pos += 1;
    const items: Value[] = [];
    for (;;) {
      this.skip();
      if (this.bytes[this.pos] === 93) {
        this.pos += 1;
        return items;
      }
      items.push(this.value());
    }
  }

  private literal(): string {
    this.pos += 1;
    let text = "";
    let depth = 1;
    while (this.pos < this.bytes.length && depth > 0) {
      const byte = this.bytes[this.pos] ?? 0;
      this.pos += 1;
      if (byte === 92) {
        const next = this.bytes[this.pos] ?? 0;
        this.pos += 1;
        if (next === 110) text += "\n";
        else if (next === 114) text += "\r";
        else if (next === 116) text += "\t";
        else if (next === 98) text += "\b";
        else if (next === 102) text += "\f";
        else if (next >= 48 && next <= 55) {
          let octal = String.fromCharCode(next);
          for (let extra = 0; extra < 2; extra += 1) {
            const digit = this.bytes[this.pos] ?? 0;
            if (digit < 48 || digit > 55) break;
            octal += String.fromCharCode(digit);
            this.pos += 1;
          }
          text += String.fromCharCode(Number.parseInt(octal, 8));
        } else if (next !== 10 && next !== 13) text += String.fromCharCode(next);
        continue;
      }
      if (byte === 40) depth += 1;
      if (byte === 41) {
        depth -= 1;
        if (depth === 0) break;
      }
      text += String.fromCharCode(byte);
    }
    return text;
  }

  private hex(): string {
    this.pos += 1;
    let hex = "";
    while (this.pos < this.bytes.length && this.bytes[this.pos] !== 62) {
      const byte = this.bytes[this.pos] ?? 0;
      this.pos += 1;
      if (!isSpace(byte)) hex += String.fromCharCode(byte);
    }
    this.pos += 1;
    if (hex.length % 2 === 1) hex += "0";
    let text = "";
    for (let at = 0; at < hex.length; at += 2) {
      text += String.fromCharCode(Number.parseInt(hex.slice(at, at + 2), 16));
    }
    return text;
  }

  private rawName(): string {
    this.pos += 1;
    let name = "";
    while (this.pos < this.bytes.length && !isDelim(this.bytes[this.pos] ?? 0)) {
      const byte = this.bytes[this.pos] ?? 0;
      this.pos += 1;
      if (byte === 35) {
        const pair = decoder.decode(this.bytes.subarray(this.pos, this.pos + 2));
        this.pos += 2;
        name += String.fromCharCode(Number.parseInt(pair, 16));
      } else name += String.fromCharCode(byte);
    }
    return name;
  }

  private number(): number | undefined {
    this.skip();
    const start = this.pos;
    if (this.bytes[this.pos] === 43 || this.bytes[this.pos] === 45) this.pos += 1;
    let sawDigit = false;
    while (this.bytes[this.pos]! >= 48 && this.bytes[this.pos]! <= 57) {
      sawDigit = true;
      this.pos += 1;
    }
    if (this.bytes[this.pos] === 46) {
      this.pos += 1;
      while (this.bytes[this.pos]! >= 48 && this.bytes[this.pos]! <= 57) {
        sawDigit = true;
        this.pos += 1;
      }
    }
    if (!sawDigit) {
      this.pos = start;
      return undefined;
    }
    return Number(decoder.decode(this.bytes.subarray(start, this.pos)));
  }

  private word(word: string): void {
    this.skip();
    if (!keyword(this.bytes, this.pos, word)) throw new Error(NO_READ);
    this.pos += word.length;
  }

  private line(): string {
    const start = this.pos;
    while (this.pos < this.bytes.length && this.bytes[this.pos] !== 10 && this.bytes[this.pos] !== 13) {
      this.pos += 1;
    }
    if (this.bytes[this.pos] === 13) this.pos += 1;
    if (this.bytes[this.pos] === 10) this.pos += 1;
    return decoder.decode(this.bytes.subarray(start, this.pos));
  }

  private skip(): void {
    for (;;) {
      while (isSpace(this.bytes[this.pos] ?? 256)) this.pos += 1;
      if (this.bytes[this.pos] !== 37) return;
      while (this.pos < this.bytes.length && this.bytes[this.pos] !== 10 && this.bytes[this.pos] !== 13) {
        this.pos += 1;
      }
    }
  }

  private boundary(length: number): boolean {
    const next = this.bytes[this.pos + length];
    return next === undefined || isDelim(next);
  }
}

function ref(number: number): Ref {
  return { ref: [number, 0] };
}

function isDict(value: Value | undefined): value is Dict {
  return value instanceof Map;
}

function isRef(value: Value | undefined): value is Ref {
  return typeof value === "object" && value !== null && "ref" in value;
}

function isStream(value: Value | undefined): value is Stream {
  return typeof value === "object" && value !== null && "data" in value && "dict" in value;
}

function nameOf(value: Value | undefined): string | undefined {
  if (typeof value === "object" && value !== null && "name" in value) return value.name;
  return undefined;
}

function ints(value: Value | undefined): number[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is number => typeof item === "number");
}

function readInt(data: Uint8Array, at: number, width: number): number {
  let value = 0;
  for (let index = 0; index < width; index += 1) value = (value << 8) | (data[at + index] ?? 0);
  return value;
}

/** Number of page objects under the catalog. A tree with no pages returns 0. */
export async function countPages(bytes: Uint8Array): Promise<number> {
  if (bytes.byteLength === 0) throw new Error(NO_READ);
  return new Reader(bytes).count();
}
