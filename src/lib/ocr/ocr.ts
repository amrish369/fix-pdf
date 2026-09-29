import type { PDFDocumentProxy } from "pdfjs-dist";
import type { TextItemInfo } from "../pdf/types";

/**
 * OCR pipeline for scanned pages. Tesseract.js is lazy-loaded only when the user asks for OCR,
 * and runs in its own Web Worker, so it never slows down native text editing.
 * Output is the same TextItemInfo model as native text, so the editor/export pipeline is shared.
 */
export function isLikelyScanned(itemsByPage: Record<number, TextItemInfo[]>, numPages: number) {
  const chars = Object.values(itemsByPage).reduce((s, arr) => s + arr.reduce((a, i) => a + i.str.trim().length, 0), 0);
  return chars < Math.max(10, numPages * 5);
}

export async function ocrPage(
  pdf: PDFDocumentProxy,
  pageIndex: number,
  onProgress?: (p: number) => void,
): Promise<TextItemInfo[]> {
  const page = await pdf.getPage(pageIndex + 1);
  const scale = 2;
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  await page.render({ canvasContext: canvas.getContext("2d")!, canvas, viewport: vp }).promise;

  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress?.(m.progress);
    },
  });
  try {
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const items: TextItemInfo[] = [];
    let n = 0;
    for (const block of data.blocks ?? [])
      for (const para of block.paragraphs)
        for (const line of para.lines) {
          const text = line.text.trim();
          if (!text) continue;
          const { x0, y1, x1 } = line.bbox;
          const hPx = (line.rowAttributes?.rowHeight ?? line.bbox.y1 - line.bbox.y0) * 0.8;
          const baselineY = line.baseline?.y0 ?? y1;
          const [px, py] = vp.convertToPdfPoint(x0, baselineY);
          items.push({
            id: `p${pageIndex}-ocr${n++}`,
            page: pageIndex,
            str: text,
            x: px,
            y: py,
            width: (x1 - x0) / scale,
            size: Math.max(4, hPx / scale),
            angle: 0,
            fontName: "ocr",
            family: "sans",
            bold: false,
            italic: false,
            source: "ocr",
          });
        }
    return items;
  } finally {
    await worker.terminate();
    canvas.width = canvas.height = 0;
  }
}
