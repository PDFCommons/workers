import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { PDFDict, PDFDocument, PDFName, StandardFonts, degrees, rgb } from "pdf-lib";

import { interleavePdf } from "./interleave.ts";
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

async function pair(): Promise<{ front: Uint8Array; back: Uint8Array }> {
  const front = await PDFDocument.create();
  front.setTitle("Keep Title");
  const font = await front.embedFont(StandardFonts.Helvetica);
  const first = front.addPage([200, 100]);
  first.setRotation(degrees(90));
  first.drawText("ONE", { x: 20, y: 40, size: 18, font, color: rgb(0, 0, 0) });
  const link = front.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [10, 10, 80, 30],
    A: { Type: "Action", S: "URI", URI: "https://example.com/keep-link" },
  });
  first.node.set(PDFName.of("Annots"), front.context.obj([link]));
  const third = front.addPage([400, 200]);
  third.setRotation(degrees(180));
  third.drawText("THREE", { x: 20, y: 40, size: 18, font });
  const back = await PDFDocument.create();
  back.setTitle("Drop Title");
  const backFont = await back.embedFont(StandardFonts.Helvetica);
  const second = back.addPage([300, 150]);
  second.drawText("TWO", { x: 20, y: 40, size: 18, font: backFont });
  const backLink = back.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [10, 10, 80, 30],
    A: { Type: "Action", S: "URI", URI: "https://example.com/keep-link" },
  });
  second.node.set(PDFName.of("Annots"), back.context.obj([backLink]));
  const fourth = back.addPage([500, 250]);
  fourth.drawText("FOUR", { x: 20, y: 40, size: 18, font: backFont });
  return { front: await front.save(), back: await back.save() };
}

describe("interleavePdf", () => {
  it("alternates pages and keeps the first title, sizes, rotation, and links", async () => {
    const { front, back } = await pair();
    const out = await PDFDocument.load(await interleavePdf(front, back, "plain"));
    assert.equal(out.getPageCount(), 4);
    assert.equal(out.getTitle(), "Keep Title");
    assert.equal(out.getPage(0).getSize().width, 200);
    assert.equal(out.getPage(1).getSize().width, 300);
    assert.equal(out.getPage(2).getSize().width, 400);
    assert.equal(out.getPage(3).getSize().width, 500);
    assert.equal(out.getPage(0).getRotation().angle, 90);
    assert.equal(out.getPage(2).getRotation().angle, 180);
    assert.deepEqual(subtypes(out, 0), ["/Link"]);
    assert.deepEqual(subtypes(out, 1), ["/Link"]);
    assert.equal(await pdfToText(await out.save()), "ONE\n\nTWO\n\nTHREE\n\nFOUR");
  });

  it("reverses only the second file before the mix", async () => {
    const { front, back } = await pair();
    const out = await PDFDocument.load(await interleavePdf(front, back, "reverse"));
    assert.equal(out.getTitle(), "Keep Title");
    assert.equal(out.getPage(0).getSize().width, 200);
    assert.equal(out.getPage(1).getSize().width, 500);
    assert.equal(out.getPage(2).getSize().width, 400);
    assert.equal(out.getPage(3).getSize().width, 300);
    assert.equal(await pdfToText(await out.save()), "ONE\n\nFOUR\n\nTHREE\n\nTWO");
  });

  it("keeps leftover pages when the second file is shorter", async () => {
    const front = await PDFDocument.create();
    front.addPage([200, 100]);
    front.addPage([400, 200]);
    const back = await PDFDocument.create();
    back.addPage([300, 150]);
    const out = await PDFDocument.load(await interleavePdf(await front.save(), await back.save(), "plain"));
    assert.equal(out.getPageCount(), 3);
    assert.equal(out.getPage(0).getSize().width, 200);
    assert.equal(out.getPage(1).getSize().width, 300);
    assert.equal(out.getPage(2).getSize().width, 400);
  });

  it("refuses an empty first file", async () => {
    const back = await PDFDocument.create();
    back.addPage([200, 100]);
    await assert.rejects(interleavePdf(new Uint8Array(), await back.save(), "plain"), /This PDF could not be read/);
  });

  it("refuses a missing second file", async () => {
    const front = await PDFDocument.create();
    front.addPage([200, 100]);
    await assert.rejects(interleavePdf(await front.save(), new Uint8Array(), "plain"), /Add the second PDF/);
  });

  it("refuses a PDF with no pages", async () => {
    const front = await PDFDocument.create();
    const back = await PDFDocument.create();
    back.addPage([200, 100]);
    await assert.rejects(
      interleavePdf(await front.save({ addDefaultPage: false }), await back.save(), "plain"),
      /This PDF has no pages/,
    );
  });

  it("refuses an order that is not plain or reverse", async () => {
    const front = await PDFDocument.create();
    front.addPage([200, 100]);
    const back = await PDFDocument.create();
    back.addPage([200, 100]);
    await assert.rejects(interleavePdf(await front.save(), await back.save(), "both"), /Name plain or reverse/);
  });

  it("quotes the locked-page error from pdf-lib", async () => {
    const front = await PDFDocument.create();
    front.addPage([200, 100]);
    const back = await PDFDocument.create();
    back.addPage([200, 100]);
    const locked = await protectPdf(await front.save(), "secret");
    const previous = process.exitCode;
    try {
      await assert.rejects(
        interleavePdf(locked, await back.save(), "plain"),
        /Expected instance of PDFDict, but got instance of undefined/,
      );
    } finally {
      process.exitCode = previous;
    }
  });
});

describe("interleave worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./interleave.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
