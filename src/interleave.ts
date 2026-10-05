import { PDFDocument } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";
const NEED_SECOND = "Add the second PDF.";
const BAD_ORDER = "Name plain or reverse.";

/** Alternate pages from two PDFs. Reverse flips only the second file first. */
export async function interleavePdf(
  first: Uint8Array,
  second: Uint8Array,
  order: string,
): Promise<Uint8Array> {
  if (first.byteLength === 0) throw new Error(NO_READ);
  if (second.byteLength === 0) throw new Error(NEED_SECOND);
  if (order !== "plain" && order !== "reverse") throw new Error(BAD_ORDER);
  const front = await PDFDocument.load(first, { ignoreEncryption: true, updateMetadata: false });
  const back = await PDFDocument.load(second, { ignoreEncryption: true, updateMetadata: false });
  const frontCount = front.getPageCount();
  const backCount = back.getPageCount();
  if (frontCount === 0 || backCount === 0) throw new Error(NO_PAGES);
  const backIndexes = back.getPageIndices().slice();
  if (order === "reverse") backIndexes.reverse();
  const out = await PDFDocument.create();
  const title = front.getTitle();
  if (typeof title === "string" && title.length > 0) out.setTitle(title);
  const frontPages = await out.copyPages(front, front.getPageIndices());
  const backPages = await out.copyPages(back, backIndexes);
  const pairs = Math.max(frontPages.length, backPages.length);
  for (let index = 0; index < pairs; index += 1) {
    const lead = frontPages[index];
    const follow = backPages[index];
    if (lead) out.addPage(lead);
    if (follow) out.addPage(follow);
  }
  return out.save();
}
