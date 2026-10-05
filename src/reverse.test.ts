import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { PDFDict, PDFDocument, PDFName, PDFString, StandardFonts, degrees, rgb } from "pdf-lib";

import { protectPdf } from "./index.ts";
import { reversePdf } from "./reverse.ts";
import { pdfToText } from "./text.ts";

if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix as unknown as typeof globalThis.DOMMatrix;
if (!globalThis.ImageData) globalThis.ImageData = ImageData as unknown as typeof globalThis.ImageData;
if (!globalThis.Path2D) globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D;

function textNotes(doc: PDFDocument): { page: number; value: string }[] {
  const found: { page: number; value: string }[] = [];
  for (let pageIndex = 0; pageIndex < doc.getPageCount(); pageIndex += 1) {
    const annots = doc.getPage(pageIndex).node.Annots();
    if (!annots) continue;
    for (let index = 0; index < annots.size(); index += 1) {
      const annot = doc.context.lookup(annots.get(index));
      if (!(annot instanceof PDFDict)) continue;
      if (String(annot.get(PDFName.of("Subtype"))) !== "/Text") continue;
      const contents = annot.get(PDFName.of("Contents"));
      if (contents && "decodeText" in contents && typeof contents.decodeText === "function") {
        found.push({ page: pageIndex, value: contents.decodeText() });
      }
    }
  }
  return found;
}

function linkUris(doc: PDFDocument): { page: number; value: string }[] {
  const found: { page: number; value: string }[] = [];
  for (let pageIndex = 0; pageIndex < doc.getPageCount(); pageIndex += 1) {
    const annots = doc.getPage(pageIndex).node.Annots();
    if (!annots) continue;
    for (let index = 0; index < annots.size(); index += 1) {
      const annot = doc.context.lookup(annots.get(index));
      if (!(annot instanceof PDFDict)) continue;
      if (String(annot.get(PDFName.of("Subtype"))) !== "/Link") continue;
      const action = doc.context.lookup(annot.get(PDFName.of("A")));
      if (!(action instanceof PDFDict)) continue;
      const uri = action.get(PDFName.of("URI"));
      if (uri && "decodeText" in uri && typeof uri.decodeText === "function") {
        found.push({ page: pageIndex, value: uri.decodeText() });
      }
    }
  }
  return found;
}

describe("reversePdf", () => {
  it("puts the last page first and keeps title, rotation, notes, links, and the form", async () => {
    const doc = await PDFDocument.create();
    doc.setTitle("Keep Title");
    const font = await doc.embedFont(StandardFonts.Helvetica);
    for (const label of ["ONE", "TWO", "THREE"]) {
      const page = doc.addPage([220, 200]);
      page.drawText(label, { x: 40, y: 100, size: 24, font, color: rgb(0, 0, 0) });
    }
    doc.getPage(0).setRotation(degrees(90));
    doc.getPage(0).node.addAnnot(
      doc.context.register(
        doc.context.obj({
          Type: "Annot",
          Subtype: "Link",
          Rect: [40, 40, 140, 60],
          Border: [0, 0, 0],
          A: { Type: "Action", S: "URI", URI: PDFString.of("https://example.com/one") },
        }),
      ),
    );
    doc.getPage(2).node.addAnnot(
      doc.context.register(
        doc.context.obj({
          Type: "Annot",
          Subtype: "Text",
          Rect: [10, 10, 30, 30],
          Contents: PDFString.of("NOTE-THREE"),
        }),
      ),
    );
    const form = doc.getForm();
    const field = form.createTextField("name");
    field.setText("Ada Lovelace");
    field.addToPage(doc.getPage(1), { x: 20, y: 20, width: 140, height: 24, font });
    const out = await reversePdf(await doc.save());
    const reloaded = await PDFDocument.load(out);
    assert.equal(reloaded.getPageCount(), 3);
    assert.equal(reloaded.getTitle(), "Keep Title");
    assert.equal(reloaded.getPage(2).getRotation().angle, 90);
    assert.equal(reloaded.catalog.has(PDFName.of("AcroForm")), true);
    const fields = reloaded.getForm().getFields();
    assert.equal(fields.length, 1);
    assert.equal(fields[0]?.getName(), "name");
    assert.equal("getText" in fields[0]! && fields[0].getText(), "Ada Lovelace");
    assert.deepEqual(textNotes(reloaded), [{ page: 0, value: "NOTE-THREE" }]);
    assert.deepEqual(linkUris(reloaded), [{ page: 2, value: "https://example.com/one" }]);
    const text = await pdfToText(out);
    assert.ok(text.indexOf("THREE") < text.indexOf("TWO"));
    assert.ok(text.indexOf("TWO") < text.indexOf("ONE"));
  });

  it("keeps a one-page file on that page", async () => {
    const doc = await PDFDocument.create();
    doc.setTitle("Keep Title");
    const page = doc.addPage([200, 100]);
    page.setRotation(degrees(90));
    page.drawText("SAME", { x: 20, y: 40, size: 18 });
    const out = await reversePdf(await doc.save());
    const reloaded = await PDFDocument.load(out);
    assert.equal(reloaded.getPageCount(), 1);
    assert.equal(reloaded.getTitle(), "Keep Title");
    assert.equal(reloaded.getPage(0).getRotation().angle, 90);
    assert.match(await pdfToText(out), /SAME/);
  });

  it("refuses empty bytes", async () => {
    await assert.rejects(
      () => reversePdf(new Uint8Array()),
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
      () => reversePdf(bytes),
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
        () => reversePdf(locked),
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

describe("reverse worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./reverse.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch"), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
