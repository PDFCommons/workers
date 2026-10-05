import { PDFDocument } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";
const BAD_PAGE = "Name a page that exists.";
const NEED_ONE = "A PDF needs at least one page.";

function keepLockedMessage(error: unknown): Error {
  if (error instanceof Error && error.message.startsWith("Expected instance of PDFDict")) {
    return error;
  }
  return new Error(NO_READ);
}

/** Remove one 1-based page. The other pages stay in order. */
export async function deletePdfPage(input: Uint8Array, page: number): Promise<Uint8Array> {
  if (input.byteLength === 0) throw new Error(NO_READ);
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  } catch (error) {
    throw keepLockedMessage(error);
  }
  const count = doc.getPageCount();
  if (count === 0) throw new Error(NO_PAGES);
  if (!Number.isInteger(page) || page < 1 || page > count) throw new Error(BAD_PAGE);
  if (count === 1) throw new Error(NEED_ONE);
  doc.removePage(page - 1);
  return doc.save();
}
