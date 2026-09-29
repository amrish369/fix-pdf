import type { PDFDocumentProxy } from "pdfjs-dist";
import { screenBox, type Mat } from "./geometry";
import { refineFonts } from "./pdfjs";
import type { TextItemInfo } from "./types";

const hex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

/** Sample the rendered canvas: background = dominant border color, text = colors far from background. */
export function sampleColors(canvas: HTMLCanvasElement, dpr: number, vt: Mat, it: { x: number; y: number; size: number; angle: number; width: number }) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const fallback = { color: "#000000", bg: "#ffffff" };
  if (!ctx) return fallback;
  const b = screenBox(vt, it);
  const c = Math.cos(b.angle), s = Math.sin(b.angle);
  const w = Math.max(b.width, 2), h = b.height;
  const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([px, py]) => {
    const oy = py - b.ascent;
    return [b.baselineX + px * c - oy * s, b.baselineY + px * s + oy * c];
  });
  const xs = corners.map((p) => p[0]), ys = corners.map((p) => p[1]);
  const x0 = Math.max(0, Math.floor((Math.min(...xs) - 2) * dpr));
  const y0 = Math.max(0, Math.floor((Math.min(...ys) - 2) * dpr));
  const x1 = Math.min(canvas.width, Math.ceil((Math.max(...xs) + 2) * dpr));
  const y1 = Math.min(canvas.height, Math.ceil((Math.max(...ys) + 2) * dpr));
  const W = x1 - x0, H = y1 - y0;
  if (W <= 2 || H <= 2) return fallback;
  let data: Uint8ClampedArray;
  try {
    data = ctx.getImageData(x0, y0, W, H).data;
  } catch {
    return fallback;
  }
  const px = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    const a = data[i + 3] / 255;
    return [data[i] * a + 255 * (1 - a), data[i + 1] * a + 255 * (1 - a), data[i + 2] * a + 255 * (1 - a)];
  };
  const buckets = new Map<string, { n: number; r: number; g: number; b: number }>();
  const add = (p: number[]) => {
    const key = p.map((v) => v >> 4).join(",");
    const e = buckets.get(key) ?? { n: 0, r: 0, g: 0, b: 0 };
    e.n++; e.r += p[0]; e.g += p[1]; e.b += p[2];
    buckets.set(key, e);
  };
  for (let x = 0; x < W; x++) { add(px(x, 0)); add(px(x, H - 1)); }
  for (let y = 0; y < H; y++) { add(px(0, y)); add(px(W - 1, y)); }
  let best = { n: 0, r: 255, g: 255, b: 255 };
  buckets.forEach((e) => { if (e.n > best.n) best = e; });
  const bg = [best.r / best.n, best.g / best.n, best.b / best.n];
  const far: { d: number; p: number[] }[] = [];
  for (let y = 1; y < H - 1; y++)
    for (let x = 1; x < W - 1; x++) {
      const p = px(x, y);
      const d = Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]);
      if (d > 60) far.push({ d, p });
    }
  let color = "#000000";
  if (far.length) {
    far.sort((a, b) => b.d - a.d);
    const top = far.slice(0, Math.max(1, Math.ceil(far.length * 0.15)));
    const avg = [0, 1, 2].map((k) => top.reduce((s2, f) => s2 + f.p[k], 0) / top.length);
    color = hex(avg[0], avg[1], avg[2]);
  }
  return { color, bg: hex(bg[0], bg[1], bg[2]) };
}

/** Offscreen render a page to sample colors + refine fonts for items not yet visible (used by Find & Replace). */
export async function samplePageItems(pdf: PDFDocumentProxy, pageIndex: number, items: TextItemInfo[]) {
  const page = await pdf.getPage(pageIndex + 1);
  const vp = page.getViewport({ scale: 1.5 });
  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  const refined = refineFonts(page, items);
  const res = new Map<string, { item: TextItemInfo; color: string; bg: string }>();
  refined.forEach((it) => res.set(it.id, { item: it, ...sampleColors(canvas, 1, vp.transform, it) }));
  canvas.width = canvas.height = 0;
  return res;
}
