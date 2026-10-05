import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { PDFDocument, PageSizes, degrees } from "pdf-lib";

import { fourUpPdf } from "./four-up.ts";
import { protectPdf } from "./index.ts";
import { pdfToText } from "./text.ts";

if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix as unknown as typeof globalThis.DOMMatrix;
if (!globalThis.ImageData) globalThis.ImageData = ImageData as unknown as typeof globalThis.ImageData;
if (!globalThis.Path2D) globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D;

function page(doc: PDFDocument, width: number, height: number, text: string) {
  doc.addPage([width, height]).drawText(text, { x: 20, y: 40, size: 18 });
}

describe("fourUpPdf", () => {
  it("places four pages on one portrait Letter sheet and keeps a fifth page", async () => {
    const doc = await PDFDocument.create();
    page(doc, 200, 100, "ONE");
    page(doc, 180, 120, "TWO");
    page(doc, 160, 140, "THREE");
    page(doc, 140, 160, "FOUR");
    page(doc, 120, 180, "FIVE");
    const out = await fourUpPdf(await doc.save(), "letter");
    const result = await PDFDocument.load(out);
    assert.equal(result.getPageCount(), 2);
    assert.equal(result.getPage(0).getWidth(), 612);
    assert.equal(result.getPage(0).getHeight(), 792);
    assert.equal(result.getPage(0).getWidth(), Math.min(...PageSizes.Letter));
    assert.equal(result.getPage(0).getHeight(), Math.max(...PageSizes.Letter));
    const text = await pdfToText(out);
    assert.match(text, /ONE/);
    assert.match(text, /TWO/);
    assert.match(text, /THREE/);
    assert.match(text, /FOUR/);
    assert.match(text, /FIVE/);
    assert.ok(text.indexOf("ONE") < text.indexOf("TWO"));
    assert.ok(text.indexOf("TWO") < text.indexOf("THREE"));
    assert.ok(text.indexOf("THREE") < text.indexOf("FOUR"));
  });

  it("uses a portrait A4 sheet for one source page", async () => {
    const doc = await PDFDocument.create();
    page(doc, 300, 300, "Hello");
    const out = await fourUpPdf(await doc.save(), "a4");
    const result = await PDFDocument.load(out);
    assert.equal(result.getPageCount(), 1);
    assert.equal(result.getPage(0).getWidth(), 595.28);
    assert.equal(result.getPage(0).getHeight(), 841.89);
    assert.equal(result.getPage(0).getWidth(), Math.min(...PageSizes.A4));
    assert.equal(result.getPage(0).getHeight(), Math.max(...PageSizes.A4));
  });

  it("keeps rotated standard-font words", async () => {
    const doc = await PDFDocument.create();
    const sheet = doc.addPage([400, 200]);
    sheet.drawText("Hello", { x: 40, y: 80 });
    sheet.setRotation(degrees(90));
    const out = await fourUpPdf(await doc.save(), "letter");
    const text = await pdfToText(out);
    assert.match(text, /Hello/);
  });

  it("refuses empty bytes", async () => {
    await assert.rejects(
      () => fourUpPdf(new Uint8Array(), "letter"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "This PDF could not be read.");
        return true;
      },
    );
  });

  it("refuses a PDF with no pages", async () => {
    const doc = await PDFDocument.create();
    const bytes = await doc.save({ addDefaultPage: false });
    await assert.rejects(
      () => fourUpPdf(bytes, "letter"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "This PDF has no pages.");
        return true;
      },
    );
  });

  it("refuses a paper other than letter or a4", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const bytes = await doc.save();
    await assert.rejects(
      () => fourUpPdf(bytes, "legal" as "letter"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "Choose Letter or A4.");
        return true;
      },
    );
  });

  it("quotes the locked-page error from pdf-lib", async () => {
    try {
      const doc = await PDFDocument.create();
      doc.addPage().drawText("Hello", { x: 40, y: 80 });
      const locked = await protectPdf(await doc.save(), "secret");
      await assert.rejects(
        () => fourUpPdf(locked, "letter"),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, "Expected instance of PDFDict, but got instance of undefined");
          return true;
        },
      );
    } finally {
      if (typeof process !== "undefined") process.exitCode = undefined;
    }
  });
});

describe("four-up worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./four-up.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch"), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
