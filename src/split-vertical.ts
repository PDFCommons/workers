import { PDFDocument } from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";

function dictError(caught: unknown): boolean {
  return caught instanceof Error && caught.message.includes("Expected instance of PDFDict");
}

/** Cut each page at the vertical midpoint of its media box, left half then right. */
export async function splitVerticalPdf(input: Uint8Array): Promise<Uint8Array> {
  if (input.byteLength === 0) throw new Error(NO_READ);
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  } catch (caught) {
    if (dictError(caught)) throw caught;
    throw new Error(NO_READ);
  }
  const count = doc.getPageCount();
  if (count === 0) throw new Error(NO_PAGES);
  for (let index = count - 1; index >= 0; index -= 1) {
    const source = doc.getPage(index);
    const media = source.getMediaBox();
    const mid = media.width / 2;
    const [copy] = await doc.copyPages(doc, [index]);
    if (!copy) throw new Error(NO_PAGES);
    doc.insertPage(index + 1, copy);
    source.setMediaBox(media.x, media.y, mid, media.height);
    source.setCropBox(media.x, media.y, mid, media.height);
    copy.setMediaBox(media.x + mid, media.y, media.width - mid, media.height);
    copy.setCropBox(media.x + mid, media.y, media.width - mid, media.height);
  }
  return doc.save();
}
