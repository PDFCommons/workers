import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  StandardFonts,
  decodePDFRawStream,
  degrees,
  rgb,
} from "pdf-lib";

import { protectPdf } from "./index.ts";
import { rotatePdf90 } from "./rotate90.ts";

function streamBytes(doc: PDFDocument, index: number): Buffer {
  const contents = doc.getPage(index).node.Contents();
  if (!contents) return Buffer.alloc(0);
  const parts = contents instanceof PDFArray ? contents.asArray() : [contents];
  return Buffer.concat(
    parts.map((part) => {
      const stream = part instanceof PDFRef ? doc.context.lookup(part) : part;
      if (!(stream instanceof PDFRawStream)) return Buffer.alloc(0);
      return Buffer.from(decodePDFRawStream(stream).decode());
    }),
  );
}

describe("rotatePdf90", () => {
  it("adds 90 degrees on a wide page and leaves the content stream", async () => {
    const doc = await PDFDocument.create();
    doc.setTitle("Keep Title");
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([200, 100]);
    page.drawText("ONE", { x: 20, y: 40, size: 18, font, color: rgb(0, 0, 0) });
    const link = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [10, 10, 80, 30],
      A: { Type: "Action", S: "URI", URI: "https://example.com/keep-link" },
    });
    page.node.set(PDFName.of("Annots"), doc.context.obj([link]));
    const input = await doc.save();
    const before = await PDFDocument.load(input);
    const beforeStream = streamBytes(before, 0);
    const out = await rotatePdf90(input);
    const after = await PDFDocument.load(out);
    assert.equal(after.getPageCount(), 1);
    assert.equal(after.getTitle(), "Keep Title");
    assert.equal(after.getPage(0).getWidth(), 200);
    assert.equal(after.getPage(0).getHeight(), 100);
    assert.equal(after.getPage(0).getRotation().angle, 90);
    assert.deepEqual(streamBytes(after, 0), beforeStream);
    const annots = after.getPage(0).node.Annots();
    assert.ok(annots);
    const annot = after.context.lookup(annots.get(0));
    assert.equal(String(annot.get(PDFName.of("Subtype"))), "/Link");
  });

  it("turns a square page and walks 90, 180, 270, and 0", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([150, 150]);
    const right = doc.addPage([200, 100]);
    right.setRotation(degrees(90));
    const half = doc.addPage([200, 100]);
    half.setRotation(degrees(180));
    const left = doc.addPage([200, 100]);
    left.setRotation(degrees(270));
    const odd = doc.addPage([80, 40]);
    odd.node.set(PDFName.of("Rotate"), PDFNumber.of(45));
    const negative = doc.addPage([80, 40]);
    negative.node.set(PDFName.of("Rotate"), PDFNumber.of(-90));
    const out = await PDFDocument.load(await rotatePdf90(await doc.save()));
    assert.equal(out.getPage(0).getSize().width, 150);
    assert.equal(out.getPage(0).getRotation().angle, 90);
    assert.equal(out.getPage(1).getRotation().angle, 180);
    assert.equal(out.getPage(1).getSize().width, 200);
    assert.equal(out.getPage(2).getRotation().angle, 270);
    assert.equal(out.getPage(3).getRotation().angle, 0);
    assert.equal(out.getPage(4).getRotation().angle, 180);
    assert.equal(out.getPage(5).getRotation().angle, 0);
  });

  it("refuses empty bytes", async () => {
    await assert.rejects(rotatePdf90(new Uint8Array()), /This PDF could not be read/);
  });

  it("refuses bytes that are not a PDF", async () => {
    await assert.rejects(rotatePdf90(new TextEncoder().encode("not a pdf")), /This PDF could not be read/);
  });

  it("refuses a PDF with no pages", async () => {
    const doc = await PDFDocument.create();
    await assert.rejects(rotatePdf90(await doc.save({ addDefaultPage: false })), /This PDF has no pages/);
  });

  it("quotes the locked-page error from pdf-lib", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]);
    const locked = await protectPdf(await doc.save(), "secret");
    const previous = process.exitCode;
    try {
      await assert.rejects(
        rotatePdf90(locked),
        /Expected instance of PDFDict, but got instance of undefined/,
      );
    } finally {
      process.exitCode = previous;
    }
  });
});

describe("rotate90 worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./rotate90.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
