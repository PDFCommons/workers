import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { PDFDict, PDFDocument, PDFName, PDFString, StandardFonts, rgb } from "pdf-lib";

import { flattenPdf } from "./flatten.ts";
import { protectPdf } from "./index.ts";
import { pdfToText } from "./text.ts";

if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix as unknown as typeof globalThis.DOMMatrix;
if (!globalThis.ImageData) globalThis.ImageData = ImageData as unknown as typeof globalThis.ImageData;
if (!globalThis.Path2D) globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D;

function noteContents(doc: PDFDocument): string {
  const annots = doc.getPage(0).node.Annots();
  if (!annots) return "";
  const parts: string[] = [];
  for (let index = 0; index < annots.size(); index += 1) {
    const annot = doc.context.lookup(annots.get(index));
    if (!(annot instanceof PDFDict)) continue;
    if (String(annot.get(PDFName.of("Subtype"))) !== "/Text") continue;
    const contents = annot.get(PDFName.of("Contents"));
    if (contents && "decodeText" in contents && typeof contents.decodeText === "function") {
      parts.push(contents.decodeText());
    }
  }
  return parts.join(" ");
}

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

describe("flattenPdf", () => {
  it("burns a text field into the page and removes the form", async () => {
    const doc = await PDFDocument.create();
    doc.setTitle("Keep Title");
    const page = doc.addPage([300, 200]);
    page.drawText("KEEP", { x: 40, y: 40, size: 18 });
    const link = doc.context.register(
      doc.context.obj({
        Type: "Annot",
        Subtype: "Link",
        Rect: [40, 40, 140, 60],
        Border: [0, 0, 0],
        A: { Type: "Action", S: "URI", URI: PDFString.of("https://example.com/keep-link") },
      }),
    );
    page.node.addAnnot(link);
    page.node.addAnnot(
      doc.context.register(
        doc.context.obj({
          Type: "Annot",
          Subtype: "Text",
          Rect: [150, 40, 170, 60],
          Contents: PDFString.of("NOTE-KEEP"),
        }),
      ),
    );
    const form = doc.getForm();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const field = form.createTextField("name");
    field.addToPage(page, { x: 40, y: 120, width: 180, height: 24, font, textColor: rgb(0, 0, 0) });
    field.setText("Ada Lovelace");
    const out = await flattenPdf(await doc.save());
    const reloaded = await PDFDocument.load(out);
    assert.equal(reloaded.catalog.has(PDFName.of("AcroForm")), false);
    assert.equal(reloaded.getForm().getFields().length, 0);
    assert.equal(reloaded.getTitle(), "Keep Title");
    assert.deepEqual(linkUris(reloaded), ["https://example.com/keep-link"]);
    const note = noteContents(reloaded);
    assert.ok(note.includes("NOTE-KEEP"), note);
    const resources = reloaded.getPage(0).node.Resources();
    assert.ok(resources);
    const names = resources.lookup(PDFName.of("XObject"), PDFDict).keys().map((key) => String(key));
    assert.ok(names.some((name) => name.startsWith("/FlatWidget-")), names.join(","));
    const text = await pdfToText(out);
    assert.match(text, /Ada Lovelace/);
    assert.match(text, /KEEP/);
  });

  it("leaves a PDF that has no form readable", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]).drawText("KEEP", { x: 20, y: 40, size: 18 });
    const out = await flattenPdf(await doc.save());
    const reloaded = await PDFDocument.load(out);
    assert.equal(reloaded.getPageCount(), 1);
    assert.equal(reloaded.catalog.has(PDFName.of("AcroForm")), false);
    assert.match(await pdfToText(out), /KEEP/);
  });

  it("refuses empty bytes", async () => {
    await assert.rejects(
      () => flattenPdf(new Uint8Array()),
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
      () => flattenPdf(bytes),
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
        () => flattenPdf(locked),
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

describe("flatten worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./flatten.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch"), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
