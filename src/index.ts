import createQpdf from "@neslinesli93/qpdf-wasm";
import { PDFDocument, degrees, type PDFImage } from "pdf-lib";

export type ImageKind = "jpg" | "png";

async function load(bytes: Uint8Array): Promise<PDFDocument> {
  return PDFDocument.load(bytes, { ignoreEncryption: true });
}

export async function mergePdfs(inputs: Uint8Array[]): Promise<Uint8Array> {
  if (inputs.length === 0) {
    throw new Error("Add at least one PDF.");
  }
  const out = await PDFDocument.create();
  for (const input of inputs) {
    const doc = await load(input);
    const pages = await out.copyPages(doc, doc.getPageIndices());
    for (const page of pages) out.addPage(page);
  }
  return out.save();
}

export async function splitPdf(input: Uint8Array): Promise<Uint8Array[]> {
  const doc = await load(input);
  const indexes = doc.getPageIndices();
  if (indexes.length === 0) throw new Error("This PDF has no pages.");
  const parts: Uint8Array[] = [];
  for (const index of indexes) {
    const out = await PDFDocument.create();
    const [page] = await out.copyPages(doc, [index]);
    out.addPage(page);
    parts.push(await out.save());
  }
  return parts;
}

/** Each inclusive 1-based range becomes one PDF, in the order given. */
export async function extractPdfRanges(
  input: Uint8Array,
  ranges: readonly { start: number; end: number }[],
): Promise<Uint8Array[]> {
  if (ranges.length === 0) throw new Error("Name a page that exists.");
  const doc = await load(input);
  const total = doc.getPageCount();
  if (total === 0) throw new Error("This PDF has no pages.");
  const parts: Uint8Array[] = [];
  for (const range of ranges) {
    if (
      !Number.isInteger(range.start) ||
      !Number.isInteger(range.end) ||
      range.start < 1 ||
      range.end > total ||
      range.end < range.start ||
      range.end - range.start > 500
    ) {
      throw new Error("Name a page that exists.");
    }
    const out = await PDFDocument.create();
    const indexes: number[] = [];
    for (let page = range.start; page <= range.end; page += 1) indexes.push(page - 1);
    const copied = await out.copyPages(doc, indexes);
    for (const page of copied) out.addPage(page);
    parts.push(await out.save());
  }
  return parts;
}

export type QuarterTurn = 0 | 90 | 180 | 270;

function isQuarterTurn(value: number): value is QuarterTurn {
  return value === 0 || value === 90 || value === 180 || value === 270;
}

function turned(current: number, rotation: QuarterTurn): QuarterTurn {
  const next = ((current + rotation) % 360 + 360) % 360;
  if (!isQuarterTurn(next)) {
    throw new Error("Rotation must be 0, 90, 180, or 270 degrees.");
  }
  return next;
}

export async function rotatePdf(
  input: Uint8Array,
  rotation: 90 | 180 | 270,
): Promise<Uint8Array> {
  const doc = await load(input);
  for (const page of doc.getPages()) {
    const current = page.getRotation().angle;
    page.setRotation(degrees((current + rotation) % 360));
  }
  return doc.save();
}

export async function rotatePdfPages(
  input: Uint8Array,
  rotations: readonly QuarterTurn[],
): Promise<Uint8Array> {
  const doc = await load(input);
  const pdfPages = doc.getPages();
  if (rotations.length !== pdfPages.length) {
    throw new Error("Name a rotation for every page.");
  }
  pdfPages.forEach((page, index) => {
    const rotation = rotations[index];
    if (rotation === undefined || !isQuarterTurn(rotation)) {
      throw new Error("Rotation must be 0, 90, 180, or 270 degrees.");
    }
    if (rotation === 0) return;
    page.setRotation(degrees(turned(page.getRotation().angle, rotation)));
  });
  return doc.save();
}

export async function deletePdfPages(
  input: Uint8Array,
  oneBasedPages: number[],
): Promise<Uint8Array> {
  const doc = await load(input);
  const total = doc.getPageCount();
  const remove = [...new Set(oneBasedPages)]
    .filter((page) => page >= 1 && page <= total)
    .sort((a, b) => b - a);
  if (remove.length === 0) throw new Error("Name a page that exists.");
  if (remove.length >= total) throw new Error("A PDF needs at least one page.");
  for (const page of remove) doc.removePage(page - 1);
  return doc.save();
}

export async function reorderPdf(
  input: Uint8Array,
  oneBasedOrder: number[],
): Promise<Uint8Array> {
  const doc = await load(input);
  const total = doc.getPageCount();
  if (oneBasedOrder.length !== total) {
    throw new Error("The new order has to list every page once.");
  }
  const seen = new Set(oneBasedOrder);
  if (seen.size !== total || oneBasedOrder.some((page) => page < 1 || page > total)) {
    throw new Error("The new order has to list every page once.");
  }
  const out = await PDFDocument.create();
  const pages = await out.copyPages(
    doc,
    oneBasedOrder.map((page) => page - 1),
  );
  for (const page of pages) out.addPage(page);
  return out.save();
}

