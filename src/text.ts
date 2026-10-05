const NO_READ = "This PDF could not be read.";
const PROTECTED = "This PDF is protected. Unlock it in this tab first.";
const NO_PAGES = "This PDF has no pages.";
const NO_TEXT = "This PDF has no text layer. A scan needs OCR, which this page does not do.";

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
  getTextContent: () => Promise<{ items: unknown[] }>;
  cleanup?: () => void;
};

type Placed = {
  str: string;
  x: number;
  y: number;
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
  const name = error instanceof Error ? error.name : "";
  if (/password|encrypted/i.test(message) || /password/i.test(name)) {
    return new Error(PROTECTED);
  }
  if (error instanceof Error && message.startsWith("This ")) return error;
  return new Error(NO_READ);
}

function placedItem(item: unknown): Placed | null {
  if (typeof item !== "object" || item === null) return null;
  const record = item as { str?: unknown; transform?: unknown };
  if (typeof record.str !== "string" || !Array.isArray(record.transform)) return null;
  if (record.str.trim() === "") return null;
  const x = record.transform[4];
  const y = record.transform[5];
  if (typeof x !== "number" || typeof y !== "number") return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { str: record.str, x, y };
}

function linesFrom(items: readonly unknown[]): string[] {
  const placed = items.flatMap((item) => {
    const next = placedItem(item);
    return next ? [next] : [];
  });
  const sorted = placed.slice().sort((a, b) => b.y - a.y || a.x - b.x);
  const groups: { y: number; items: Placed[] }[] = [];
  for (const item of sorted) {
    const group = groups.find((line) => Math.abs(line.y - item.y) <= 2);
    if (group) group.items.push(item);
    else groups.push({ y: item.y, items: [item] });
  }
  groups.sort((a, b) => b.y - a.y);
  return groups.map((group) =>
    group.items
      .slice()
      .sort((a, b) => a.x - b.x)
      .map((item) => item.str)
      .join(" "),
  );
}

/** Read the text layer. The bytes never leave the caller. */
export async function pdfToText(input: Uint8Array): Promise<string> {
  if (input.byteLength === 0) throw new Error(NO_READ);
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(input),
    verbosity: 0,
    isEvalSupported: false,
    disableFontFace: true,
  });
  try {
    const pdf = await task.promise;
    if (pdf.numPages < 1) throw new Error(NO_PAGES);
    const pages: string[] = [];
    for (let number = 1; number <= pdf.numPages; number += 1) {
      const page = await pdf.getPage(number);
      try {
        const content = await page.getTextContent();
        pages.push(linesFrom(content.items).join("\n"));
      } finally {
        page.cleanup?.();
      }
    }
    const text = pages.join("\n\n");
    if (text.trim() === "") throw new Error(NO_TEXT);
    return text;
  } catch (error) {
    throw readableError(error);
  } finally {
    await task.destroy().catch(() => undefined);
  }
}
