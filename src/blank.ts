import { PDFDocument } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";
const BAD_AFTER = "Name a page that exists.";

function keepLockedMessage(error: unknown): Error {
  if (error instanceof Error && error.message.startsWith("Expected instance of PDFDict")) {
    return error;
  }
  return new Error(NO_READ);
}

/** Insert one empty page. The bytes never leave the caller. */
export async function addBlankPage(input: Uint8Array, after: number): Promise<Uint8Array> {
  if (input.byteLength === 0) throw new Error(NO_READ);
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input, { ignoreEncryption: true });
  } catch (error) {
    throw keepLockedMessage(error);
  }
  const count = doc.getPageCount();
  if (count === 0) throw new Error(NO_PAGES);
  if (!Number.isInteger(after) || after < 0 || after > count) {
    throw new Error(BAD_AFTER);
  }
  const reference = doc.getPage(after === 0 ? 0 : after - 1);
  doc.insertPage(after, [reference.getWidth(), reference.getHeight()]);
  return doc.save();
}
