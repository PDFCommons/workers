import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { PDFDocument, PageSizes, degrees } from "pdf-lib";

import { protectPdf } from "./index.ts";
import { pdfToText } from "./text.ts";
import { twoUpPdf } from "./two-up.ts";

if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix as unknown as typeof globalThis.DOMMatrix;
if (!globalThis.ImageData) globalThis.ImageData = ImageData as unknown as typeof globalThis.ImageData;
if (!globalThis.Path2D) globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D;

describe("twoUpPdf", () => {
  it("places two pages on one landscape Letter sheet and keeps a third page", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]).drawText("Hello", { x: 20, y: 40, size: 18 });
    doc.addPage([100, 400]).drawText("Right", { x: 20, y: 40, size: 18 });
    doc.addPage([180, 90]).drawText("Odd", { x: 20, y: 40, size: 18 });
    const out = await twoUpPdf(await doc.save(), "letter");
    const result = await PDFDocument.load(out);
    assert.equal(result.getPageCount(), 2);
    assert.equal(result.getPage(0).getWidth(), 792);
    assert.equal(result.getPage(0).getHeight(), 612);
    assert.equal(result.getPage(0).getWidth(), Math.max(...PageSizes.Letter));
    assert.equal(result.getPage(0).getHeight(), Math.min(...PageSizes.Letter));
    const text = await pdfToText(out);
    assert.match(text, /Hello/);
    assert.match(text, /Right/);
    assert.match(text, /Odd/);
  });

  it("uses a landscape A4 sheet for one source page", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]).drawText("Hello", { x: 40, y: 80 });
    const out = await twoUpPdf(await doc.save(), "a4");
    const result = await PDFDocument.load(out);
    assert.equal(result.getPageCount(), 1);
    assert.equal(result.getPage(0).getWidth(), 841.89);
    assert.equal(result.getPage(0).getHeight(), 595.28);
    assert.equal(result.getPage(0).getWidth(), Math.max(...PageSizes.A4));
    assert.equal(result.getPage(0).getHeight(), Math.min(...PageSizes.A4));
  });

  it("keeps rotated standard-font words", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 200]);
    page.drawText("Hello", { x: 40, y: 80 });
    page.setRotation(degrees(90));
    const out = await twoUpPdf(await doc.save(), "letter");
    const text = await pdfToText(out);
    assert.match(text, /Hello/);
  });

  it("refuses empty bytes", async () => {
    await assert.rejects(
      () => twoUpPdf(new Uint8Array(), "letter"),
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
      () => twoUpPdf(bytes, "letter"),
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
      () => twoUpPdf(bytes, "legal" as "letter"),
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
        () => twoUpPdf(locked, "letter"),
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

describe("two-up worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./two-up.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch"), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
