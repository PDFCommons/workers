import { PDFDocument } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";

/** Flip page order inside the same document. Title, rotation, annotations, and fields stay on their pages. */
export async function reversePdf(input: Uint8Array): Promise<Uint8Array> {
  if (input.byteLength === 0) throw new Error(NO_READ);
  const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  const count = doc.getPageCount();
  if (count === 0) throw new Error(NO_PAGES);
  if (count === 1) return doc.save();
  const pages = doc.getPages();
  for (let index = count - 1; index >= 0; index -= 1) doc.removePage(index);
  for (let index = count - 1; index >= 0; index -= 1) {
    const page = pages[index];
    if (!page) throw new Error(NO_PAGES);
    doc.addPage(page);
  }
  return doc.save();
}
