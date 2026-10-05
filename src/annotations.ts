import { PDFDict, PDFDocument, PDFName, PDFRef } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";

/** Drop link and comment annotations. Form widgets stay on the page. */
export async function removePdfAnnotations(input: Uint8Array): Promise<Uint8Array> {
  if (input.byteLength === 0) throw new Error(NO_READ);
  const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  if (doc.getPageCount() === 0) throw new Error(NO_PAGES);
  for (const page of doc.getPages()) {
    const annots = page.node.Annots();
    if (!annots) continue;
    const widgets: PDFRef[] = [];
    for (let index = 0; index < annots.size(); index += 1) {
      const ref = annots.get(index);
      const annot = doc.context.lookup(ref);
      if (annot instanceof PDFDict && String(annot.get(PDFName.of("Subtype"))) === "/Widget" && ref instanceof PDFRef) {
        widgets.push(ref);
      }
    }
    if (widgets.length === 0) page.node.delete(PDFName.of("Annots"));
    else page.node.set(PDFName.of("Annots"), doc.context.obj(widgets));
  }
  return doc.save();
}
