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
