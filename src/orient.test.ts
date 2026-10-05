import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { PDFDict, PDFDocument, PDFName, StandardFonts, degrees, rgb } from "pdf-lib";

import { protectPdf } from "./index.ts";
import { orientPdf } from "./orient.ts";
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
  const wide = doc.addPage([200, 100]);
  wide.drawText("ONE", { x: 20, y: 40, size: 18, font, color: rgb(0, 0, 0) });
  const link = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [10, 10, 80, 30],
    A: { Type: "Action", S: "URI", URI: "https://example.com/keep-link" },
  });
  wide.node.set(PDFName.of("Annots"), doc.context.obj([link]));
  const tall = doc.addPage([100, 200]);
  tall.drawText("TWO", { x: 20, y: 40, size: 18, font });
  const turned = doc.addPage([200, 100]);
  turned.setRotation(degrees(90));
  turned.drawText("THREE", { x: 20, y: 40, size: 18, font });
  const square = doc.addPage([150, 150]);
  square.drawText("FOUR", { x: 20, y: 40, size: 18, font });
  return doc.save();
}

describe("orientPdf", () => {
  it("turns only wide pages to portrait and keeps the title, link, and box", async () => {
    const out = await PDFDocument.load(await orientPdf(await sample(), "portrait"));
    assert.equal(out.getPageCount(), 4);
    assert.equal(out.getTitle(), "Keep Title");
    assert.equal(out.getPage(0).getSize().width, 200);
    assert.equal(out.getPage(0).getSize().height, 100);
    assert.equal(out.getPage(0).getRotation().angle, 90);
    assert.equal(out.getPage(1).getSize().width, 100);
    assert.equal(out.getPage(1).getRotation().angle, 0);
    assert.equal(out.getPage(2).getRotation().angle, 90);
    assert.equal(out.getPage(3).getRotation().angle, 0);
    assert.deepEqual(subtypes(out, 0), ["/Link"]);
    assert.equal(await pdfToText(await out.save()), "ONE\n\nTWO\n\nTHREE\n\nFOUR");
  });

  it("turns only tall pages to landscape", async () => {
    const out = await PDFDocument.load(await orientPdf(await sample(), "landscape"));
    assert.equal(out.getPage(0).getRotation().angle, 0);
    assert.equal(out.getPage(0).getSize().width, 200);
    assert.equal(out.getPage(1).getRotation().angle, 90);
    assert.equal(out.getPage(1).getSize().width, 100);
    assert.equal(out.getPage(2).getRotation().angle, 180);
    assert.equal(out.getPage(3).getRotation().angle, 0);
    assert.equal(out.getTitle(), "Keep Title");
  });

  it("adds 90 degrees to a 180 degree landscape page", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 100]).setRotation(degrees(180));
    const out = await PDFDocument.load(await orientPdf(await doc.save(), "portrait"));
    assert.equal(out.getPage(0).getRotation().angle, 270);
    assert.equal(out.getPage(0).getSize().width, 300);
  });

  it("leaves a square page alone", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([120, 120]);
    const portrait = await PDFDocument.load(await orientPdf(await doc.save(), "portrait"));
    const landscape = await PDFDocument.load(await orientPdf(await doc.save(), "landscape"));
    assert.equal(portrait.getPage(0).getRotation().angle, 0);
    assert.equal(landscape.getPage(0).getRotation().angle, 0);
  });

  it("refuses a way that is not portrait or landscape", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]);
    await assert.rejects(orientPdf(await doc.save(), "sideways"), /Choose portrait or landscape/);
  });

  it("refuses empty bytes", async () => {
    await assert.rejects(orientPdf(new Uint8Array(), "portrait"), /This PDF could not be read/);
  });

  it("refuses a PDF with no pages", async () => {
    const doc = await PDFDocument.create();
    await assert.rejects(
      orientPdf(await doc.save({ addDefaultPage: false }), "portrait"),
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
        orientPdf(locked, "portrait"),
        /Expected instance of PDFDict, but got instance of undefined/,
      );
    } finally {
      process.exitCode = previous;
    }
  });
});

describe("orient worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./orient.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
