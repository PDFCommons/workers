import { PDFDocument, PDFName, PDFRef } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";

/** Burn AcroForm appearances into the page and drop the form. Other annotations stay. */
export async function flattenPdf(input: Uint8Array): Promise<Uint8Array> {
  if (input.byteLength === 0) throw new Error(NO_READ);
  const doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  if (doc.getPageCount() === 0) throw new Error(NO_PAGES);
  doc.getForm().flatten();
  const key = PDFName.of("AcroForm");
  const acro = doc.catalog.get(key);
  if (acro) {
    doc.catalog.delete(key);
    if (acro instanceof PDFRef) doc.context.delete(acro);
  }
  return doc.save();
}
