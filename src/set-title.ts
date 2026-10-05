import { PDFDocument } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";
const NEED_TITLE = "Enter a title.";
const LONG_TITLE = "Use 200 characters or fewer.";

function keepLockedMessage(error: unknown): Error {
  if (error instanceof Error && error.message.startsWith("Expected instance of PDFDict")) {
    return error;
  }
  return new Error(NO_READ);
}

/** Write the info-dictionary Title. Author, Subject, and catalog XMP stay. */
export async function setPdfTitle(input: Uint8Array, title: string): Promise<Uint8Array> {
  const trimmed = title.trim();
  if (trimmed.length === 0) throw new Error(NEED_TITLE);
  if (trimmed.length > 200) throw new Error(LONG_TITLE);
  if (input.byteLength === 0) throw new Error(NO_READ);
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  } catch (error) {
    throw keepLockedMessage(error);
  }
  if (doc.getPageCount() === 0) throw new Error(NO_PAGES);
  doc.setTitle(trimmed);
  return doc.save();
}
