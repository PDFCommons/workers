import {
  PDFContentStream,
  PDFDocument,
  PDFOperator,
  PDFOperatorNames,
  PDFString,
  StandardFonts,
  beginText,
  endText,
  popGraphicsState,
  pushGraphicsState,
  rgb,
  setFillingColor,
  setFontAndSize,
  setTextMatrix,
} from "pdf-lib";

const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";
const LOCKED = "Expected instance of PDFDict";

function keepLockedMessage(error: unknown): Error {
  if (error instanceof Error && error.message.startsWith(LOCKED)) return error;
  return new Error(NO_READ);
}

/** Draw "Page X of Y" on every page. Existing text and fields stay. */
export async function addPageXofY(input: Uint8Array): Promise<Uint8Array> {
  if (input.byteLength === 0) throw new Error(NO_READ);
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(input, { ignoreEncryption: true, updateMetadata: false });
  } catch (error) {
    throw keepLockedMessage(error);
  }
  const pages = doc.getPages();
  if (pages.length === 0) throw new Error(NO_PAGES);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const size = 12;
  const total = pages.length;
  pages.forEach((page, index) => {
    const text = `Page ${index + 1} of ${total}`;
    const textWidth = font.widthOfTextAtSize(text, size);
    const x = (page.getWidth() - textWidth) / 2;
    const y = page.getHeight() < 72 ? 8 : 36;
    const fontKey = page.node.newFontDictionary("F", font.ref);
    const stream = PDFContentStream.of(
      doc.context.obj({}),
      [
        pushGraphicsState(),
        beginText(),
        setFillingColor(rgb(0.11, 0.1, 0.08)),
        setFontAndSize(fontKey, size),
        setTextMatrix(1, 0, 0, 1, x, y),
        PDFOperator.of(PDFOperatorNames.ShowText, [PDFString.of(text)]),
        endText(),
        popGraphicsState(),
      ],
      false,
    );
    page.node.addContentStream(doc.context.register(stream));
  });
  return doc.save();
}
