import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { createCanvas, DOMMatrix, ImageData, Path2D } from "@napi-rs/canvas";
import { PDFDocument, rgb } from "pdf-lib";

import { protectPdf } from "./index.ts";
import { rasterizePdf, zipNamed, type RasterTarget } from "./raster.ts";

if (!globalThis.DOMMatrix) globalThis.DOMMatrix = DOMMatrix as unknown as typeof globalThis.DOMMatrix;
if (!globalThis.ImageData) globalThis.ImageData = ImageData as unknown as typeof globalThis.ImageData;
if (!globalThis.Path2D) globalThis.Path2D = Path2D as unknown as typeof globalThis.Path2D;

function nodeTarget(width: number, height: number): RasterTarget {
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  return {
    canvas,
    fillWhite() {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    },
    async toBytes(kind) {
      return new Uint8Array(canvas.toBuffer(kind === "jpg" ? "image/jpeg" : "image/png"));
    },
  };
}

async function painted(color: ReturnType<typeof rgb>): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([120, 80]);
  page.drawRectangle({ x: 0, y: 0, width: 120, height: 80, color });
  return doc.save();
}

async function centerPixel(png: Uint8Array): Promise<Uint8ClampedArray> {
  const { loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(png);
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  return context.getImageData(Math.floor(image.width / 2), Math.floor(image.height / 2), 1, 1).data;
}

describe("rasterizePdf", () => {
  it("draws a page to a PNG", async () => {
    const [png] = await rasterizePdf(await painted(rgb(1, 0, 0)), "png", nodeTarget);
    assert.equal(png[0], 0x89);
    assert.equal(png[1], 0x50);
    const pixel = await centerPixel(png);
    assert.ok(pixel[0] > 200 && pixel[1] < 20 && pixel[2] < 20);
  });

  it("draws a page to a JPEG", async () => {
    const [jpg] = await rasterizePdf(await painted(rgb(0, 0, 1)), "jpg", nodeTarget);
    assert.equal(jpg[0], 0xff);
    assert.equal(jpg[1], 0xd8);
    const pixel = await centerPixel(jpg);
    assert.ok(pixel[2] > 200 && pixel[0] < 40);
  });

  it("returns one image per page", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([40, 40]);
    doc.addPage([40, 40]);
    const images = await rasterizePdf(await doc.save(), "png", nodeTarget);
    assert.equal(images.length, 2);
  });

  it("refuses a protected PDF", async () => {
    const locked = await protectPdf(await painted(rgb(0, 1, 0)), "secret");
    await assert.rejects(() => rasterizePdf(locked, "png", nodeTarget), /Unlock it in this tab/);
  });

  it("refuses an empty file", async () => {
    await assert.rejects(() => rasterizePdf(new Uint8Array(), "png", nodeTarget), /could not be read/);
  });
});

describe("zipNamed", () => {
  it("packs named files", () => {
    const zip = zipNamed([
      { name: "page-1.jpg", bytes: new Uint8Array([1, 2, 3]) },
      { name: "page-2.jpg", bytes: new Uint8Array([4]) },
    ]);
    assert.equal(zip[0], 0x50);
    assert.equal(zip[1], 0x4b);
  });

  it("refuses a path entry", () => {
    assert.throws(() => zipNamed([{ name: "../secret.jpg", bytes: new Uint8Array([1]) }]), /plain file name/);
  });
});

describe("worker source", () => {
  it("does not open a network connection", () => {
    const directory = new URL(".", import.meta.url);
    for (const file of readdirSync(directory)) {
      if (!file.endsWith(".ts") || file.endsWith(".test.ts")) continue;
      const source = readFileSync(new URL(file, directory), "utf8");
      assert.equal(/\bfetch\s*\(/.test(source), false, file);
      assert.equal(source.includes("WebSocket"), false, file);
      assert.equal(source.includes("sendBeacon"), false, file);
      assert.equal(source.includes("XMLHttpRequest"), false, file);
    }
  });
});
