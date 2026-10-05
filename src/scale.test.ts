import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { PDFDict, PDFDocument, PDFName, PDFString, StandardFonts, degrees, rgb } from "pdf-lib";

import { protectPdf } from "./index.ts";
import { scalePdf } from "./scale.ts";
import { pdfToText } from "./text.ts";

if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix as unknown as typeof globalThis.DOMMatrix;
if (!globalThis.ImageData) globalThis.ImageData = ImageData as unknown as typeof globalThis.ImageData;
if (!globalThis.Path2D) globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D;

function linkUris(doc: PDFDocument): string[] {
  const annots = doc.getPage(0).node.Annots();
  if (!annots) return [];
  const uris: string[] = [];
  for (let index = 0; index < annots.size(); index += 1) {
    const annot = doc.context.lookup(annots.get(index));
    if (!(annot instanceof PDFDict)) continue;
    if (String(annot.get(PDFName.of("Subtype"))) !== "/Link") continue;
    const action = doc.context.lookup(annot.get(PDFName.of("A")));
    if (!(action instanceof PDFDict)) continue;
    const uri = action.get(PDFName.of("URI"));
    if (uri && "decodeText" in uri && typeof uri.decodeText === "function") uris.push(uri.decodeText());
  }
  return uris;
}

describe("scalePdf", () => {
  it("halves the page box and keeps title, rotation, and extractable words", async () => {
    const doc = await PDFDocument.create();
    doc.setTitle("Keep Title");
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([200, 100]);
    page.setRotation(degrees(90));
    page.drawText("KEEP", { x: 20, y: 40, size: 18, font, color: rgb(0, 0, 0) });
    const out = await scalePdf(await doc.save(), 50);
    const reloaded = await PDFDocument.load(out);
    assert.equal(reloaded.getPageCount(), 1);
    assert.equal(reloaded.getTitle(), "Keep Title");
    assert.equal(reloaded.getPage(0).getRotation().angle, 90);
    assert.equal(reloaded.getPage(0).getWidth(), 100);
    assert.equal(reloaded.getPage(0).getHeight(), 50);
    assert.match(await pdfToText(out), /KEEP/);
  });

  it("doubles the page and keeps a link and a form field", async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([200, 200]);
    page.drawText("KEEP", { x: 40, y: 40, size: 18, font });
    page.node.addAnnot(
      doc.context.register(
        doc.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [40, 40, 140, 60],
          Border: [0, 0, 0],
          A: { Type: "Action", S: "URI", URI: PDFString.of("https://example.com/keep-link") },
        }),
      ),
    );
    const field = doc.getForm().createTextField("name");
    field.setText("Ada Lovelace");
    field.addToPage(page, { x: 20, y: 80, width: 140, height: 24, font });
    const out = await scalePdf(await doc.save(), 200);
    const reloaded = await PDFDocument.load(out);
    assert.equal(reloaded.getPage(0).getWidth(), 400);
    assert.equal(reloaded.getPage(0).getHeight(), 400);
    assert.equal(reloaded.catalog.has(PDFName.of("AcroForm")), true);
    assert.equal(reloaded.getForm().getTextField("name").getText(), "Ada Lovelace");
    assert.deepEqual(linkUris(reloaded), ["https://example.com/keep-link"]);
    assert.match(await pdfToText(out), /KEEP/);
  });

  it("refuses a percent outside the four choices", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]);
    await assert.rejects(
      async () => scalePdf(await doc.save(), 100),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "Choose 50, 75, 150, or 200 percent.");
        return true;
      },
    );
  });

  it("refuses empty bytes", async () => {
    await assert.rejects(
      () => scalePdf(new Uint8Array(), 50),
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
      () => scalePdf(bytes, 50),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "This PDF has no pages.");
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
        () => scalePdf(locked, 50),
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

describe("scale worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./scale.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch"), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
