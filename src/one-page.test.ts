import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { unzipSync } from "fflate";
import { PDFDict, PDFDocument, PDFName, StandardFonts, degrees, rgb } from "pdf-lib";

import { protectPdf } from "./index.ts";
import { onePagePdfs } from "./one-page.ts";
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

function packed(zip: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(zip);
}

describe("onePagePdfs", () => {
  it("packs one PDF per page and keeps size, text, rotation, link, and title", async () => {
    const zip = packed(await onePagePdfs(await sample()));
    assert.deepEqual(Object.keys(zip).sort(), ["page-1.pdf", "page-2.pdf", "page-3.pdf"]);
    const first = await PDFDocument.load(zip["page-1.pdf"]!);
    const second = await PDFDocument.load(zip["page-2.pdf"]!);
    const third = await PDFDocument.load(zip["page-3.pdf"]!);
    assert.equal(first.getPageCount(), 1);
    assert.equal(second.getPageCount(), 1);
    assert.equal(third.getPageCount(), 1);
    assert.equal(first.getTitle(), "Keep Title");
    assert.equal(second.getTitle(), "Keep Title");
    assert.equal(third.getTitle(), "Keep Title");
    assert.equal(first.getAuthor(), undefined);
    assert.equal(first.getPage(0).getWidth(), 200);
    assert.equal(first.getPage(0).getHeight(), 100);
    assert.equal(second.getPage(0).getWidth(), 300);
    assert.equal(second.getPage(0).getHeight(), 150);
    assert.equal(third.getPage(0).getWidth(), 400);
    assert.equal(third.getPage(0).getHeight(), 200);
    assert.equal(third.getPage(0).getRotation().angle, 90);
    assert.deepEqual(subtypes(first, 0), ["/Link"]);
    assert.equal((await pdfToText(zip["page-1.pdf"]!)).replace(/\n+/g, "\n").trim(), "ONE");
    assert.equal((await pdfToText(zip["page-2.pdf"]!)).replace(/\n+/g, "\n").trim(), "TWO");
    assert.equal((await pdfToText(zip["page-3.pdf"]!)).replace(/\n+/g, "\n").trim(), "THREE");
  });

  it("packs a one-page file as page-1.pdf only", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([90, 40]);
    const zip = packed(await onePagePdfs(await doc.save()));
    assert.deepEqual(Object.keys(zip), ["page-1.pdf"]);
    const only = await PDFDocument.load(zip["page-1.pdf"]!);
    assert.equal(only.getPageCount(), 1);
    assert.equal(only.getPage(0).getWidth(), 90);
    assert.equal(only.getPage(0).getHeight(), 40);
  });

  it("refuses empty bytes", async () => {
    await assert.rejects(onePagePdfs(new Uint8Array()), /This PDF could not be read/);
  });

  it("refuses bytes that are not a PDF", async () => {
    await assert.rejects(onePagePdfs(new Uint8Array([1, 2, 3, 4])), /This PDF could not be read/);
  });

  it("refuses a PDF with no pages", async () => {
    const doc = await PDFDocument.create();
    await assert.rejects(onePagePdfs(await doc.save({ addDefaultPage: false })), /This PDF has no pages/);
  });

  it("quotes the locked-page error from pdf-lib", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]);
    const locked = await protectPdf(await doc.save(), "secret");
    const previous = process.exitCode;
    try {
      await assert.rejects(
        onePagePdfs(locked),
        /Expected instance of PDFDict, but got instance of undefined/,
      );
    } finally {
      process.exitCode = previous;
    }
  });
});

describe("one-page worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./one-page.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
