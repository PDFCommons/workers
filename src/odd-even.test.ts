import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { PDFDict, PDFDocument, PDFName, StandardFonts, degrees, rgb } from "pdf-lib";

import { protectPdf } from "./index.ts";
import { oddEvenPdf } from "./odd-even.ts";
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

describe("oddEvenPdf", () => {
  it("keeps odd pages, title, rotation, and the link on page 1", async () => {
    const out = await PDFDocument.load(await oddEvenPdf(await sample(), "odd"));
    assert.equal(out.getPageCount(), 2);
    assert.equal(out.getTitle(), "Keep Title");
    assert.equal(out.getPage(0).getSize().width, 200);
    assert.equal(out.getPage(1).getSize().width, 400);
    assert.equal(out.getPage(0).getRotation().angle, 90);
    assert.equal(out.getPage(1).getRotation().angle, 180);
    assert.deepEqual(subtypes(out, 0), ["/Link"]);
    assert.equal(await pdfToText(await out.save()), "ONE\n\nTHREE");
  });

  it("keeps the even page and its link", async () => {
    const out = await PDFDocument.load(await oddEvenPdf(await sample(), "even"));
    assert.equal(out.getPageCount(), 1);
    assert.equal(out.getTitle(), "Keep Title");
    assert.equal(out.getPage(0).getSize().width, 300);
    assert.equal(out.getPage(0).getRotation().angle, 0);
    assert.deepEqual(subtypes(out, 0), ["/Link"]);
    assert.equal(await pdfToText(await out.save()), "TWO");
  });

  it("keeps a one-page file when the choice is odd", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]);
    const out = await PDFDocument.load(await oddEvenPdf(await doc.save(), "odd"));
    assert.equal(out.getPageCount(), 1);
    assert.equal(out.getPage(0).getSize().width, 200);
  });

  it("refuses even pages when the file has only page 1", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]);
    await assert.rejects(oddEvenPdf(await doc.save(), "even"), /This file has no even pages/);
  });

  it("refuses a side that is not odd or even", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]);
    await assert.rejects(oddEvenPdf(await doc.save(), "both"), /Name odd or even/);
  });

  it("refuses empty bytes", async () => {
    await assert.rejects(oddEvenPdf(new Uint8Array(), "odd"), /This PDF could not be read/);
  });

  it("refuses a PDF with no pages", async () => {
    const doc = await PDFDocument.create();
    await assert.rejects(oddEvenPdf(await doc.save({ addDefaultPage: false }), "odd"), /This PDF has no pages/);
  });

  it("quotes the locked-page error from pdf-lib", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]);
    const locked = await protectPdf(await doc.save(), "secret");
    const previous = process.exitCode;
    try {
      await assert.rejects(
        oddEvenPdf(locked, "odd"),
        /Expected instance of PDFDict, but got instance of undefined/,
      );
    } finally {
      process.exitCode = previous;
    }
  });
});

describe("odd-even worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./odd-even.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
