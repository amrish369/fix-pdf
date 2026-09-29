import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { FontFamily, TextItemInfo } from "./types";

let libPromise: Promise<typeof import("pdfjs-dist")> | null = null;

/** Browser-only lazy load; parsing/rendering runs in the PDF.js Web Worker. */
export function getPdfjs() {
  if (!libPromise) {
    libPromise = import("pdfjs-dist").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = workerUrl;
      return lib;
    });
  }
  return libPromise;
}

export const MAX_BYTES = 100 * 1024 * 1024;

export async function loadPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const head = new TextDecoder().decode(bytes.slice(0, 1024));
  if (!head.includes("%PDF-")) throw new Error("This file is not a valid PDF.");
  const pdfjs = await getPdfjs();
  const task = pdfjs.getDocument({
    data: bytes.slice(), // worker takes ownership of the buffer
    enableXfa: false,
    stopAtErrors: false,
  });
  task.onPassword = (update: (pw: string) => void, reason: number) => {
    const pw = window.prompt(
      reason === 2 ? "Incorrect password. Try again:" : "This PDF is password protected. Enter password:",
    );
    if (pw === null) void task.destroy();
    else update(pw);
  };
  try {
    return await task.promise;
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "PasswordException") throw new Error("Password required to open this PDF.");
    if (name === "InvalidPDFException") throw new Error("This PDF is corrupted or invalid.");
    if (String((e as Error)?.message).includes("destroyed")) throw new Error("Opening cancelled (password required).");
    throw new Error("Could not open this PDF: " + ((e as Error)?.message ?? "unknown error"));
  }
}

export function familyFromName(name: string, cssFamily?: string): FontFamily {
  const n = name.toLowerCase();
  if (/courier|mono|consol|menlo/.test(n) || cssFamily === "monospace") return "mono";
  if (/times|serif|georgia|garamond|cambria|book|minion|roman/.test(n) && !/sans/.test(n)) return "serif";
  if (cssFamily === "serif" && !/sans|arial|helvet/.test(n)) return "serif";
  return "sans";
}

export function styleFromName(name: string) {
  const n = name.toLowerCase();
  return {
    bold: /bold|black|heavy|semibold|demi|,b\b|-b\b/.test(n),
    italic: /italic|oblique|,i\b|-i\b/.test(n),
  };
}

export async function extractPageItems(pdf: PDFDocumentProxy, pageIndex: number): Promise<TextItemInfo[]> {
  const page = await pdf.getPage(pageIndex + 1);
  const tc = await page.getTextContent();
  const out: TextItemInfo[] = [];
  tc.items.forEach((raw, i) => {
    if (!("str" in raw)) return;
    if (!raw.str.trim()) return;
    const t = raw.transform as number[];
    const size = Math.hypot(t[2], t[3]) || Math.hypot(t[0], t[1]);
    const css = tc.styles[raw.fontName]?.fontFamily;
    const s = styleFromName(raw.fontName);
    out.push({
      id: `p${pageIndex}-i${i}`,
      page: pageIndex,
      str: raw.str,
      x: t[4],
      y: t[5],
      width: raw.width,
      size,
      angle: Math.atan2(t[1], t[0]),
      fontName: raw.fontName,
      family: familyFromName(raw.fontName, css),
      bold: s.bold,
      italic: s.italic,
      source: "native",
    });
  });
  return out;
}

/** After a page is rendered, PDF.js has the real font objects; use them to refine family/bold/italic. */
export function refineFonts(page: { commonObjs: { has: (k: string) => boolean; get: (k: string) => unknown } }, items: TextItemInfo[]) {
  return items.map((it) => {
    if (it.source !== "native") return it;
    try {
      if (!page.commonObjs.has(it.fontName)) return it;
      const f = page.commonObjs.get(it.fontName) as {
        name?: string; bold?: boolean; black?: boolean; italic?: boolean; isSerifFont?: boolean; isMonospace?: boolean;
      };
      const name = f?.name ?? "";
      const s = styleFromName(name);
      let family = familyFromName(name);
      if (f?.isMonospace) family = "mono";
      else if (f?.isSerifFont && family === "sans" && !/sans|arial|helvet/i.test(name)) family = "serif";
      return { ...it, family, bold: s.bold || !!f?.bold || !!f?.black, italic: s.italic || !!f?.italic };
    } catch {
      return it;
    }
  });
}
