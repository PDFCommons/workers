import { PDFDocument, degrees } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";
const BAD_WAY = "Choose portrait or landscape.";

function shownSize(width: number, height: number, angle: number): { width: number; height: number } {
  const turn = ((Math.round(angle) % 360) + 360) % 360;
  if (turn === 90 || turn === 270) return { width: height, height: width };
  return { width, height };
}

/** Turn mismatched pages by 90 degrees. The media box, title, and annotations stay. */
export async function orientPdf(input: Uint8Array, way: string): Promise<Uint8Array> {
  if (input.byteLength === 0) throw new Error(NO_READ);
  if (way !== "portrait" && way !== "landscape") throw new Error(BAD_WAY);
  const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  const count = doc.getPageCount();
  if (count === 0) throw new Error(NO_PAGES);
  for (const page of doc.getPages()) {
    const size = page.getSize();
    const angle = page.getRotation().angle;
    const shown = shownSize(size.width, size.height, angle);
    const needsTurn = way === "portrait" ? shown.width > shown.height : shown.height > shown.width;
    if (!needsTurn) continue;
    const turn = ((Math.round(angle) % 360) + 360) % 360;
    page.setRotation(degrees((turn + 90) % 360));
  }
  return doc.save();
}
