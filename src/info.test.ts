import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";

import { protectPdf } from "./index.ts";
import { removePdfInfo } from "./info.ts";

async function labeled(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 100]);
  page.drawText("KEEP", { x: 20, y: 40 });
  doc.setTitle("SECRET-TITLE");
  doc.setAuthor("SECRET-AUTHOR");
  doc.setSubject("SECRET-SUBJECT");
  doc.setKeywords(["SECRET-KEYWORD"]);
  doc.setCreator("SECRET-CREATOR");
  doc.setProducer("SECRET-PRODUCER");
  doc.setCreationDate(new Date("2020-01-02T00:00:00Z"));
  doc.setModificationDate(new Date("2020-03-04T00:00:00Z"));
  const xmp = new TextEncoder().encode("SECRET-XMP-MARKER");
  const stream = doc.context.stream(xmp, { Type: "Metadata", Subtype: "XML" });
  doc.catalog.set(PDFName.of("Metadata"), doc.context.register(stream));
  return doc.save({ useObjectStreams: false });
}

describe("removePdfInfo", () => {
  it("clears the info dictionary and leaves the page and the XMP bytes", async () => {
    const input = await labeled();
    const out = await removePdfInfo(input);
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    assert.equal(doc.getPageCount(), 1);
    assert.equal(doc.getPage(0).getWidth(), 200);
    assert.equal(doc.getPage(0).getHeight(), 100);
    assert.equal(doc.getTitle(), undefined);
    assert.equal(doc.getAuthor(), undefined);
    assert.equal(doc.getSubject(), undefined);
    assert.equal(doc.getKeywords(), undefined);
    assert.equal(doc.getCreator(), undefined);
    assert.equal(doc.getProducer(), undefined);
    assert.equal(doc.getCreationDate(), undefined);
    assert.equal(doc.getModificationDate(), undefined);
    const raw = Buffer.from(out);
    assert.equal(raw.includes(Buffer.from("pdf-lib")), false);
    assert.equal(raw.includes(Buffer.from("SECRET-XMP-MARKER")), true);
    const meta = doc.catalog.lookup(PDFName.of("Metadata"));
    assert.ok(meta instanceof PDFRawStream);
    assert.equal(Buffer.from(meta.getContents()).includes(Buffer.from("SECRET-XMP-MARKER")), true);
    const contents = doc.getPage(0).node.Contents();
    assert.notEqual(contents, undefined);
  });

  it("still saves a PDF that has no info dictionary", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([80, 80]);
    const input = await doc.save();
    const out = await removePdfInfo(input);
    const again = await PDFDocument.load(out, { updateMetadata: false });
    assert.equal(again.getPageCount(), 1);
    assert.equal(again.getTitle(), undefined);
    assert.equal(again.getProducer(), undefined);
  });

  it("rejects empty bytes", async () => {
    await assert.rejects(
      () => removePdfInfo(new Uint8Array()),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "This PDF could not be read.");
        return true;
      },
    );
  });

  it("rejects bytes that are not a PDF", async () => {
    await assert.rejects(
      () => removePdfInfo(new TextEncoder().encode("not a pdf")),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "This PDF could not be read.");
        return true;
      },
    );
  });

  it("rejects a PDF with no pages", async () => {
    const doc = await PDFDocument.create();
    const input = await doc.save({ addDefaultPage: false });
    await assert.rejects(
      () => removePdfInfo(input),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "This PDF has no pages.");
        return true;
      },
    );
  });

  it("leaves the locked-pdf sentence from pdf-lib", async () => {
    try {
      const doc = await PDFDocument.create();
      doc.addPage([80, 80]);
      const locked = await protectPdf(await doc.save(), "secret");
      await assert.rejects(
        () => removePdfInfo(locked),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(
            error.message,
            "Expected instance of PDFDict, but got instance of undefined",
          );
          return true;
        },
      );
    } finally {
      if (typeof process !== "undefined") process.exitCode = undefined;
    }
  });
});

describe("info worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./info.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch"), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
