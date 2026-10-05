import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { PDFDict, PDFDocument, PDFName, StandardFonts, degrees, rgb } from "pdf-lib";

import { blankEveryN } from "./blank-every.ts";
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

async function sample(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Keep Title");
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

describe("blankEveryN", () => {
  it("inserts a same-size blank after every page", async () => {
    const out = await PDFDocument.load(await blankEveryN(await sample(), 1));
    assert.equal(out.getPageCount(), 6);
    assert.equal(out.getTitle(), "Keep Title");
    assert.equal(out.getPage(0).getWidth(), 200);
    assert.equal(out.getPage(0).getHeight(), 100);
    assert.equal(out.getPage(1).getWidth(), 200);
    assert.equal(out.getPage(1).getHeight(), 100);
    assert.equal(out.getPage(1).node.Contents(), undefined);
    assert.equal(out.getPage(2).getWidth(), 300);
    assert.equal(out.getPage(2).getHeight(), 150);
    assert.equal(out.getPage(3).node.Contents(), undefined);
    assert.equal(out.getPage(4).getWidth(), 400);
    assert.equal(out.getPage(4).getHeight(), 200);
    assert.equal(out.getPage(5).getWidth(), 400);
    assert.equal(out.getPage(5).getHeight(), 200);
    assert.equal(out.getPage(5).node.Contents(), undefined);
    assert.equal(out.getPage(4).getRotation().angle, 90);
    assert.equal(out.getPage(5).getRotation().angle, 0);
    assert.deepEqual(subtypes(out, 0), ["/Link"]);
    assert.equal((await pdfToText(await out.save())).replace(/\n+/g, "\n").trim(), "ONE\nTWO\nTHREE");
  });

  it("inserts a blank after page 2 and page 4", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    doc.addPage([200, 100]).drawText("ONE", { x: 20, y: 40, size: 18, font });
    doc.addPage([210, 110]).drawText("TWO", { x: 20, y: 40, size: 18, font });
    doc.addPage([220, 120]).drawText("THREE", { x: 20, y: 40, size: 18, font });
    doc.addPage([230, 130]).drawText("FOUR", { x: 20, y: 40, size: 18, font });
    const out = await PDFDocument.load(await blankEveryN(await doc.save(), 2));
    assert.equal(out.getPageCount(), 6);
    assert.equal(out.getPage(0).getWidth(), 200);
    assert.equal(out.getPage(1).getWidth(), 210);
    assert.equal(out.getPage(2).getWidth(), 210);
    assert.equal(out.getPage(2).node.Contents(), undefined);
    assert.equal(out.getPage(3).getWidth(), 220);
    assert.equal(out.getPage(4).getWidth(), 230);
    assert.equal(out.getPage(5).getWidth(), 230);
    assert.equal(out.getPage(5).node.Contents(), undefined);
    assert.equal((await pdfToText(await out.save())).replace(/\n+/g, "\n").trim(), "ONE\nTWO\nTHREE\nFOUR");
  });

  it("inserts nothing when N is larger than the page count", async () => {
    const out = await PDFDocument.load(await blankEveryN(await sample(), 5));
    assert.equal(out.getPageCount(), 3);
    assert.equal(out.getTitle(), "Keep Title");
    assert.equal(await pdfToText(await out.save()), "ONE\n\nTWO\n\nTHREE");
  });

  it("refuses a count that is not a whole number of 1 or more", async () => {
    const bytes = await sample();
    await assert.rejects(blankEveryN(bytes, 0), /Enter a whole number of pages/);
    await assert.rejects(blankEveryN(bytes, 1.5), /Enter a whole number of pages/);
    await assert.rejects(blankEveryN(bytes, -2), /Enter a whole number of pages/);
  });

  it("refuses empty bytes", async () => {
    await assert.rejects(blankEveryN(new Uint8Array(), 1), /This PDF could not be read/);
  });

  it("refuses bytes that are not a PDF", async () => {
    await assert.rejects(blankEveryN(new Uint8Array([1, 2, 3, 4]), 1), /This PDF could not be read/);
  });

  it("refuses a PDF with no pages", async () => {
    const doc = await PDFDocument.create();
    await assert.rejects(
      blankEveryN(await doc.save({ addDefaultPage: false }), 1),
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
        blankEveryN(locked, 1),
        /Expected instance of PDFDict, but got instance of undefined/,
      );
    } finally {
      process.exitCode = previous;
    }
  });
});

describe("blank-every worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./blank-every.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
