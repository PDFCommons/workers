import { PDFDict, PDFDocument, PDFName } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
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

function keepLockedMessage(error: unknown): Error {
  if (error instanceof Error && error.message.startsWith("Expected instance of PDFDict")) {
    return error;
  }
  return new Error(NO_READ);
}

/** Delete the document info dictionary fields. The bytes never leave the caller. */
export async function removePdfInfo(input: Uint8Array): Promise<Uint8Array> {
  if (input.byteLength === 0) throw new Error(NO_READ);
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  } catch (error) {
    throw keepLockedMessage(error);
  }
  if (doc.getPageCount() === 0) throw new Error(NO_PAGES);
  const info = doc.context.lookup(doc.context.trailerInfo.Info);
  if (info instanceof PDFDict) {
    for (const name of INFO_KEYS) info.delete(PDFName.of(name));
  }
  return doc.save();
}
