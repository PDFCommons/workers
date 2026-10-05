import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { countPages, unpredict } from "./pdf.ts";

function classicPdf(): Uint8Array {
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>\nendobj\n",
    "4 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] >>\nendobj\n",
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(body.length);
    body += object;
  }
  const xrefAt = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n`;
  xref += "0000000000 65535 f \n";
  for (let index = 1; index <= objects.length; index += 1) {
    xref += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  xref += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`;
  return new TextEncoder().encode(body + xref);
}

describe("countPages", () => {
  it("counts a classic xref file this reader wrote in the test", async () => {
    assert.equal(await countPages(classicPdf()), 2);
  });

  it("counts the one-page xref-stream fixture", async () => {
    const bytes = readFileSync(new URL("../../wasm/fixtures/one-page.pdf", import.meta.url));
    assert.equal(await countPages(bytes), 1);
  });

  it("counts the two-page xref-stream fixture", async () => {
    const bytes = readFileSync(new URL("../../wasm/fixtures/two-page.pdf", import.meta.url));
    assert.equal(await countPages(bytes), 2);
  });

  it("rejects empty bytes", async () => {
    await assert.rejects(() => countPages(new Uint8Array()), /This PDF could not be read\./);
  });

  it("rejects bytes that are not a PDF", async () => {
    await assert.rejects(() => countPages(new TextEncoder().encode("hello")), /This PDF could not be read\./);
  });

  it("rejects a trailer that names an encryption dictionary", async () => {
    const plain = new TextDecoder().decode(classicPdf());
    const locked = plain.replace("/Root 1 0 R", "/Root 1 0 R /Encrypt 9 0 R");
    await assert.rejects(() => countPages(new TextEncoder().encode(locked)), /This PDF could not be read\./);
  });
});

describe("unpredict", () => {
  it("adds the previous row for predictor tag 2", () => {
    const data = new Uint8Array([2, 1, 2, 2, 1, 2]);
    assert.deepEqual([...unpredict(data, 2, 12)], [1, 2, 2, 4]);
  });
});
