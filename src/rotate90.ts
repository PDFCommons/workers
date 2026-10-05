import { PDFDocument, degrees } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";
const LOCKED = "Expected instance of PDFDict, but got instance of undefined";

function plusQuarter(angle: number): 0 | 90 | 180 | 270 {
  const wrapped = ((Math.round(angle) % 360) + 360) % 360;
  const snapped = (Math.round(wrapped / 90) % 4) * 90;
  return ((snapped + 90) % 360) as 0 | 90 | 180 | 270;
}

function rethrow(error: unknown): never {
  if (error instanceof Error && error.message === NO_PAGES) throw error;
  if (error instanceof Error && error.message.includes(LOCKED)) throw error;
  throw new Error(NO_READ);
}

/** Add 90 degrees to every page rotation flag. The content stream stays. */
export async function rotatePdf90(input: Uint8Array): Promise<Uint8Array> {
  if (input.byteLength === 0) throw new Error(NO_READ);
  try {
    const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
    const pages = doc.getPages();
    if (pages.length === 0) throw new Error(NO_PAGES);
    for (const page of pages) {
      page.setRotation(degrees(plusQuarter(page.getRotation().angle)));
    }
    return doc.save({ updateFieldAppearances: false });
  } catch (error) {
    rethrow(error);
  }
}
