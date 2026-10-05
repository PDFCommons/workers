import { PDFDocument } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";

function dictError(caught: unknown): boolean {
  return caught instanceof Error && caught.message.includes("Expected instance of PDFDict");
}

/** Keep the first page and the last page. A one-page file stays one page. */
export async function keepFirstLastPdf(input: Uint8Array): Promise<Uint8Array> {
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
  for (let index = count - 2; index >= 1; index -= 1) doc.removePage(index);
  return doc.save();
}
