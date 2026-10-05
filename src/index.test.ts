import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  PDFRef,
  decodePDFRawStream,
  degrees,
} from "pdf-lib";
import {
  addPageNumbers,
  addWatermark,
  compressPdf,
  deletePdfPages,
  extractPdfRanges,
  mergePdfs,
  organizePdf,
  pageCount,
  protectPdf,
  reorderPdf,
  rotatePdf,
  rotatePdfPages,
  splitPdf,
  unlockPdf,
} from "./index.ts";

async function blank(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return doc.save();
}

async function contentText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const streams: PDFRawStream[] = [];
  const push = (value: unknown) => {
    if (value instanceof PDFRawStream) streams.push(value);
    else if (value instanceof PDFArray) {
      for (let index = 0; index < value.size(); index += 1) {
        push(doc.context.lookup(value.get(index)));
      }
    }
  };
  push(page.node.Contents());
  const decoded = streams
    .map((stream) => new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode()))
    .join("\n");
  return decoded.replace(/<([0-9A-Fa-f\s]+)>/g, (_match, hex: string) => {
    const compact = hex.replace(/\s+/g, "");
    if (compact.length % 2 !== 0) return `<${hex}>`;
    let text = "";
    for (let index = 0; index < compact.length; index += 2) {
      text += String.fromCharCode(parseInt(compact.slice(index, index + 2), 16));
    }
    return text;
  });
}

function pageStream(doc: PDFDocument, index: number): string {
  const contents = doc.getPage(index).node.Contents();
  if (!contents) return "";
  const parts = contents instanceof PDFArray ? contents.asArray() : [contents];
  return parts
    .map((part) => {
      const stream = part instanceof PDFRef ? doc.context.lookup(part) : part;
      if (!(stream instanceof PDFRawStream)) return "";
      return Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
    })
    .join("");
}

