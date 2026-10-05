import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PDFArray, PDFDocument, PDFRawStream, PDFRef, decodePDFRawStream } from "pdf-lib";
import { cropPdf } from "./crop.ts";
import { protectPdf } from "./index.ts";

function contentText(doc: PDFDocument): string {
  const contents = doc.getPage(0).node.Contents();
  if (!contents) return "";
  const parts = contents instanceof PDFArray ? contents.asArray() : [contents];
  const decoded = parts
    .map((part) => {
      const stream = part instanceof PDFRef ? doc.context.lookup(part) : part;
      if (!(stream instanceof PDFRawStream)) return "";
      return Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1");
    })
    .join("\n");
  return decoded.replace(/<([0-9A-Fa-f\s]+)>/g, (_match, hex: string) => {
    const compact = hex.replace(/\s+/g, "");
    if (compact.length % 2 !== 0) return `<${hex}>`;
    let text = "";
    for (let index = 0; index < compact.length; index += 2) {
      text += String.fromCharCode(parseInt(compact.slice(index, index + 2), 16));
    }
    return text;
  });
}

async function marked(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 100]);
  page.setCropBox(20, 10, 160, 80);
  page.drawText("KEEPME", { x: 40, y: 40 });
  return doc.save();
}

describe("cropPdf", () => {
  it("keeps the crop size when the trim is zero", async () => {
    const out = await cropPdf(await marked(), 0);
    const doc = await PDFDocument.load(out);
    const box = doc.getPage(0).getCropBox();
    assert.equal(box.x, 20);
    assert.equal(box.y, 10);
    assert.equal(box.width, 160);
    assert.equal(box.height, 80);
    assert.match(contentText(doc), /KEEPME/);
  });

  it("shrinks the crop box and leaves the drawn text in the content stream", async () => {
    const out = await cropPdf(await marked(), 10);
    const doc = await PDFDocument.load(out);
    const box = doc.getPage(0).getCropBox();
    assert.equal(box.x, 30);
    assert.equal(box.y, 20);
    assert.equal(box.width, 140);
    assert.equal(box.height, 60);
    assert.equal(doc.getPage(0).getMediaBox().width, 200);
    assert.match(contentText(doc), /KEEPME/);
  });

  it("rejects a trim that would leave a point or less", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([200, 100]);
    const wide = doc.addPage([30, 80]);
    wide.drawText("STAY", { x: 4, y: 20 });
    const bytes = await doc.save();
    const before = bytes.slice();
    await assert.rejects(
      () => cropPdf(bytes, 40),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "Leave at least one point of the page.");
        return true;
      },
    );
    assert.deepEqual(bytes, before);
    const edge = await PDFDocument.create();
    edge.addPage([3, 40]);
    const narrow = await edge.save();
    await assert.rejects(
      () => cropPdf(narrow, 1),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "Leave at least one point of the page.");
        return true;
      },
    );
  });

  it("rejects a trim that is not a whole number of points", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const bytes = await doc.save();
    for (const trim of [1.5, -1, Number.NaN]) {
      await assert.rejects(
        () => cropPdf(bytes, trim),
        (error: unknown) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, "Enter a whole number of points.");
          return true;
        },
      );
    }
  });

  it("rejects empty bytes", async () => {
    await assert.rejects(
      () => cropPdf(new Uint8Array(), 0),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "This PDF could not be read.");
        return true;
      },
    );
  });

  it("rejects a document with no pages", async () => {
    const doc = await PDFDocument.create();
    const bytes = await doc.save({ addDefaultPage: false });
    await assert.rejects(
      () => cropPdf(bytes, 0),
      (error: unknown) => {
        assert.ok(error instanceof Error);
        assert.equal(error.message, "This PDF has no pages.");
        return true;
      },
    );
  });

  it("rejects a protected PDF with the locked worker error", async () => {
    try {
      const doc = await PDFDocument.create();
      doc.addPage().drawText("KEEPME", { x: 40, y: 80 });
      const locked = await protectPdf(await doc.save(), "secret");
      await assert.rejects(
        () => cropPdf(locked, 0),
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

describe("crop worker source", () => {
  it("does not open a network connection", () => {
    const source = readFileSync(new URL("./crop.ts", import.meta.url), "utf8");
    assert.equal(source.includes("fetch"), false);
    assert.equal(source.includes("XMLHttpRequest"), false);
    assert.equal(source.includes("WebSocket"), false);
  });
});
