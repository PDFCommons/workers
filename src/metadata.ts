import { PDFDict, PDFDocument, PDFName, PDFRef } from "pdf-lib";

const UNREADABLE = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";

const INFO_KEYS = [
  "Title",
  "Author",
  "Subject",
  "Keywords",
  "Creator",
  "Producer",
  "CreationDate",
  "ModDate",
] as const;

function stripInfo(doc: PDFDocument): void {
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  if (!(info instanceof PDFDict)) return;
  for (const key of INFO_KEYS) info.delete(PDFName.of(key));
}

function stripCatalogMetadata(doc: PDFDocument): void {
  const key = PDFName.of("Metadata");
  const metadata = doc.catalog.get(key);
  if (!metadata) return;
  doc.catalog.delete(key);
  if (metadata instanceof PDFRef) doc.context.delete(metadata);
}

/** Drop the info dictionary keys and the catalog metadata stream. Page content stays. */
export async function removePdfMetadata(input: Uint8Array): Promise<Uint8Array> {
  if (input.byteLength === 0) throw new Error(UNREADABLE);
  let doc: PDFDocument;
  try {
    // The default load writes Producer and ModDate before we can delete them.
    doc = await PDFDocument.load(input, { updateMetadata: false });
  } catch (error) {
    // pdf-lib's encrypted error is a plain Error. Its message is the worker error.
    if (
      error instanceof Error &&
      error.message.startsWith("Input document to `PDFDocument.load` is encrypted.")
    ) {
      throw error;
    }
    throw new Error(UNREADABLE);
  }
  if (doc.getPageCount() === 0) throw new Error(NO_PAGES);
  stripInfo(doc);
  stripCatalogMetadata(doc);
  return doc.save({ addDefaultPage: false });
}
