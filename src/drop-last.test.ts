import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { PDFDict, PDFDocument, PDFName, StandardFonts, degrees, rgb } from "pdf-lib";

import { dropLastPdfPage } from "./drop-last.ts";
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

describe("dropLastPdfPage", () => {
  it("drops TWO and keeps ONE, the title, the rotation, and the link", async () => {
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
    doc.addPage([300, 150]).drawText("TWO", { x: 20, y: 40, size: 18, font });
    const saved = await dropLastPdfPage(await doc.save());
    assert.equal(Buffer.from(saved).includes(Buffer.from("/AcroForm")), false);
    const out = await PDFDocument.load(saved);
    assert.equal(out.getPageCount(), 1);
    assert.equal(out.getTitle(), "Keep Title");
    assert.equal(out.getPage(0).getSize().width, 200);
    assert.equal(out.getPage(0).getSize().height, 100);
    assert.equal(out.getPage(0).getRotation().angle, 90);
    assert.deepEqual(subtypes(out, 0), ["/Link"]);
    assert.equal(await pdfToText(saved), "ONE");
  });

  it("keeps earlier pages in order when the last of three leaves", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([200, 100]).drawText("ONE", { x: 20, y: 40, size: 18, font });
    doc.addPage([220, 110]).drawText("TWO", { x: 20, y: 40, size: 18, font });
    doc.addPage([240, 120]).drawText("THREE", { x: 20, y: 40, size: 18, font });
    const out = await PDFDocument.load(await dropLastPdfPage(await doc.save()));
    assert.equal(out.getPageCount(), 2);
    assert.equal(out.getPage(0).getSize().width, 200);
    assert.equal(out.getPage(1).getSize().width, 220);
    assert.equal(await pdfToText(await out.save()), "ONE\n\nTWO");
  });

  it("refuses to leave the document with no pages", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]);
    await assert.rejects(dropLastPdfPage(await doc.save()), /A PDF needs at least one page/);
  });

  it("refuses empty bytes", async () => {
    await assert.rejects(dropLastPdfPage(new Uint8Array()), /This PDF could not be read/);
  });

  it("refuses bytes that are not a PDF", async () => {
    await assert.rejects(dropLastPdfPage(new TextEncoder().encode("not a pdf")), /This PDF could not be read/);
  });

  it("refuses a PDF with no pages", async () => {
    const doc = await PDFDocument.create();
    await assert.rejects(dropLastPdfPage(await doc.save({ addDefaultPage: false })), /This PDF has no pages/);
  });

  it("quotes the locked-page error from pdf-lib", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]);
    doc.addPage([300, 150]);
    const locked = await protectPdf(await doc.save(), "secret");
    const previous = process.exitCode;
    try {
      await assert.rejects(
        dropLastPdfPage(locked),
        /Expected instance of PDFDict, but got instance of undefined/,
      );
    } finally {
      process.exitCode = previous;
    }
  });
});

describe("drop-last worker source", () => {
  it("does not rasterize or open a network connection", () => {
    const source = readFileSync(new URL("./drop-last.ts", import.meta.url), "utf8");
    assert.equal(source.includes("ignoreEncryption: true"), true);
    assert.equal(source.includes("updateMetadata: false"), true);
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
    assert.equal(source.includes("raster"), false);
    assert.equal(source.includes("embedPng"), false);
    assert.equal(source.includes("drawPage"), false);
  });
});
