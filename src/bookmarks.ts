import { PDFDict, PDFDocument, PDFName, PDFRef } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";

function keepLockedMessage(error: unknown): Error {
  if (error instanceof Error && error.message.startsWith("Expected instance of PDFDict")) {
    return error;
  }
  return new Error(NO_READ);
}

function collectOutline(doc: PDFDocument, ref: unknown, seen: Set<PDFRef>): void {
  if (!(ref instanceof PDFRef) || seen.has(ref)) return;
  seen.add(ref);
  const node = doc.context.lookup(ref);
  if (!(node instanceof PDFDict)) return;
  collectOutline(doc, node.get(PDFName.of("First")), seen);
  collectOutline(doc, node.get(PDFName.of("Next")), seen);
}

/** Drop the outline tree. Page text, links, names, and the info dictionary stay. */
export async function removePdfBookmarks(input: Uint8Array): Promise<Uint8Array> {
  if (input.byteLength === 0) throw new Error(NO_READ);
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  } catch (error) {
    throw keepLockedMessage(error);
  }
  if (doc.getPageCount() === 0) throw new Error(NO_PAGES);
  const seen = new Set<PDFRef>();
  collectOutline(doc, doc.catalog.get(PDFName.of("Outlines")), seen);
  for (const ref of seen) doc.context.delete(ref);
  doc.catalog.delete(PDFName.of("Outlines"));
  const mode = doc.catalog.get(PDFName.of("PageMode"));
  if (mode instanceof PDFName && mode.asString() === "/UseOutlines") {
    doc.catalog.delete(PDFName.of("PageMode"));
  }
  return doc.save();
}
