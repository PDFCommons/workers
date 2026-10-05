import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";

import { protectPdf } from "./index.ts";
import { setPdfTitle } from "./set-title.ts";

async function labeled(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 100]);
  page.drawText("KEEP", { x: 20, y: 40 });
  doc.setTitle("OLD-TITLE");
  doc.setAuthor("KEEP-AUTHOR");
  doc.setSubject("KEEP-SUBJECT");
  doc.setKeywords(["KEEP-KEYWORD"]);
  doc.setCreator("KEEP-CREATOR");
  doc.setProducer("KEEP-PRODUCER");
  doc.setCreationDate(new Date("2020-01-02T00:00:00Z"));
  doc.setModificationDate(new Date("2020-03-04T00:00:00Z"));
  const xmp = new TextEncoder().encode("SECRET-XMP-MARKER");
  const stream = doc.context.stream(xmp, { Type: "Metadata", Subtype: "XML" });
  doc.catalog.set(PDFName.of("Metadata"), doc.context.register(stream));
  return doc.save({ useObjectStreams: false });
}

describe("setPdfTitle", () => {
  it("sets the trimmed title and leaves author, subject, and XMP", async () => {
    const input = await labeled();
    const out = await setPdfTitle(input, "  SECRET-TITLE  ");
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    assert.equal(doc.getPageCount(), 1);
    assert.equal(doc.getPage(0).getWidth(), 200);
    assert.equal(doc.getPage(0).getHeight(), 100);
    assert.equal(doc.getTitle(), "SECRET-TITLE");
    assert.equal(doc.getAuthor(), "KEEP-AUTHOR");
    assert.equal(doc.getSubject(), "KEEP-SUBJECT");
    assert.equal(doc.getKeywords(), "KEEP-KEYWORD");
    assert.equal(doc.getCreator(), "KEEP-CREATOR");
    assert.equal(doc.getProducer(), "KEEP-PRODUCER");
    assert.ok(doc.getCreationDate() instanceof Date);
    assert.ok(doc.getModificationDate() instanceof Date);
    const raw = Buffer.from(out);
    assert.equal(raw.includes(Buffer.from("SECRET-XMP-MARKER")), true);
    const meta = doc.catalog.lookup(PDFName.of("Metadata"));
    assert.ok(meta instanceof PDFRawStream);
    assert.equal(Buffer.from(meta.getContents()).includes(Buffer.from("SECRET-XMP-MARKER")), true);
    const contents = doc.getPage(0).node.Contents();
    assert.notEqual(contents, undefined);
  });

  it("keeps a title of exactly 200 characters after trimming", async () => {
    const title = ` ${"A".repeat(200)} `;
    const out = await setPdfTitle(await labeled(), title);
    const doc = await PDFDocument.load(out, { updateMetadata: false });
    assert.equal(doc.getTitle(), "A".repeat(200));
    assert.equal(doc.getAuthor(), "KEEP-AUTHOR");
  });

  it("rejects an empty title", async () => {
    const input = await labeled();
    for (const title of ["", "   ", "\n\t"]) {
      await assert.rejects(
        () => setPdfTitle(input, title),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, "Enter a title.");
          return true;
        },
      );
    }
  });

  it("rejects a title longer than 200 characters", async () => {
    const input = await labeled();
    await assert.rejects(
      () => setPdfTitle(input, ` ${"B".repeat(201)} `),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "Use 200 characters or fewer.");
        return true;
      },
    );
  });

  it("rejects empty bytes", async () => {
    await assert.rejects(
      () => setPdfTitle(new Uint8Array(), "SECRET-TITLE"),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "This PDF could not be read.");
        return true;
      },
    );
  });

  it("rejects bytes that are not a PDF", async () => {
    await assert.rejects(
      () => setPdfTitle(new TextEncoder().encode("not a pdf"), "SECRET-TITLE"),
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
      () => setPdfTitle(input, "SECRET-TITLE"),
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
        () => setPdfTitle(locked, "SECRET-TITLE"),
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

describe("set-title worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./set-title.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch"), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
