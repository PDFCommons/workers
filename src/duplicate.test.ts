import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { PDFDict, PDFDocument, PDFName, StandardFonts, degrees, rgb } from "pdf-lib";

import { duplicatePdfPage } from "./duplicate.ts";
import { protectPdf } from "./index.ts";
import { pdfToText } from "./text.ts";

if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix as unknown as typeof globalThis.DOMMatrix;
if (!globalThis.ImageData) globalThis.ImageData = ImageData as unknown as typeof globalThis.ImageData;
if (!globalThis.Path2D) globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D;

function subtypes(doc: PDFDocument, index: number): string[] {
  const annots = doc.getPage(index).node.Annots();
  if (!annots) return [];
  const found: string[] = [];
  for (let item = 0; item < annots.size(); item += 1) {
    const annot = doc.context.lookup(annots.get(item));
    if (!(annot instanceof PDFDict)) continue;
    found.push(String(annot.get(PDFName.of("Subtype"))));
  }
  return found;
}

describe("duplicatePdfPage", () => {
  it("inserts a copy of page 1 and keeps the later page, title, and rotation", async () => {
    const doc = await PDFDocument.create();
    doc.setTitle("Keep Title");
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const first = doc.addPage([200, 100]);
    first.setRotation(degrees(90));
    first.drawText("ONE", { x: 20, y: 40, size: 18, font, color: rgb(0, 0, 0) });
    const link = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [10, 10, 80, 30],
      A: { Type: "Action", S: "URI", URI: "https://example.com/keep-link" },
    });
    first.node.set(PDFName.of("Annots"), doc.context.obj([link]));
    const second = doc.addPage([300, 150]);
    second.drawText("TWO", { x: 20, y: 40, size: 18, font, color: rgb(0, 0, 0) });
    const out = await PDFDocument.load(await duplicatePdfPage(await doc.save(), 1));
    assert.equal(out.getPageCount(), 3);
    assert.equal(out.getTitle(), "Keep Title");
    assert.equal(out.getPage(0).getSize().width, 200);
    assert.equal(out.getPage(1).getSize().width, 200);
    assert.equal(out.getPage(2).getSize().width, 300);
    assert.equal(out.getPage(0).getRotation().angle, 90);
    assert.equal(out.getPage(1).getRotation().angle, 90);
    assert.equal(out.getPage(2).getRotation().angle, 0);
    assert.deepEqual(subtypes(out, 0), ["/Link"]);
    assert.deepEqual(subtypes(out, 1), ["/Link"]);
    assert.equal(await pdfToText(await out.save()), "ONE\n\nONE\n\nTWO");
  });

  it("appends the copy when the last page is chosen", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([200, 100]).drawText("ONE", { x: 20, y: 40, size: 18, font });
    doc.addPage([300, 150]).drawText("TWO", { x: 20, y: 40, size: 18, font });
    const out = await PDFDocument.load(await duplicatePdfPage(await doc.save(), 2));
    assert.equal(out.getPageCount(), 3);
    assert.equal(out.getPage(2).getSize().width, 300);
    assert.equal(await pdfToText(await out.save()), "ONE\n\nTWO\n\nTWO");
  });

  it("refuses a page that is not in the file", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]);
    const bytes = await doc.save();
    await assert.rejects(duplicatePdfPage(bytes, 0), /Name a page that exists/);
    await assert.rejects(duplicatePdfPage(bytes, 2), /Name a page that exists/);
    await assert.rejects(duplicatePdfPage(bytes, 1.5), /Name a page that exists/);
  });

  it("refuses empty bytes", async () => {
    await assert.rejects(duplicatePdfPage(new Uint8Array(), 1), /This PDF could not be read/);
  });

  it("refuses a PDF with no pages", async () => {
    const doc = await PDFDocument.create();
    await assert.rejects(duplicatePdfPage(await doc.save({ addDefaultPage: false }), 1), /This PDF has no pages/);
  });

  it("quotes the locked-page error from pdf-lib", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]);
    const locked = await protectPdf(await doc.save(), "secret");
    const previous = process.exitCode;
    try {
      await assert.rejects(
        duplicatePdfPage(locked, 1),
        /Expected instance of PDFDict, but got instance of undefined/,
      );
    } finally {
      process.exitCode = previous;
    }
  });
});

describe("duplicate worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./duplicate.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
