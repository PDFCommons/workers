import { PDFDict, PDFDocument, PDFName, type PDFObject } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";

function rethrowKnown(error: unknown): never {
  if (error instanceof Error) {
    if (error.message === NO_PAGES) throw error;
    if (error.message.startsWith("Expected instance of PDFDict")) throw error;
  }
  throw new Error(NO_READ);
}

/** Drop Link annotations. Every other annotation and every form widget stays. */
export async function removePdfLinks(input: Uint8Array): Promise<Uint8Array> {
  if (input.byteLength === 0) throw new Error(NO_READ);
  try {
    const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
    if (doc.getPageCount() === 0) throw new Error(NO_PAGES);
    for (const page of doc.getPages()) {
      const annots = page.node.Annots();
      if (!annots) continue;
      const kept: PDFObject[] = [];
      for (let index = 0; index < annots.size(); index += 1) {
        const ref = annots.get(index);
        const annot = doc.context.lookup(ref);
        if (annot instanceof PDFDict && String(annot.get(PDFName.of("Subtype"))) === "/Link") continue;
        kept.push(ref);
      }
      if (kept.length === 0) page.node.delete(PDFName.of("Annots"));
      else page.node.set(PDFName.of("Annots"), doc.context.obj(kept));
    }
    return doc.save();
  } catch (error) {
    rethrowKnown(error);
  }
}
