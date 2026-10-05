import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { PDFDict, PDFDocument, PDFName, StandardFonts, degrees, rgb } from "pdf-lib";

import { protectPdf } from "./index.ts";
import { splitVerticalPdf } from "./split-vertical.ts";
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
  doc.setAuthor("Keep Author");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const first = doc.addPage([200, 100]);
  first.drawText("ONE", { x: 20, y: 40, size: 18, font, color: rgb(0, 0, 0) });
  first.drawText("RIGHT", { x: 120, y: 40, size: 18, font });
  const link = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [10, 10, 80, 30],
    A: { Type: "Action", S: "URI", URI: "https://example.com/keep-link" },
  });
  first.node.set(PDFName.of("Annots"), doc.context.obj([link]));
  const second = doc.addPage([300, 150]);
  second.drawText("TWO", { x: 20, y: 40, size: 18, font });
  const third = doc.addPage([400, 200]);
  third.setRotation(degrees(90));
  third.drawText("THREE", { x: 20, y: 40, size: 18, font });
  return doc.save();
}

describe("splitVerticalPdf", () => {
  it("cuts each page into a left half and a right half", async () => {
    const out = await PDFDocument.load(await splitVerticalPdf(await sample()));
    assert.equal(out.getPageCount(), 6);
    assert.equal(out.getTitle(), "Keep Title");
    assert.equal(out.getAuthor(), "Keep Author");
    const left = out.getPage(0);
    const right = out.getPage(1);
    assert.equal(left.getWidth(), 100);
    assert.equal(left.getHeight(), 100);
    assert.equal(right.getWidth(), 100);
    assert.equal(right.getHeight(), 100);
    assert.equal(left.getMediaBox().x, 0);
    assert.equal(right.getMediaBox().x, 100);
    assert.equal(left.getCropBox().width, 100);
    assert.equal(right.getCropBox().x, 100);
    assert.equal(out.getPage(2).getWidth(), 150);
    assert.equal(out.getPage(2).getHeight(), 150);
    assert.equal(out.getPage(3).getWidth(), 150);
    assert.equal(out.getPage(3).getMediaBox().x, 150);
    assert.equal(out.getPage(4).getWidth(), 200);
    assert.equal(out.getPage(4).getHeight(), 200);
    assert.equal(out.getPage(5).getWidth(), 200);
    assert.equal(out.getPage(5).getHeight(), 200);
    assert.equal(out.getPage(4).getRotation().angle, 90);
    assert.equal(out.getPage(5).getRotation().angle, 90);
    assert.equal(out.getPage(5).getMediaBox().x, 200);
    assert.deepEqual(subtypes(out, 0), ["/Link"]);
    assert.deepEqual(subtypes(out, 1), ["/Link"]);
    const text = (await pdfToText(await out.save())).replace(/\n+/g, "\n").trim();
    assert.equal(text, "ONE\nRIGHT\nTWO\nTHREE");
  });

  it("cuts a single page into two pages", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([90, 40]);
    const out = await PDFDocument.load(await splitVerticalPdf(await doc.save()));
    assert.equal(out.getPageCount(), 2);
    assert.equal(out.getPage(0).getWidth(), 45);
    assert.equal(out.getPage(0).getHeight(), 40);
    assert.equal(out.getPage(1).getWidth(), 45);
    assert.equal(out.getPage(1).getMediaBox().x, 45);
  });

  it("refuses empty bytes", async () => {
    await assert.rejects(splitVerticalPdf(new Uint8Array()), /This PDF could not be read/);
  });

  it("refuses bytes that are not a PDF", async () => {
    await assert.rejects(splitVerticalPdf(new Uint8Array([1, 2, 3, 4])), /This PDF could not be read/);
  });

  it("refuses a PDF with no pages", async () => {
    const doc = await PDFDocument.create();
    await assert.rejects(
      splitVerticalPdf(await doc.save({ addDefaultPage: false })),
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
        splitVerticalPdf(locked),
        /Expected instance of PDFDict, but got instance of undefined/,
      );
    } finally {
      process.exitCode = previous;
    }
  });
});

describe("split-vertical worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./split-vertical.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
