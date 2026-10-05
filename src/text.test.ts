import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";

import { protectPdf } from "./index.ts";
import { pdfToText } from "./text.ts";

if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix as unknown as typeof globalThis.DOMMatrix;
if (!globalThis.ImageData) globalThis.ImageData = ImageData as unknown as typeof globalThis.ImageData;
if (!globalThis.Path2D) globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D;

describe("pdfToText", () => {
  it("extracts Hello from a one-page PDF", async () => {
    const doc = await PDFDocument.create();
    doc.addPage().drawText("Hello", { x: 40, y: 80 });
    const text = await pdfToText(await doc.save());
    assert.match(text, /Hello/);
  });

  it("joins pages with a blank line", async () => {
    const doc = await PDFDocument.create();
    doc.addPage().drawText("Hello", { x: 40, y: 80 });
    doc.addPage().drawText("Second", { x: 40, y: 80 });
    const text = await pdfToText(await doc.save());
    const hello = text.indexOf("Hello");
    const gap = text.indexOf("\n\n", hello);
    const second = text.indexOf("Second");
    assert.ok(hello >= 0 && gap > hello && second > gap);
    assert.ok(text.includes("Hello\n\nSecond") || (hello < gap && gap < second));
  });

  it("refuses a blank page", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const bytes = await doc.save();
    await assert.rejects(
      () => pdfToText(bytes),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(
          error.message,
          "This PDF has no text layer. A scan needs OCR, which this page does not do.",
        );
        return true;
      },
    );
  });

  it("refuses empty bytes", async () => {
    await assert.rejects(
      () => pdfToText(new Uint8Array()),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "This PDF could not be read.");
        return true;
      },
    );
  });

  it("refuses a password-protected PDF", async () => {
    try {
      const doc = await PDFDocument.create();
      doc.addPage().drawText("Hello", { x: 40, y: 80 });
      const locked = await protectPdf(await doc.save(), "secret");
      await assert.rejects(
        () => pdfToText(locked),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, "This PDF is protected. Unlock it in this tab first.");
          return true;
        },
      );
    } finally {
      if (typeof process !== "undefined") process.exitCode = undefined;
    }
  });
});

describe("text worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./text.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch"), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
