import { PDFDocument } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";
const BAD_PAGE = "Name a page that exists.";

function dictError(caught: unknown): boolean {
  return caught instanceof Error && caught.message.includes("Expected instance of PDFDict");
}

/** Keep an inclusive 1-based page range, in order, in the same PDF. */
export async function keepPdfRange(input: Uint8Array, start: number, end: number): Promise<Uint8Array> {
  if (input.byteLength === 0) throw new Error(NO_READ);
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  } catch (caught) {
    if (dictError(caught)) throw caught;
    throw new Error(NO_READ);
  }
  const count = doc.getPageCount();
  if (count === 0) throw new Error(NO_PAGES);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > count) {
    throw new Error(BAD_PAGE);
  }
  for (let index = count - 1; index >= 0; index -= 1) {
    const page = index + 1;
    if (page < start || page > end) doc.removePage(index);
  }
  return doc.save();
}
