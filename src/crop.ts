import { PDFDocument } from "pdf-lib";

const WHOLE = "Enter a whole number of points.";
const LEAVE = "Leave at least one point of the page.";
const NO_PAGES = "This PDF has no pages.";
const NO_READ = "This PDF could not be read.";
const LOCKED = "Expected instance of PDFDict, but got instance of undefined";

type Box = { x: number; y: number; width: number; height: number };

function inset(box: Box, trim: number): Box {
  return {
    x: box.x + trim,
    y: box.y + trim,
    width: box.width - trim * 2,
    height: box.height - trim * 2,
  };
}

export async function cropPdf(input: Uint8Array, trim: number): Promise<Uint8Array> {
  if (!Number.isInteger(trim) || trim < 0) throw new Error(WHOLE);
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input, { ignoreEncryption: true });
  } catch (error) {
    if (error instanceof Error && error.message === LOCKED) throw error;
    throw new Error(NO_READ);
  }
  const pages = doc.getPages();
  if (pages.length === 0) throw new Error(NO_PAGES);
  const next = pages.map((page) => inset(page.getCropBox(), trim));
  if (next.some((box) => box.width <= 1 || box.height <= 1)) {
    throw new Error(LEAVE);
  }
  if (trim !== 0) {
    pages.forEach((page, index) => {
      const box = next[index];
      if (!box) return;
      page.setCropBox(box.x, box.y, box.width, box.height);
    });
  }
  return doc.save();
}
