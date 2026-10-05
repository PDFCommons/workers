import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { unzipSync } from "fflate";
import { PDFDocument } from "pdf-lib";

import { protectPdf } from "./index.ts";
import { splitEveryN } from "./split-every.ts";

async function sized(widths: number[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (const width of widths) doc.addPage([width, 80]);
  return doc.save();
}

function parts(zip: Uint8Array): Record<string, Uint8Array> {
  return unzipSync(zip);
}

describe("splitEveryN", () => {
  it("packs a 3-page file at 2 pages per part into two PDFs", async () => {
    const zip = parts(await splitEveryN(await sized([120, 180, 240]), 2));
    assert.deepEqual(Object.keys(zip).sort(), ["part-1.pdf", "part-2.pdf"]);
    const first = await PDFDocument.load(zip["part-1.pdf"]!);
    const second = await PDFDocument.load(zip["part-2.pdf"]!);
    assert.equal(first.getPageCount(), 2);
    assert.equal(first.getPage(0).getWidth(), 120);
    assert.equal(first.getPage(1).getWidth(), 180);
    assert.equal(second.getPageCount(), 1);
    assert.equal(second.getPage(0).getWidth(), 240);
  });

  it("keeps a 2-page file as one part when n is 5", async () => {
    const zip = parts(await splitEveryN(await sized([100, 140]), 5));
    assert.deepEqual(Object.keys(zip), ["part-1.pdf"]);
    const only = await PDFDocument.load(zip["part-1.pdf"]!);
    assert.equal(only.getPageCount(), 2);
    assert.equal(only.getPage(0).getWidth(), 100);
    assert.equal(only.getPage(1).getWidth(), 140);
  });

  it("writes one PDF per page when n is 1", async () => {
    const zip = parts(await splitEveryN(await sized([10, 20, 30]), 1));
    assert.deepEqual(Object.keys(zip), ["part-1.pdf", "part-2.pdf", "part-3.pdf"]);
    for (const [index, name] of Object.keys(zip).entries()) {
      const doc = await PDFDocument.load(zip[name]!);
      assert.equal(doc.getPageCount(), 1);
      assert.equal(doc.getPage(0).getWidth(), (index + 1) * 10);
    }
  });

  it("refuses a count that is not a whole number of at least 1", async () => {
    const input = await sized([90]);
    for (const n of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      await assert.rejects(
        () => splitEveryN(input, n),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, "Enter a whole number of pages.");
          return true;
        },
      );
    }
  });

  it("rejects empty bytes", async () => {
    await assert.rejects(
      () => splitEveryN(new Uint8Array(), 1),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "This PDF could not be read.");
        return true;
      },
    );
  });

  it("rejects bytes that are not a PDF", async () => {
    await assert.rejects(
      () => splitEveryN(new TextEncoder().encode("not a pdf"), 1),
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
      () => splitEveryN(input, 1),
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
        () => splitEveryN(locked, 1),
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

describe("split-every worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./split-every.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch("), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
