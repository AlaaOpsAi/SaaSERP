/**
 * The document viewer for people who may look but not download (customer comment 7).
 * Pages are drawn on the server as images with the viewer's name, employee ID and the time
 * written diagonally across them, so there is no clean file to save, and any screenshot,
 * print or photo shows who took it and when.
 *
 * PDF pages are drawn with pdf.js; photos (JPEG, PNG) are redrawn the same way.
 */
import { createRequire } from 'node:module';
import { createCanvas, loadImage, type SKRSContext2D } from '@napi-rs/canvas';

const require = createRequire(import.meta.url);
type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');
let pdfjs: Promise<PdfJs> | null = null;
const loadPdfJs = () => (pdfjs ??= import(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')) as Promise<PdfJs>);

export type Viewable = { kind: 'pdf' | 'image'; data: Buffer };

const SCALE = 1.5;
const MAX_IMAGE_WIDTH = 1600;

/** Open a PDF; `close` frees it again. */
async function openPdf(data: Buffer) {
  const { getDocument } = await loadPdfJs();
  const task = getDocument({ data: new Uint8Array(data), useSystemFonts: true, verbosity: 0 });
  return { doc: await task.promise, close: () => task.destroy() };
}

export async function pageCount(src: Viewable): Promise<number> {
  if (src.kind === 'image') return 1;
  const { doc, close } = await openPdf(src.data);
  try { return doc.numPages; } finally { await close(); }
}

/** Faint diagonal lines of "Name · E2021001 · 20/10/2026 14:32" across the whole page. */
function watermark(ctx: SKRSContext2D, width: number, height: number, text: string) {
  const size = Math.max(16, Math.round(width / 38));
  ctx.save();
  ctx.globalAlpha = 0.16;
  ctx.fillStyle = '#c0003c';
  ctx.font = `bold ${size}px sans-serif`;
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-Math.PI / 6);
  const line = `${text}        `;
  const step = ctx.measureText(line).width;
  for (let y = -height; y < height; y += size * 6) {
    for (let x = -width * 1.2; x < width * 1.2; x += step) ctx.fillText(line, x, y);
  }
  ctx.restore();
}

/** One page as a PNG with the watermark drawn into it. `page` starts at 1. */
export async function renderPage(src: Viewable, page: number, mark: string): Promise<Buffer> {
  if (src.kind === 'image') {
    const img = await loadImage(src.data);
    const scale = Math.min(1, MAX_IMAGE_WIDTH / img.width);
    const canvas = createCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    watermark(ctx, canvas.width, canvas.height, mark);
    return canvas.toBuffer('image/png');
  }
  const { doc, close } = await openPdf(src.data);
  try {
    const p = await doc.getPage(page);
    const viewport = p.getViewport({ scale: SCALE });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // pdf.js accepts this canvas in Node; its types expect a browser canvas.
    await p.render({ canvas: canvas as never, canvasContext: ctx as never, viewport }).promise;
    watermark(ctx, canvas.width, canvas.height, mark);
    return canvas.toBuffer('image/png');
  } finally {
    await close();
  }
}
