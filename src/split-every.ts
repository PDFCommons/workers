import { zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";
const BAD_N = "Enter a whole number of pages.";

function rethrow(error: unknown): never {
  if (error instanceof Error) {
    if (
      error.message === NO_PAGES ||
      error.message === NO_READ ||
      error.message.startsWith("Expected instance of PDFDict")
    ) {
      throw error;
    }
  }
  throw new Error(NO_READ);
}

/** Pack chunks of at most `n` pages into a zip of part-1.pdf, part-2.pdf, and so on. */
export async function splitEveryN(input: Uint8Array, n: number): Promise<Uint8Array> {
  if (!Number.isInteger(n) || n < 1) throw new Error(BAD_N);
  if (input.byteLength === 0) throw new Error(NO_READ);
  try {
    const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
    const total = doc.getPageCount();
    if (total === 0) throw new Error(NO_PAGES);
    const entries: Record<string, Uint8Array> = {};
    let part = 0;
    for (let start = 0; start < total; start += n) {
      part += 1;
      const count = Math.min(n, total - start);
      const indexes = Array.from({ length: count }, (_, offset) => start + offset);
      const out = await PDFDocument.create();
      const copied = await out.copyPages(doc, indexes);
      for (const page of copied) out.addPage(page);
      entries[`part-${part}.pdf`] = await out.save();
    }
    return zipSync(entries);
  } catch (error) {
    rethrow(error);
  }
}
