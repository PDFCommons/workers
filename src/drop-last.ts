import { PDFDocument } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";
const NEED_ONE = "A PDF needs at least one page.";

function keepLockedMessage(error: unknown): Error {
  if (error instanceof Error && error.message.startsWith("Expected instance of PDFDict")) return error;
  return new Error(NO_READ);
}

/** Delete the last page. Earlier pages stay in order. */
export async function dropLastPdfPage(input: Uint8Array): Promise<Uint8Array> {
  if (input.byteLength === 0) throw new Error(NO_READ);
  try {
    const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
    const count = doc.getPageCount();
    if (count === 0) throw new Error(NO_PAGES);
    if (count === 1) throw new Error(NEED_ONE);
    doc.removePage(count - 1);
    return doc.save();
  } catch (error) {
    if (error instanceof Error && (error.message === NO_PAGES || error.message === NEED_ONE)) throw error;
    throw keepLockedMessage(error);
  }
}
