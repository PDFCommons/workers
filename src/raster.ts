import { zipSync } from "fflate";

export type RasterKind = "jpg" | "png";

export type RasterCanvas = {
  width: number;
  height: number;
};

export type RasterTarget = {
  canvas: RasterCanvas;
  fillWhite: () => void;
  toBytes: (kind: RasterKind) => Promise<Uint8Array>;
};

const MAX_PAGES = 30;
const MAX_EDGE = 2400;

type PdfjsModule = {
  getDocument: (params: Record<string, unknown>) => {
    promise: Promise<PdfDocument>;
    destroy: () => Promise<void>;
  };
  GlobalWorkerOptions: { workerSrc: string };
};

type PdfDocument = {
  numPages: number;
  getPage: (number: number) => Promise<PdfPage>;
};

type PdfPage = {
  getViewport: (params: { scale: number }) => { width: number; height: number };
  render: (params: { canvas: RasterCanvas; viewport: { width: number; height: number } }) => {
    promise: Promise<void>;
  };
  cleanup?: () => void;
};

let workerConfigured = false;

function configureWorker(pdfjs: PdfjsModule) {
  if (workerConfigured || typeof document === "undefined") return;
  workerConfigured = true;
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
    import.meta.url,
  ).href;
}

async function loadPdfjs(): Promise<PdfjsModule> {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.mjs")) as unknown as PdfjsModule;
  configureWorker(pdfjs);
  return pdfjs;
}

function readableError(error: unknown): Error {
  const message = error instanceof Error ? error.message : "";
  if (/password|encrypted/i.test(message)) {
    return new Error("This PDF is protected. Unlock it in this tab first.");
  }
  if (error instanceof Error && message.startsWith("This ")) return error;
  return new Error("This PDF could not be read.");
}

/** Draw each page to an image. The bytes never leave the caller. */
export async function rasterizePdf(
  input: Uint8Array,
  kind: RasterKind,
  createTarget: (width: number, height: number) => RasterTarget,
): Promise<Uint8Array[]> {
  if (input.byteLength === 0) throw new Error("This PDF could not be read.");
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(input),
    verbosity: 0,
    isEvalSupported: false,
    disableFontFace: true,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages < 1) throw new Error("This PDF has no pages.");
    if (pdf.numPages > MAX_PAGES) {
      throw new Error(`This tab rasterizes up to ${MAX_PAGES} pages. Split the PDF first.`);
    }
    const images: Uint8Array[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      try {
        let viewport = page.getViewport({ scale: 2 });
        const edge = Math.max(viewport.width, viewport.height);
        if (edge > MAX_EDGE) {
          viewport = page.getViewport({ scale: (2 * MAX_EDGE) / edge });
        }
        const width = Math.max(1, Math.ceil(viewport.width));
        const height = Math.max(1, Math.ceil(viewport.height));
        const target = createTarget(width, height);
        target.fillWhite();
        await page.render({ canvas: target.canvas, viewport }).promise;
        images.push(await target.toBytes(kind));
      } finally {
        page.cleanup?.();
      }
    }
    return images;
  } catch (error) {
    throw readableError(error);
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

export function browserRasterTarget(width: number, height: number): RasterTarget {
  if (typeof document === "undefined") {
    throw new Error("Rasterizing runs in the browser.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw the page.");
  return {
    canvas,
    fillWhite() {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
    },
    toBytes(kind) {
      const type = kind === "jpg" ? "image/jpeg" : "image/png";
      return new Promise((resolve, reject) => {
        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("Could not encode this page."));
              return;
            }
            blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
          },
          type,
          kind === "jpg" ? 0.92 : undefined,
        );
      });
    },
  };
}

export function zipNamed(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  if (files.length === 0) throw new Error("Nothing to pack.");
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    if (!file.name || file.name.includes("/") || file.name.includes("\\")) {
      throw new Error("Zip entries need a plain file name.");
    }
    entries[file.name] = file.bytes;
  }
  return zipSync(entries);
}
