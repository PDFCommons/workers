import { PDFDocument } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";
const BAD_PAGE = "Name a page that exists.";

/** Insert one copy of a page immediately after that page. */
export async function duplicatePdfPage(input: Uint8Array, page: number): Promise<Uint8Array> {
  if (input.byteLength === 0) throw new Error(NO_READ);
  const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  const count = doc.getPageCount();
  if (count === 0) throw new Error(NO_PAGES);
  if (!Number.isInteger(page) || page < 1 || page > count) throw new Error(BAD_PAGE);
  const [copy] = await doc.copyPages(doc, [page - 1]);
  doc.insertPage(page, copy);
  return doc.save();
}
