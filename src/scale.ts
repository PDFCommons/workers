import { PDFDocument } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";
const CHOOSE = "Choose 50, 75, 150, or 200 percent.";

const PERCENTS = [50, 75, 150, 200] as const;
export type ScalePercent = (typeof PERCENTS)[number];

function isPercent(value: number): value is ScalePercent {
  return value === 50 || value === 75 || value === 150 || value === 200;
}

/** Scale every page box, its drawing, and its annotations by one allowed percent. */
export async function scalePdf(input: Uint8Array, percent: number): Promise<Uint8Array> {
  if (input.byteLength === 0) throw new Error(NO_READ);
  if (!isPercent(percent)) throw new Error(CHOOSE);
  const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  if (doc.getPageCount() === 0) throw new Error(NO_PAGES);
  const factor = percent / 100;
  for (const page of doc.getPages()) page.scale(factor, factor);
  return doc.save();
}
