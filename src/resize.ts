import { PDFDocument, PageSizes, degrees, type PDFPage } from "pdf-lib";

const CHOOSE = "Choose Letter or A4.";
const NO_READ = "This PDF could not be read.";
const NO_PAGES = "This PDF has no pages.";

const SHEETS = {
  letter: PageSizes.Letter,
  a4: PageSizes.A4,
} as const;

type Turn = 0 | 90 | 180 | 270;

function quarterTurn(page: PDFPage): Turn {
  const angle = ((page.getRotation().angle % 360) + 360) % 360;
  if (angle === 90 || angle === 180 || angle === 270) return angle;
  return 0;
}

// pdf-lib 1.17 getWidth reads the media box and does not apply Rotate.
function visualSize(page: PDFPage): { width: number; height: number } {
  const width = page.getWidth();
  const height = page.getHeight();
  const turn = quarterTurn(page);
  if (turn === 90 || turn === 270) return { width: height, height: width };
  return { width, height };
}

// drawPage rotates counterclockwise around the origin, then translates.
function place(
  turn: Turn,
  sheetWidth: number,
  sheetHeight: number,
  drawWidth: number,
  drawHeight: number,
): { x: number; y: number; rotate: number } {
  const left = (sheetWidth - drawWidth) / 2;
  const bottom = (sheetHeight - drawHeight) / 2;
  if (turn === 90) return { x: left, y: bottom + drawHeight, rotate: -90 };
  if (turn === 180) return { x: left + drawWidth, y: bottom + drawHeight, rotate: 180 };
  if (turn === 270) return { x: left + drawWidth, y: bottom, rotate: 90 };
  return { x: left, y: bottom, rotate: 0 };
}

export async function resizePdf(input: Uint8Array, paper: "letter" | "a4"): Promise<Uint8Array> {
  if (paper !== "letter" && paper !== "a4") throw new Error(CHOOSE);
  if (input.byteLength === 0) throw new Error(NO_READ);
  const source = await PDFDocument.load(input, { ignoreEncryption: true });
  const pages = source.getPages();
  if (pages.length === 0) throw new Error(NO_PAGES);
  const [sheetWidth, sheetHeight] = SHEETS[paper];
  const out = await PDFDocument.create();
  for (const page of pages) {
    const next = out.addPage([sheetWidth, sheetHeight]);
    if (!page.node.normalizedEntries().Contents) continue;
    const embedded = await out.embedPage(page);
    const { width: sourceWidth, height: sourceHeight } = visualSize(page);
    if (!(sourceWidth > 0) || !(sourceHeight > 0)) continue;
    const scale = Math.min(sheetWidth / sourceWidth, sheetHeight / sourceHeight);
    const turn = quarterTurn(page);
    const placed = place(turn, sheetWidth, sheetHeight, sourceWidth * scale, sourceHeight * scale);
    next.drawPage(embedded, {
      x: placed.x,
      y: placed.y,
      xScale: scale,
      yScale: scale,
      rotate: degrees(placed.rotate),
    });
  }
  return out.save();
}
