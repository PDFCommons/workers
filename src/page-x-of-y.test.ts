import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  StandardFonts,
  decodePDFRawStream,
  rgb,
} from "pdf-lib";

import { protectPdf } from "./index.ts";
import { addPageXofY } from "./page-x-of-y.ts";
import { pdfToText } from "./text.ts";

if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix as unknown as typeof globalThis.DOMMatrix;
if (!globalThis.ImageData) globalThis.ImageData = ImageData as unknown as typeof globalThis.ImageData;
if (!globalThis.Path2D) globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D;

function pageStream(doc: PDFDocument, index: number): string {
  const contents = doc.getPage(index).node.Contents();
  if (!contents) return "";
  const parts = contents instanceof PDFArray ? contents.asArray() : [contents];
  return parts
    .map((part) => {
      const stream = part instanceof PDFRef ? doc.context.lookup(part) : part;
      if (!(stream instanceof PDFRawStream)) return "";
      return Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
    })
    .join("");
}

function baseline(stream: string): { x: number; y: number } {
  const match = stream.match(/1 0 0 1 ([0-9.]+) ([0-9.]+) Tm\n\(Page [^)]+\) Tj/);
  assert.ok(match, stream);
  return { x: Number(match[1]), y: Number(match[2]) };
}

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

describe("addPageXofY", () => {
  it("writes Page 1 of 1 on a one-page file", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]);
    const out = await addPageXofY(await doc.save());
    assert.equal(await pdfToText(out), "Page 1 of 1");
    const loaded = await PDFDocument.load(out);
    const stream = pageStream(loaded, 0);
    assert.match(stream, /\(Page 1 of 1\)/);
    assert.match(stream, /12 Tf/);
    assert.match(stream, /0\.11 0\.1 0\.08 rg/);
    assert.equal(loaded.catalog.get(PDFName.of("AcroForm")), undefined);
    assert.deepEqual(subtypes(loaded, 0), []);
    const font = await loaded.embedFont(StandardFonts.Helvetica);
    const width = font.widthOfTextAtSize("Page 1 of 1", 12);
    const point = baseline(stream);
    assert.ok(Math.abs(point.x - (200 - width) / 2) < 0.01, `${point.x}`);
    assert.equal(point.y, 36);
  });

  it("numbers every page and keeps text already on the page", async () => {
    const doc = await PDFDocument.create();
    doc.setTitle("Keep Title");
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const first = doc.addPage([200, 100]);
    first.drawText("9", { x: 20, y: 80, size: 18, font, color: rgb(0, 0, 0) });
    doc.addPage([200, 40]).drawText("OLD", { x: 20, y: 20, size: 12, font });
    const out = await addPageXofY(await doc.save());
    const loaded = await PDFDocument.load(out);
    assert.equal(loaded.getTitle(), "Keep Title");
    assert.equal(loaded.getPageCount(), 2);
    assert.equal(await pdfToText(out), "9\nPage 1 of 2\n\nOLD\nPage 2 of 2");
    assert.match(pageStream(loaded, 0), /<39> Tj/);
    assert.match(pageStream(loaded, 0), /\(Page 1 of 2\)/);
    assert.equal(baseline(pageStream(loaded, 0)).y, 36);
    assert.equal(baseline(pageStream(loaded, 1)).y, 8);
    assert.equal(loaded.catalog.get(PDFName.of("AcroForm")), undefined);
  });

  it("uses 36 points when the page is exactly 72 tall", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([240, 72]);
    const out = await PDFDocument.load(await addPageXofY(await doc.save()));
    assert.equal(baseline(pageStream(out, 0)).y, 36);
  });

  it("does not add a form field", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 100]);
    const form = doc.getForm();
    form.createTextField("already").addToPage(page, { x: 10, y: 50, width: 80, height: 16 });
    const out = await PDFDocument.load(await addPageXofY(await doc.save()));
    assert.deepEqual(
      out.getForm().getFields().map((field) => field.getName()),
      ["already"],
    );
    assert.deepEqual(subtypes(out, 0), ["/Widget"]);
    assert.match(pageStream(out, 0), /\(Page 1 of 1\)/);
  });

  it("refuses empty bytes", async () => {
    await assert.rejects(addPageXofY(new Uint8Array()), /This PDF could not be read/);
  });

  it("refuses bytes that are not a PDF", async () => {
    await assert.rejects(
      addPageXofY(new TextEncoder().encode("not a pdf")),
      /This PDF could not be read/,
    );
  });

  it("refuses a PDF with no pages", async () => {
    const doc = await PDFDocument.create();
    await assert.rejects(
      addPageXofY(await doc.save({ addDefaultPage: false })),
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
        addPageXofY(locked),
        /Expected instance of PDFDict, but got instance of undefined/,
      );
    } finally {
      process.exitCode = previous;
    }
  });
});

describe("page x of y worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./page-x-of-y.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
