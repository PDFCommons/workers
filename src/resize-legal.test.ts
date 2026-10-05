import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { PDFArray, PDFDocument, PDFRawStream, PDFRef, decodePDFRawStream, degrees } from "pdf-lib";

import { protectPdf } from "./index.ts";
import { resizePdfLegal } from "./resize-legal.ts";
import { pdfToText } from "./text.ts";

if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix as unknown as typeof globalThis.DOMMatrix;
if (!globalThis.ImageData) globalThis.ImageData = ImageData as unknown as typeof globalThis.ImageData;
if (!globalThis.Path2D) globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D;

async function pageBox(bytes: Uint8Array, index = 0): Promise<{ width: number; height: number; content: string }> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(index);
  const contents = page.node.Contents();
  const parts = contents instanceof PDFArray ? contents.asArray() : contents ? [contents] : [];
  const content = parts
    .map((part) => {
      const stream = part instanceof PDFRef ? doc.context.lookup(part) : part;
      if (!(stream instanceof PDFRawStream)) return "";
      return Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
    })
    .join("\n");
  return { width: page.getWidth(), height: page.getHeight(), content };
}

function drawnWidth(content: string, sourceWidth: number): number {
  const matches = [...content.matchAll(/([0-9.]+) 0 0 ([0-9.]+) [0-9.]+ [0-9.]+ cm/g)];
  assert.ok(matches.length > 0, content);
  const scales = matches.map((match) => {
    const xScale = Number(match[1]);
    assert.equal(xScale, Number(match[2]));
    return xScale;
  });
  const fitted = scales.filter((scale) => scale !== 1);
  const scale = fitted.length > 0 ? Math.min(...fitted) : Math.min(...scales);
  return scale * sourceWidth;
}

describe("resizePdfLegal", () => {
  it("turns a 200 by 100 page into a 612 by 1008 sheet", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]).drawText("Hello", { x: 20, y: 40, size: 18 });
    const out = await resizePdfLegal(await doc.save());
    const result = await PDFDocument.load(out);
    assert.equal(result.getPageCount(), 1);
    assert.equal(result.getPage(0).getWidth(), 612);
    assert.equal(result.getPage(0).getHeight(), 1008);
    const box = await pageBox(out);
    const drawn = drawnWidth(box.content, 200);
    assert.ok(drawn <= 612, `drawn ${drawn}`);
    assert.ok(drawn > 200, `scaled up ${drawn}`);
    assert.match(box.content, /1 0 0 1 0 351 cm/);
    assert.match(await pdfToText(out), /Hello/);
  });

  it("fits every page on a Legal sheet and leaves an empty page blank", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]);
    doc.addPage([2000, 1000]).drawRectangle({ x: 0, y: 0, width: 20, height: 20 });
    const out = await resizePdfLegal(await doc.save());
    const result = await PDFDocument.load(out);
    assert.equal(result.getPageCount(), 2);
    assert.equal(result.getPage(0).getWidth(), 612);
    assert.equal(result.getPage(0).getHeight(), 1008);
    assert.equal(result.getPage(1).getWidth(), 612);
    assert.equal(result.getPage(1).getHeight(), 1008);
    const blank = await pageBox(out, 0);
    assert.equal(blank.content.trim(), "");
    const drawn = await pageBox(out, 1);
    const width = drawnWidth(drawn.content, 2000);
    assert.ok(width <= 612, `drawn ${width}`);
    assert.ok(width < 2000);
  });

  it("uses the rotated size and still keeps the words", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 200]);
    page.drawText("Hello", { x: 40, y: 80 });
    page.setRotation(degrees(90));
    const out = await resizePdfLegal(await doc.save());
    const box = await pageBox(out);
    assert.equal(box.width, 612);
    assert.equal(box.height, 1008);
    assert.match(await pdfToText(out), /Hello/);
  });

  it("refuses empty bytes", async () => {
    await assert.rejects(resizePdfLegal(new Uint8Array()), /This PDF could not be read/);
  });

  it("refuses bytes that are not a PDF", async () => {
    await assert.rejects(resizePdfLegal(new Uint8Array([1, 2, 3, 4])), /This PDF could not be read/);
  });

  it("refuses a PDF with no pages", async () => {
    const doc = await PDFDocument.create();
    await assert.rejects(resizePdfLegal(await doc.save({ addDefaultPage: false })), /This PDF has no pages/);
  });

  it("quotes the locked-page error from pdf-lib", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]).drawText("Hello", { x: 40, y: 80 });
    const locked = await protectPdf(await doc.save(), "secret");
    const previous = process.exitCode;
    try {
      await assert.rejects(
        resizePdfLegal(locked),
        /Expected instance of PDFDict, but got instance of undefined/,
      );
    } finally {
      process.exitCode = previous;
    }
  });
});

describe("resize legal worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./resize-legal.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch"), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
