import { zipSync } from "fflate";
import { PDFDocument } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";

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

/** Pack one PDF per page into a zip named by the caller as page-1.pdf onward. */
export async function onePagePdfs(input: Uint8Array): Promise<Uint8Array> {
  if (input.byteLength === 0) throw new Error(NO_READ);
  try {
    const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
    const total = doc.getPageCount();
    if (total === 0) throw new Error(NO_PAGES);
    const title = doc.getTitle();
    const entries: Record<string, Uint8Array> = {};
    for (let index = 0; index < total; index += 1) {
      const out = await PDFDocument.create();
      const [page] = await out.copyPages(doc, [index]);
      if (!page) throw new Error(NO_PAGES);
      out.addPage(page);
      if (title) out.setTitle(title);
      entries[`page-${index + 1}.pdf`] = await out.save();
    }
    return zipSync(entries);
  } catch (error) {
    rethrow(error);
  }
}
