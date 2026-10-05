import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, PDFRef, decodePDFRawStream, rgb } from "pdf-lib";

import { protectPdf } from "./index.ts";
import { removePdfMetadata } from "./metadata.ts";

const LOCKED =
  "Input document to `PDFDocument.load` is encrypted. You can use `PDFDocument.load(..., { ignoreEncryption: true })` if you wish to load the document anyways.";

async function contentText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(0);
  const streams: PDFRawStream[] = [];
  const push = (value: unknown) => {
    if (value instanceof PDFRawStream) streams.push(value);
    else if (value instanceof PDFArray) {
      for (let index = 0; index < value.size(); index += 1) {
        push(doc.context.lookup(value.get(index)));
      }
    } else if (value instanceof PDFRef) push(doc.context.lookup(value));
  };
  push(page.node.Contents());
  return streams
    .map((stream) => new TextDecoder("latin1").decode(decodePDFRawStream(stream).decode()))
    .join("\n")
    .replace(/<([0-9A-Fa-f\s]+)>/g, (_match, hex: string) => {
      const compact = hex.replace(/\s+/g, "");
      if (compact.length % 2 !== 0) return `<${hex}>`;
      let text = "";
      for (let index = 0; index < compact.length; index += 2) {
        text += String.fromCharCode(parseInt(compact.slice(index, index + 2), 16));
      }
      return text;
    });
}

describe("removePdfMetadata", () => {
  it("clears title and author and keeps page text", async () => {
    const doc = await PDFDocument.create();
    doc.setTitle("Secret title");
    doc.setAuthor("Secret author");
    doc.setSubject("Secret subject");
    doc.setKeywords(["secret"]);
    doc.setCreator("Secret creator");
    doc.setProducer("Secret producer");
    doc.setCreationDate(new Date("2020-01-02T00:00:00Z"));
    doc.setModificationDate(new Date("2020-03-04T00:00:00Z"));
    const page = doc.addPage();
    page.drawText("Hello", { x: 40, y: 80 });
    page.drawRectangle({ x: 12, y: 34, width: 56, height: 78, color: rgb(1, 0, 0) });
    const marker = "unique-catalog-xmp-marker";
    const stream = doc.context.stream(new TextEncoder().encode(marker), {
      Type: "Metadata",
      Subtype: "XML",
    });
    doc.catalog.set(PDFName.of("Metadata"), doc.context.register(stream));
    const out = await removePdfMetadata(await doc.save());
    const reloaded = await PDFDocument.load(out);
    assert.equal(reloaded.getTitle(), undefined);
    assert.equal(reloaded.getAuthor(), undefined);
    assert.notEqual(reloaded.getTitle(), "");
    assert.notEqual(reloaded.getAuthor(), "");
    const quiet = await PDFDocument.load(out, { updateMetadata: false });
    assert.equal(quiet.getTitle(), undefined);
    assert.equal(quiet.getAuthor(), undefined);
    assert.equal(quiet.getSubject(), undefined);
    assert.equal(quiet.getKeywords(), undefined);
    assert.equal(quiet.getCreator(), undefined);
    assert.equal(quiet.getProducer(), undefined);
    assert.equal(quiet.getCreationDate(), undefined);
    assert.equal(quiet.getModificationDate(), undefined);
    assert.equal(quiet.catalog.has(PDFName.of("Metadata")), false);
    assert.equal(new TextDecoder("latin1").decode(out).includes(marker), false);
    const drawn = await contentText(out);
    assert.match(drawn, /Hello/);
    assert.match(drawn, /56/);
    assert.match(drawn, /78/);
  });

  it("refuses empty bytes and a file that cannot be read", async () => {
    await assert.rejects(
      () => removePdfMetadata(new Uint8Array()),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "This PDF could not be read.");
        return true;
      },
    );
    await assert.rejects(
      () => removePdfMetadata(new Uint8Array([1, 2, 3, 4])),
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
      () => removePdfMetadata(bytes),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "This PDF has no pages.");
        return true;
      },
    );
  });

  it("reports the worker error for a locked PDF", async () => {
    try {
      const doc = await PDFDocument.create();
      doc.addPage().drawText("Hello", { x: 40, y: 80 });
      const locked = await protectPdf(await doc.save(), "secret");
      await assert.rejects(
        () => removePdfMetadata(locked),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, LOCKED);
          return true;
        },
      );
    } finally {
      if (typeof process !== "undefined") process.exitCode = undefined;
    }
  });
});

describe("metadata worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./metadata.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch"), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