/** Keeps `pages` in that order. A page left out is deleted. */
export async function organizePdf(
  input: Uint8Array,
  pages: readonly { page: number; rotation: QuarterTurn }[],
): Promise<Uint8Array> {
  if (pages.length === 0) throw new Error("A PDF needs at least one page.");
  const total = await pageCount(input);
  const kept: { page: number; rotation: QuarterTurn }[] = [];
  const seen = new Set<number>();
  for (const entry of pages) {
    if (!Number.isInteger(entry.page) || entry.page < 1 || entry.page > total) {
      throw new Error("Name a page that exists.");
    }
    if (!isQuarterTurn(entry.rotation)) {
      throw new Error("Rotation must be 0, 90, 180, or 270 degrees.");
    }
    if (seen.has(entry.page)) {
      throw new Error("The new order has to list every page once.");
    }
    seen.add(entry.page);
    kept.push({ page: entry.page, rotation: entry.rotation });
  }
  const deleted: number[] = [];
  for (let page = 1; page <= total; page += 1) {
    if (!seen.has(page)) deleted.push(page);
  }
  // Delete and reorder first so each rotation applies to a page in the result.
  let current = input;
  if (deleted.length > 0) current = await deletePdfPages(current, deleted);
  const survivors = [...seen].sort((left, right) => left - right);
  const renumber = new Map(survivors.map((page, index) => [page, index + 1]));
  const order = kept.map((entry) => {
    const page = renumber.get(entry.page);
    if (page === undefined) throw new Error("Name a page that exists.");
    return page;
  });
  if (order.some((page, index) => page !== index + 1)) {
    current = await reorderPdf(current, order);
  }
  const rotations = kept.map((entry) => entry.rotation);
  if (rotations.some((rotation) => rotation !== 0)) {
    current = await rotatePdfPages(current, rotations);
  }
  return current;
}

export async function imagesToPdf(
  images: { bytes: Uint8Array; kind: ImageKind }[],
): Promise<Uint8Array> {
  if (images.length === 0) throw new Error("Add at least one image.");
  const doc = await PDFDocument.create();
  for (const image of images) {
    const embedded = await embed(doc, image.bytes, image.kind);
    const page = doc.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width: embedded.width,
      height: embedded.height,
    });
  }
  return doc.save();
}

async function embed(
  doc: PDFDocument,
  bytes: Uint8Array,
  kind: ImageKind,
): Promise<PDFImage> {
  if (kind === "jpg") return doc.embedJpg(bytes);
  return doc.embedPng(bytes);
}

/** Re-save the PDF with object streams. This is basic compress, not image downsampling. */
export async function compressPdf(input: Uint8Array): Promise<Uint8Array> {
  const doc = await load(input);
  return doc.save({ useObjectStreams: true });
}

export async function pageCount(input: Uint8Array): Promise<number> {
  const doc = await load(input);
  return doc.getPageCount();
}

type QpdfFs = {
  writeFile: (path: string, data: Uint8Array | string) => void;
  readFile: (path: string) => Uint8Array;
  unlink: (path: string) => void;
};

type QpdfModule = {
  callMain: (args: string[]) => number;
  FS: QpdfFs;
};

// The published glue loads qpdf.wasm from locateFile. Node reads that path
// from disk. The browser bundle fetches the same file as a Vite asset.
const wasmHref = new URL(
  "../node_modules/@neslinesli93/qpdf-wasm/dist/qpdf.wasm",
  import.meta.url,
).href;

const createQpdfModule = createQpdf as unknown as (options: {
  locateFile: () => string;
}) => Promise<QpdfModule>;

let modulePromise: Promise<QpdfModule> | undefined;
let queue: Promise<unknown> = Promise.resolve();

function loadQpdf(): Promise<QpdfModule> {
  modulePromise ??= createQpdfModule({ locateFile: () => wasmHref });
  return modulePromise;
}

function exclusive<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run, run);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function requirePassword(password: string, message: string): string {
  if (typeof password !== "string" || password.length === 0) {
    throw new Error(message);
  }
  return password;
}

// Job JSON so a password that starts with "-" is not parsed as a flag.
async function runJob(
  bytes: Uint8Array,
  job: Record<string, unknown>,
  failure: string,
): Promise<Uint8Array> {
  return exclusive(async () => {
    const qpdf = await loadQpdf();
    const id = crypto.randomUUID();
    const input = `/in-${id}.pdf`;
    const output = `/out-${id}.pdf`;
    const spec = `/job-${id}.json`;
    try {
      qpdf.FS.writeFile(input, bytes);
      qpdf.FS.writeFile(
        spec,
        JSON.stringify({ ...job, inputFile: input, outputFile: output }),
      );
      let code = 1;
      try {
        code = qpdf.callMain([`--job-json-file=${spec}`]);
      } catch {
        code = 1;
      } finally {
        // qpdf's Node quit hook leaves a failing status on the process.
        if (typeof process !== "undefined") process.exitCode = undefined;
      }
      if (code !== 0) throw new Error(failure);
      // readFile views wasm memory that the next call can reuse.
      return new Uint8Array(qpdf.FS.readFile(output));
    } finally {
      for (const path of [input, output, spec]) {
        try {
          qpdf.FS.unlink(path);
        } catch {
          // The file is absent when qpdf fails before writing it.
        }
      }
    }
  });
}

export async function protectPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const chosen = requirePassword(password, "Choose a password.");
  return runJob(
    bytes,
    {
      encrypt: {
        userPassword: chosen,
        ownerPassword: chosen,
        "256bit": {},
      },
    },
    "Could not protect this PDF.",
  );
}

export async function unlockPdf(bytes: Uint8Array, password: string): Promise<Uint8Array> {
  const known = requirePassword(password, "Enter the password you already know.");
  return runJob(
    bytes,
    {
      password: known,
      decrypt: "",
    },
    "That password did not open this PDF.",
  );
}
