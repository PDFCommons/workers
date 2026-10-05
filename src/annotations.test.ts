import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { PDFDict, PDFDocument, PDFName, PDFString, StandardFonts, degrees, rgb } from "pdf-lib";

import { removePdfAnnotations } from "./annotations.ts";
import { protectPdf } from "./index.ts";
import { pdfToText } from "./text.ts";

if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix as unknown as typeof globalThis.DOMMatrix;
if (!globalThis.ImageData) globalThis.ImageData = ImageData as unknown as typeof globalThis.ImageData;
if (!globalThis.Path2D) globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D;

function subtypes(doc: PDFDocument): string[] {
  const annots = doc.getPage(0).node.Annots();
  if (!annots) return [];
  const found: string[] = [];
  for (let index = 0; index < annots.size(); index += 1) {
    const annot = doc.context.lookup(annots.get(index));
    if (!(annot instanceof PDFDict)) continue;
    found.push(String(annot.get(PDFName.of("Subtype"))));
  }
  return found;
}

describe("removePdfAnnotations", () => {
  it("drops a link and a note and keeps the form widget, title, rotation, and words", async () => {
    const doc = await PDFDocument.create();
    doc.setTitle("Keep Title");
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const page = doc.addPage([200, 200]);
    page.setRotation(degrees(90));
    page.drawText("KEEP", { x: 20, y: 40, size: 18, font, color: rgb(0, 0, 0) });
    const link = doc.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [10, 10, 80, 30],
      A: { Type: "Action", S: "URI", URI: "https://example.com/keep-link" },
    });
    const note = doc.context.obj({
      Type: "Annot",
      Subtype: "Text",
      Rect: [10, 80, 30, 100],
      Contents: PDFString.of("NOTE-THREE"),
    });
    page.node.set(PDFName.of("Annots"), doc.context.obj([link, note]));
    const form = doc.getForm();
    const field = form.createTextField("name");
    field.setText("Ada Lovelace");
    field.addToPage(page, { x: 20, y: 140, width: 120, height: 18, font });
    const out = await PDFDocument.load(await removePdfAnnotations(await doc.save()));
    assert.equal(out.getTitle(), "Keep Title");
    assert.equal(out.getPageCount(), 1);
    assert.equal(out.getPage(0).getRotation().angle, 90);
    assert.deepEqual(subtypes(out), ["/Widget"]);
    assert.equal(out.catalog.has(PDFName.of("AcroForm")), true);
    assert.equal(out.getForm().getTextField("name").getText(), "Ada Lovelace");
    assert.equal(await pdfToText(await out.save()), "KEEP");
  });

  it("saves a page that has no annotations", async () => {
    const doc = await PDFDocument.create();
    doc.setTitle("Keep Title");
    doc.addPage([200, 100]).drawText("KEEP");
    const out = await PDFDocument.load(await removePdfAnnotations(await doc.save()));
    assert.equal(out.getPage(0).node.Annots(), undefined);
    assert.equal(out.getTitle(), "Keep Title");
    assert.equal(await pdfToText(await out.save()), "KEEP");
  });

  it("refuses empty bytes", async () => {
    await assert.rejects(
      () => removePdfAnnotations(new Uint8Array()),
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
      () => removePdfAnnotations(bytes),
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
        () => removePdfAnnotations(locked),
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

describe("annotations worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./annotations.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch"), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
