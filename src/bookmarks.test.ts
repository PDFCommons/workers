import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { PDFDict, PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts } from "pdf-lib";

import { removePdfBookmarks } from "./bookmarks.ts";
import { protectPdf } from "./index.ts";
import { pdfToText } from "./text.ts";

if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix as unknown as typeof globalThis.DOMMatrix;
if (!globalThis.ImageData) globalThis.ImageData = ImageData as unknown as typeof globalThis.ImageData;
if (!globalThis.Path2D) globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D;

function linkUri(doc: PDFDocument): string {
  const annots = doc.getPage(0).node.Annots();
  if (!annots) return "";
  const annot = doc.context.lookup(annots.get(0));
  if (!(annot instanceof PDFDict)) return "";
  const action = doc.context.lookup(annot.get(PDFName.of("A")));
  if (!(action instanceof PDFDict)) return "";
  const uri = action.get(PDFName.of("URI"));
  if (uri instanceof PDFName || uri instanceof PDFString || uri instanceof PDFHexString) return uri.decodeText();
  return "";
}

function writtenStrings(doc: PDFDocument): string[] {
  const found: string[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown) => {
    if (!value || seen.has(value)) return;
    if (typeof value === "object") seen.add(value);
    if (value instanceof PDFString || value instanceof PDFHexString || value instanceof PDFName) {
      found.push(value.decodeText());
      return;
    }
    if (value instanceof PDFDict) {
      for (const [, entry] of value.entries()) visit(doc.context.lookup(entry));
    }
  };
  for (const [, object] of doc.context.enumerateIndirectObjects()) visit(object);
  return found;
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

async function marked(mode: "UseOutlines" | "FullScreen"): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("Keep Title");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([200, 100]);
  page.drawText("KEEP", { x: 20, y: 40, size: 18, font });
  const link = doc.context.obj({
    Type: "Annot",
    Subtype: "Link",
    Rect: [10, 10, 80, 30],
    A: { Type: "Action", S: "URI", URI: "https://example.com/keep-link" },
  });
  page.node.set(PDFName.of("Annots"), doc.context.obj([link]));
  const child = doc.context.obj({ Title: PDFString.of("SECRET-CHILD") });
  const childRef = doc.context.register(child);
  const item = doc.context.obj({
    Title: PDFString.of("SECRET-BOOKMARK"),
    First: childRef,
    Last: childRef,
    Count: 1,
    Dest: [page.ref, PDFName.of("Fit")],
  });
  const itemRef = doc.context.register(item);
  child.set(PDFName.of("Parent"), itemRef);
  const outlines = doc.context.obj({
    Type: "Outlines",
    First: itemRef,
    Last: itemRef,
    Count: 1,
  });
  const outlinesRef = doc.context.register(outlines);
  item.set(PDFName.of("Parent"), outlinesRef);
  doc.catalog.set(PDFName.of("Outlines"), outlinesRef);
  doc.catalog.set(PDFName.of("PageMode"), PDFName.of(mode));
  doc.catalog.set(PDFName.of("Names"), doc.context.obj({ Type: "NAMES-STAY" }));
  return doc.save({ useObjectStreams: false });
}

describe("removePdfBookmarks", () => {
  it("drops the outline tree and keeps the page, title, link, and names", async () => {
    const input = await marked("UseOutlines");
    assert.equal(Buffer.from(input).includes(Buffer.from("SECRET-BOOKMARK")), true);
    const out = await removePdfBookmarks(input);
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    assert.equal(doc.getPageCount(), 1);
    assert.equal(doc.getPage(0).getWidth(), 200);
    assert.equal(doc.getPage(0).getHeight(), 100);
    assert.equal(doc.getTitle(), "Keep Title");
    assert.equal(doc.catalog.get(PDFName.of("Outlines")), undefined);
    assert.equal(doc.catalog.get(PDFName.of("PageMode")), undefined);
    assert.ok(doc.catalog.get(PDFName.of("Names")) instanceof PDFDict);
    assert.deepEqual(subtypes(doc, 0), ["/Link"]);
    const names = doc.context.lookup(doc.catalog.get(PDFName.of("Names")));
    assert.ok(names instanceof PDFDict);
    assert.equal(String(names.get(PDFName.of("Type"))), "/NAMES-STAY");
    assert.equal(linkUri(doc), "https://example.com/keep-link");
    assert.equal(await pdfToText(out), "KEEP");
    const written = writtenStrings(doc).join("\n");
    assert.equal(written.includes("SECRET-BOOKMARK"), false);
    assert.equal(written.includes("SECRET-CHILD"), false);
  });

  it("leaves a FullScreen page mode in place", async () => {
    const out = await removePdfBookmarks(await marked("FullScreen"));
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    assert.equal(doc.catalog.get(PDFName.of("Outlines")), undefined);
    assert.equal(String(doc.catalog.get(PDFName.of("PageMode"))), "/FullScreen");
  });

  it("saves a PDF that has no outline", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([80, 80]);
    doc.setTitle("Keep Title");
    const out = await removePdfBookmarks(await doc.save());
    const again = await PDFDocument.load(out, { updateMetadata: false });
    assert.equal(again.getPageCount(), 1);
    assert.equal(again.getTitle(), "Keep Title");
    assert.equal(again.catalog.get(PDFName.of("Outlines")), undefined);
  });

  it("rejects empty bytes", async () => {
    await assert.rejects(removePdfBookmarks(new Uint8Array()), /This PDF could not be read/);
  });

  it("rejects bytes that are not a PDF", async () => {
    await assert.rejects(
      removePdfBookmarks(new TextEncoder().encode("not a pdf")),
      /This PDF could not be read/,
    );
  });

  it("rejects a PDF with no pages", async () => {
    const doc = await PDFDocument.create();
    await assert.rejects(
      removePdfBookmarks(await doc.save({ addDefaultPage: false })),
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
        removePdfBookmarks(locked),
        /Expected instance of PDFDict, but got instance of undefined/,
      );
    } finally {
      process.exitCode = previous;
    }
  });
});

describe("bookmarks worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./bookmarks.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