describe("workers", () => {
  it("merges pages from two files", async () => {
    const out = await mergePdfs([await blank(1), await blank(2)]);
    assert.equal(await pageCount(out), 3);
  });

  it("refuses to merge nothing", async () => {
    await assert.rejects(() => mergePdfs([]), /at least one PDF/);
  });

  it("splits one file per page", async () => {
    const parts = await splitPdf(await blank(3));
    assert.equal(parts.length, 3);
    for (const part of parts) assert.equal(await pageCount(part), 1);
  });

  it("extracts inclusive ranges and refuses a page that is not there", async () => {
    const src = await PDFDocument.create();
    src.addPage([100, 40]);
    src.addPage([200, 40]);
    src.addPage([300, 40]);
    const bytes = await src.save();
    const parts = await extractPdfRanges(bytes, [
      { start: 1, end: 2 },
      { start: 3, end: 3 },
    ]);
    assert.equal(parts.length, 2);
    const first = await PDFDocument.load(parts[0]!);
    const second = await PDFDocument.load(parts[1]!);
    assert.equal(first.getPageCount(), 2);
    assert.equal(first.getPage(0).getWidth(), 100);
    assert.equal(first.getPage(1).getWidth(), 200);
    assert.equal(second.getPage(0).getWidth(), 300);
    await assert.rejects(() => extractPdfRanges(bytes, [{ start: 1, end: 4 }]), /page that exists/);
    await assert.rejects(() => extractPdfRanges(bytes, []), /page that exists/);
  });

  it("rotates every page", async () => {
    const out = await rotatePdf(await blank(1), 90);
    const doc = await PDFDocument.load(out);
    assert.equal(doc.getPage(0).getRotation().angle, 90);
  });

  it("rotates each page by its own angle", async () => {
    const src = await PDFDocument.create();
    const first = src.addPage([100, 40]);
    first.setRotation(degrees(90));
    src.addPage([200, 40]);
    src.addPage([300, 40]);
    const out = await rotatePdfPages(await src.save(), [90, 270, 0]);
    const doc = await PDFDocument.load(out);
    assert.equal(doc.getPage(0).getRotation().angle, 180);
    assert.equal(doc.getPage(1).getRotation().angle, 270);
    assert.equal(doc.getPage(2).getRotation().angle, 0);
  });

  it("refuses a rotation for the wrong number of pages", async () => {
    const input = await blank(2);
    await assert.rejects(() => rotatePdfPages(input, [90]), /every page/);
  });

  it("refuses a rotation that is not a quarter turn", async () => {
    const input = await blank(1);
    await assert.rejects(() => rotatePdfPages(input, [45 as 0]), /0, 90, 180, or 270/);
  });

  it("deletes a page and keeps the rest", async () => {
    const out = await deletePdfPages(await blank(3), [2]);
    assert.equal(await pageCount(out), 2);
  });

  it("reorders pages", async () => {
    const src = await PDFDocument.create();
    src.addPage([100, 100]);
    src.addPage([200, 200]);
    const out = await reorderPdf(await src.save(), [2, 1]);
    const doc = await PDFDocument.load(out);
    assert.equal(doc.getPage(0).getWidth(), 200);
    assert.equal(doc.getPage(1).getWidth(), 100);
  });

  it("deletes, reorders, then rotates the pages that remain", async () => {
    const src = await PDFDocument.create();
    const first = src.addPage([100, 40]);
    first.setRotation(degrees(90));
    src.addPage([200, 40]);
    src.addPage([300, 40]);
    const out = await organizePdf(await src.save(), [
      { page: 3, rotation: 180 },
      { page: 1, rotation: 90 },
    ]);
    const doc = await PDFDocument.load(out);
    assert.equal(doc.getPageCount(), 2);
    assert.equal(doc.getPage(0).getWidth(), 300);
    assert.equal(doc.getPage(0).getRotation().angle, 180);
    assert.equal(doc.getPage(1).getWidth(), 100);
    assert.equal(doc.getPage(1).getRotation().angle, 180);
  });

  it("leaves every page when nothing changes", async () => {
    const out = await organizePdf(await blank(2), [
      { page: 1, rotation: 0 },
      { page: 2, rotation: 0 },
    ]);
    assert.equal(await pageCount(out), 2);
  });

  it("refuses to delete every page", async () => {
    const input = await blank(2);
    await assert.rejects(() => organizePdf(input, []), /at least one page/);
  });

  it("refuses a page that is not in the file", async () => {
    const input = await blank(1);
    await assert.rejects(
      () => organizePdf(input, [{ page: 2, rotation: 0 }]),
      /Name a page that exists/,
    );
  });

  it("refuses to list a page twice", async () => {
    const input = await blank(2);
    await assert.rejects(
      () =>
        organizePdf(input, [
          { page: 1, rotation: 0 },
          { page: 1, rotation: 90 },
        ]),
      /every page once/,
    );
  });

  it("numbers two pages from the given start", async () => {
    const out = await addPageNumbers(await blank(2), { startAt: 7 });
    assert.equal(await pageCount(out), 2);
    const doc = await PDFDocument.load(out);
    assert.equal(doc.getPageCount(), 2);
    assert.match(pageStream(doc, 0), /\(7\)/);
    assert.match(pageStream(doc, 1), /\(8\)/);
  });

  it("refuses to start page numbers at zero", async () => {
    const input = await blank(1);
    await assert.rejects(
      () => addPageNumbers(input, { startAt: 0 }),
      /Start at a whole number from 1\./,
    );
  });

  it("refuses to number a pdf with no pages", async () => {
    const doc = await PDFDocument.create();
    const input = await doc.save({ addDefaultPage: false });
    await assert.rejects(() => addPageNumbers(input), /This PDF has no pages\./);
  });

  it("compress returns a pdf", async () => {
    const out = await compressPdf(await blank(1));
    assert.equal(await pageCount(out), 1);
  });

  it("protects with a password and unlocks back to a pdf-lib document", async () => {
    const input = await blank(2);
    const password = "--secret";
    const protectedBytes = await protectPdf(input, password);
    assert.equal(Buffer.from(protectedBytes).equals(Buffer.from(input)), false);
    await assert.rejects(() => PDFDocument.load(protectedBytes), /encrypted/);
    const unlocked = await unlockPdf(protectedBytes, password);
    const doc = await PDFDocument.load(unlocked);
    assert.equal(doc.getPageCount(), 2);
  });

  it("refuses to protect or unlock without a password", async () => {
    const input = await blank(1);
    await assert.rejects(() => protectPdf(input, ""), /Choose a password/);
    await assert.rejects(() => unlockPdf(input, ""), /password you already know/);
  });

  it("does not unlock when the password is wrong", async () => {
    const protectedBytes = await protectPdf(await blank(1), "right");
    await assert.rejects(() => unlockPdf(protectedBytes, "wrong"), /did not open/);
  });

  it("rejects an empty watermark", async () => {
    const input = await blank(1);
    await assert.rejects(() => addWatermark(input, ""), /Enter the watermark text\./);
    await assert.rejects(() => addWatermark(input, "   "), /Enter the watermark text\./);
  });

  it("rejects a watermark longer than 80 characters", async () => {
    const input = await blank(1);
    await assert.rejects(
      () => addWatermark(input, "N".repeat(81)),
      /Use 80 characters or fewer\./,
    );
  });

  it("stamps NORTH once on a one-page pdf", async () => {
    const out = await addWatermark(await blank(1), "  NORTH  ");
    const doc = await PDFDocument.load(out);
    assert.equal(doc.getPageCount(), 1);
    assert.match(await contentText(out), /NORTH/);
  });

  it("rejects a pdf with no pages", async () => {
    const doc = await PDFDocument.create();
    const input = await doc.save({ addDefaultPage: false });
    await assert.rejects(() => addWatermark(input, "NORTH"), /This PDF has no pages\./);
  });
});
