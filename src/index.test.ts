import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PDFDocument } from "pdf-lib";
import {
  compressPdf,
  deletePdfPages,
  mergePdfs,
  pageCount,
  protectPdf,
  reorderPdf,
  rotatePdf,
  splitPdf,
  unlockPdf,
} from "./index.ts";

async function blank(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage();
  return doc.save();
}

describe("workers", () => {
  it("merges pages from two files", async () => {
    const out = await mergePdfs([await blank(1), await blank(2)]);
    assert.equal(await pageCount(out), 3);
  });

  it("refuses to merge nothing", async () => {
    await assert.rejects(() => mergePdfs([]), /at least one PDF/);
  });

  it("splits one file per page", async () => {
    const parts = await splitPdf(await blank(3));
    assert.equal(parts.length, 3);
    for (const part of parts) assert.equal(await pageCount(part), 1);
  });

  it("rotates every page", async () => {
    const out = await rotatePdf(await blank(1), 90);
    const doc = await PDFDocument.load(out);
    assert.equal(doc.getPage(0).getRotation().angle, 90);
  });

  it("deletes a page and keeps the rest", async () => {
    const out = await deletePdfPages(await blank(3), [2]);
    assert.equal(await pageCount(out), 2);
  });

  it("reorders pages", async () => {
    const src = await PDFDocument.create();
    src.addPage([100, 100]);
    src.addPage([200, 200]);
    const out = await reorderPdf(await src.save(), [2, 1]);
    const doc = await PDFDocument.load(out);
    assert.equal(doc.getPage(0).getWidth(), 200);
    assert.equal(doc.getPage(1).getWidth(), 100);
  });

  it("compress returns a pdf", async () => {
    const out = await compressPdf(await blank(1));
    assert.equal(await pageCount(out), 1);
  });

  it("protects with a password and unlocks back to a pdf-lib document", async () => {
    const input = await blank(2);
    const password = "--secret";
    const protectedBytes = await protectPdf(input, password);
    assert.equal(Buffer.from(protectedBytes).equals(Buffer.from(input)), false);
    await assert.rejects(() => PDFDocument.load(protectedBytes), /encrypted/);
    const unlocked = await unlockPdf(protectedBytes, password);
    const doc = await PDFDocument.load(unlocked);
    assert.equal(doc.getPageCount(), 2);
  });

  it("refuses to protect or unlock without a password", async () => {
    const input = await blank(1);
    await assert.rejects(() => protectPdf(input, ""), /Choose a password/);
    await assert.rejects(() => unlockPdf(input, ""), /password you already know/);
  });

  it("does not unlock when the password is wrong", async () => {
    const protectedBytes = await protectPdf(await blank(1), "right");
    await assert.rejects(() => unlockPdf(protectedBytes, "wrong"), /did not open/);
  });
});
