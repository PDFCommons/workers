import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";

import { addBlankPage } from "./blank.ts";
import { protectPdf } from "./index.ts";

async function sized(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const first = doc.addPage([200, 300]);
  first.drawText("KEEP", { x: 20, y: 40 });
  doc.addPage([400, 500]);
  return doc.save();
}

describe("addBlankPage", () => {
  it("inserts a matching blank page at the front", async () => {
    const out = await addBlankPage(await sized(), 0);
    const doc = await PDFDocument.load(out);
    assert.equal(doc.getPageCount(), 3);
    assert.equal(doc.getPage(0).getWidth(), 200);
    assert.equal(doc.getPage(0).getHeight(), 300);
    assert.equal(doc.getPage(1).getWidth(), 200);
    assert.equal(doc.getPage(1).getHeight(), 300);
    assert.equal(doc.getPage(2).getWidth(), 400);
    assert.equal(doc.getPage(2).getHeight(), 500);
    assert.equal(doc.getPage(0).node.Contents(), undefined);
  });

  it("appends a matching blank page after the last page", async () => {
    const out = await addBlankPage(await sized(), 2);
    const doc = await PDFDocument.load(out);
    assert.equal(doc.getPageCount(), 3);
    assert.equal(doc.getPage(0).getWidth(), 200);
    assert.equal(doc.getPage(1).getWidth(), 400);
    assert.equal(doc.getPage(1).getHeight(), 500);
    assert.equal(doc.getPage(2).getWidth(), 400);
    assert.equal(doc.getPage(2).getHeight(), 500);
    assert.equal(doc.getPage(2).node.Contents(), undefined);
  });

  it("grows the page count by 1 when inserting after page 1", async () => {
    const out = await addBlankPage(await sized(), 1);
    const doc = await PDFDocument.load(out);
    assert.equal(doc.getPageCount(), 3);
    assert.equal(doc.getPage(1).getWidth(), 200);
    assert.equal(doc.getPage(1).getHeight(), 300);
    assert.equal(doc.getPage(2).getWidth(), 400);
  });

  it("rejects a page that is not in the file", async () => {
    const input = await sized();
    for (const after of [-1, 3, 1.5, Number.NaN]) {
      await assert.rejects(
        () => addBlankPage(input, after),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, "Name a page that exists.");
          return true;
        },
      );
    }
  });

  it("rejects empty bytes", async () => {
    await assert.rejects(
      () => addBlankPage(new Uint8Array(), 0),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "This PDF could not be read.");
        return true;
      },
    );
  });

  it("rejects bytes that are not a PDF", async () => {
    await assert.rejects(
      () => addBlankPage(new TextEncoder().encode("not a pdf"), 0),
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
      () => addBlankPage(input, 0),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "This PDF has no pages.");
        return true;
      },
    );
  });

  it("leaves the locked-pdf sentence from pdf-lib", async () => {
    try {
      const locked = await protectPdf(await sized(), "secret");
      await assert.rejects(
        () => addBlankPage(locked, 0),
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

describe("blank worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./blank.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch"), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
