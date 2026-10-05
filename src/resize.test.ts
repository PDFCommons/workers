import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import {
  PDFArray,
  PDFDocument,
  PDFRawStream,
  PDFRef,
  PageSizes,
  decodePDFRawStream,
  degrees,
} from "pdf-lib";

import { protectPdf } from "./index.ts";
import { resizePdf } from "./resize.ts";
import { pdfToText } from "./text.ts";

if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix as unknown as typeof globalThis.DOMMatrix;
if (!globalThis.ImageData) globalThis.ImageData = ImageData as unknown as typeof globalThis.ImageData;
if (!globalThis.Path2D) globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D;

async function pageBox(bytes: Uint8Array): Promise<{ width: number; height: number; content: string }> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
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
  const matches = [...content.matchAll(/([0-9.]+) 0 0 ([0-9.]+) 0 0 cm/g)];
  assert.ok(matches.length > 0, content);
  const scales = matches.map((match) => {
    const xScale = Number(match[1]);
    assert.equal(xScale, Number(match[2]));
    return xScale;
  });
  // An unrotated draw also writes identity matrices that look like scale 1.
  return Math.min(...scales) * sourceWidth;
}

describe("resizePdf", () => {
  it("fits every page on a Letter sheet", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    doc.addPage([100, 400]);
    const out = await resizePdf(await doc.save(), "letter");
    const result = await PDFDocument.load(out);
    assert.equal(result.getPageCount(), 2);
    assert.equal(result.getPage(0).getWidth(), PageSizes.Letter[0]);
    assert.equal(result.getPage(0).getHeight(), PageSizes.Letter[1]);
    assert.equal(result.getPage(1).getWidth(), 612);
    assert.equal(result.getPage(1).getHeight(), 792);
  });

  it("fits a page on an A4 sheet", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([300, 300]);
    const out = await resizePdf(await doc.save(), "a4");
    const { width, height } = await pageBox(out);
    assert.equal(width, PageSizes.A4[0]);
    assert.equal(height, PageSizes.A4[1]);
    assert.equal(width, 595.28);
    assert.equal(height, 841.89);
  });

  it("scales a larger page down so the drawn width fits the sheet", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([2000, 1000]).drawRectangle({ x: 0, y: 0, width: 20, height: 20 });
    const out = await resizePdf(await doc.save(), "letter");
    const box = await pageBox(out);
    assert.equal(box.width, 612);
    const drawn = drawnWidth(box.content, 2000);
    assert.ok(drawn <= box.width, `drawn ${drawn}`);
    assert.ok(drawn < 2000);
  });

  it("keeps standard-font words extractable", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([1000, 400]).drawText("Hello", { x: 72, y: 200, size: 24 });
    const out = await resizePdf(await doc.save(), "letter");
    const text = await pdfToText(out);
    assert.match(text, /Hello/);
  });

  it("uses the rotated size and still keeps the words", async () => {
    const doc = await PDFDocument.create();
    const page = doc.addPage([400, 200]);
    page.drawText("Hello", { x: 40, y: 80 });
    page.setRotation(degrees(90));
    const out = await resizePdf(await doc.save(), "letter");
    const box = await pageBox(out);
    assert.equal(box.width, 612);
    assert.equal(box.height, 792);
    const text = await pdfToText(out);
    assert.match(text, /Hello/);
  });

  it("refuses empty bytes", async () => {
    await assert.rejects(
      () => resizePdf(new Uint8Array(), "letter"),
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
      () => resizePdf(bytes, "letter"),
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
      () => resizePdf(bytes, "legal" as "letter"),
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
        () => resizePdf(locked, "letter"),
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

describe("resize worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./resize.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch"), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
