import { PDFDocument } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";
const BAD_PAGE = "Name a page that exists.";

function rethrow(error: unknown): never {
  if (error instanceof Error) {
    if (error.message === NO_READ || error.message === NO_PAGES || error.message === BAD_PAGE) throw error;
    if (error.message.startsWith("Expected instance of PDFDict")) throw error;
  }
  throw new Error(NO_READ);
}

function missing(page: number, count: number): boolean {
  return !Number.isInteger(page) || page < 1 || page > count;
}

/** Exchange two 1-based pages. Every other page stays put. */
export async function swapPdfPages(input: Uint8Array, first: number, second: number): Promise<Uint8Array> {
  if (input.byteLength === 0) throw new Error(NO_READ);
  try {
    const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
    const count = doc.getPageCount();
    if (count === 0) throw new Error(NO_PAGES);
    if (missing(first, count) || missing(second, count) || first === second) throw new Error(BAD_PAGE);
    const pages = doc.getPages();
    const order = pages.slice();
    const left = order[first - 1];
    const right = order[second - 1];
    if (!left || !right) throw new Error(BAD_PAGE);
    order[first - 1] = right;
    order[second - 1] = left;
    for (let index = count - 1; index >= 0; index -= 1) doc.removePage(index);
    for (const page of order) doc.addPage(page);
    return doc.save();
  } catch (error) {
    rethrow(error);
  }
}
