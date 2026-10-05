import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { PDFDict, PDFDocument, PDFName, StandardFonts, degrees, rgb } from "pdf-lib";

import { protectPdf } from "./index.ts";
import { keepPdfRange } from "./keep-range.ts";
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

async function sample(): Promise<Uint8Array> {
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
  second.drawText("TWO", { x: 20, y: 40, size: 18, font });
  second.node.set(PDFName.of("Annots"), doc.context.obj([link]));
  const third = doc.addPage([400, 200]);
  third.setRotation(degrees(180));
  third.drawText("THREE", { x: 20, y: 40, size: 18, font });
  return doc.save();
}

describe("keepPdfRange", () => {
  it("keeps pages 2 through 3 in order with the title and the link", async () => {
    const out = await PDFDocument.load(await keepPdfRange(await sample(), 2, 3));
    assert.equal(out.getPageCount(), 2);
    assert.equal(out.getTitle(), "Keep Title");
    assert.equal(out.getPage(0).getSize().width, 300);
    assert.equal(out.getPage(1).getSize().width, 400);
    assert.equal(out.getPage(0).getRotation().angle, 0);
    assert.equal(out.getPage(1).getRotation().angle, 180);
    assert.deepEqual(subtypes(out, 0), ["/Link"]);
    assert.equal(await pdfToText(await out.save()), "TWO\n\nTHREE");
  });

  it("keeps a single page when start and end match", async () => {
    const out = await PDFDocument.load(await keepPdfRange(await sample(), 1, 1));
    assert.equal(out.getPageCount(), 1);
    assert.equal(out.getTitle(), "Keep Title");
    assert.equal(out.getPage(0).getSize().width, 200);
    assert.equal(out.getPage(0).getSize().height, 100);
    assert.equal(out.getPage(0).getRotation().angle, 90);
    assert.deepEqual(subtypes(out, 0), ["/Link"]);
    assert.equal(await pdfToText(await out.save()), "ONE");
  });

  it("keeps every page when the range is the whole file", async () => {
    const out = await PDFDocument.load(await keepPdfRange(await sample(), 1, 3));
    assert.equal(out.getPageCount(), 3);
    assert.equal(out.getTitle(), "Keep Title");
    assert.equal(await pdfToText(await out.save()), "ONE\n\nTWO\n\nTHREE");
  });

  it("refuses an end before the start", async () => {
    await assert.rejects(keepPdfRange(await sample(), 3, 2), /Name a page that exists/);
  });

  it("refuses a page past the end and a non-integer", async () => {
    const bytes = await sample();
    await assert.rejects(keepPdfRange(bytes, 2, 4), /Name a page that exists/);
    await assert.rejects(keepPdfRange(bytes, 1.5, 2), /Name a page that exists/);
    await assert.rejects(keepPdfRange(bytes, 0, 1), /Name a page that exists/);
  });

  it("refuses empty bytes", async () => {
    await assert.rejects(keepPdfRange(new Uint8Array(), 1, 1), /This PDF could not be read/);
  });

  it("refuses bytes that are not a PDF", async () => {
    await assert.rejects(keepPdfRange(new Uint8Array([1, 2, 3, 4]), 1, 1), /This PDF could not be read/);
  });

  it("refuses a PDF with no pages", async () => {
    const doc = await PDFDocument.create();
    await assert.rejects(
      keepPdfRange(await doc.save({ addDefaultPage: false }), 1, 1),
      /This PDF has no pages/,
    );
  });

  it("quotes the locked-page error from pdf-lib", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]);
    const locked = await protectPdf(await doc.save(), "secret");
    const previous = process.exitCode;
    try {
      await assert.rejects(
        keepPdfRange(locked, 1, 1),
        /Expected instance of PDFDict, but got instance of undefined/,
      );
    } finally {
      process.exitCode = previous;
    }
  });
});

describe("keep-range worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./keep-range.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
