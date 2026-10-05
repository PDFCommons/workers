import { PDFDocument } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";
const BAD_N = "Enter a whole number of pages.";

function dictError(caught: unknown): boolean {
  return caught instanceof Error && caught.message.includes("Expected instance of PDFDict");
}

/** Insert a blank page, matching that page's size, after every Nth page. */
export async function blankEveryN(input: Uint8Array, every: number): Promise<Uint8Array> {
  if (!Number.isInteger(every) || every < 1) throw new Error(BAD_N);
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
  for (let page = Math.floor(count / every) * every; page >= every; page -= every) {
    const reference = doc.getPage(page - 1);
    doc.insertPage(page, [reference.getWidth(), reference.getHeight()]);
  }
  return doc.save();
}
