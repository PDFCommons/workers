import { PDFDocument } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";
const BAD_SIDE = "Name odd or even.";
const NO_ODD = "This file has no odd pages.";
const NO_EVEN = "This file has no even pages.";

/** Keep odd or even 1-based pages and drop the other side. */
export async function oddEvenPdf(input: Uint8Array, side: string): Promise<Uint8Array> {
  if (input.byteLength === 0) throw new Error(NO_READ);
  if (side !== "odd" && side !== "even") throw new Error(BAD_SIDE);
  const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  const count = doc.getPageCount();
  if (count === 0) throw new Error(NO_PAGES);
  const keep = (page: number) => (side === "odd" ? page % 2 === 1 : page % 2 === 0);
  let kept = 0;
  for (let page = 1; page <= count; page += 1) if (keep(page)) kept += 1;
  if (kept === 0) throw new Error(side === "odd" ? NO_ODD : NO_EVEN);
  for (let index = count - 1; index >= 0; index -= 1) {
    if (!keep(index + 1)) doc.removePage(index);
  }
  return doc.save();
}
