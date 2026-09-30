import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont } from "pdf-lib";
import type { Edit, Edits, FontFamily } from "./types";

const FONT_MAP: Record<FontFamily, [StandardFonts, StandardFonts, StandardFonts, StandardFonts]> = {
  sans: [StandardFonts.Helvetica, StandardFonts.HelveticaBold, StandardFonts.HelveticaOblique, StandardFonts.HelveticaBoldOblique],
  serif: [StandardFonts.TimesRoman, StandardFonts.TimesRomanBold, StandardFonts.TimesRomanItalic, StandardFonts.TimesRomanBoldItalic],
  mono: [StandardFonts.Courier, StandardFonts.CourierBold, StandardFonts.CourierOblique, StandardFonts.CourierBoldOblique],
};

function toRgb(h: string) {
  const n = parseInt(h.replace("#", ""), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

/** Standard fonts only cover WinAnsi; drop characters they cannot encode instead of crashing. */
function sanitize(font: PDFFont, text: string) {
  let out = "";
  for (const ch of text) {
    try { font.encodeText(ch); out += ch; } catch { out += "?"; }
  }
  return out;
}

export async function exportPdf(original: Uint8Array, edits: Edits): Promise<Uint8Array> {
  let doc: PDFDocument;
  try {
    doc = await PDFDocument.load(original, { updateMetadata: false });
  } catch (e) {
    if ((e as Error)?.constructor?.name === "EncryptedPDFError" || /encrypt/i.test(String((e as Error)?.message)))
      throw new Error("This PDF is encrypted. Exporting encrypted PDFs is not supported yet.");
    throw new Error("Could not prepare PDF for export: " + (e as Error).message);
  }
  const cache = new Map<string, PDFFont>();
  const font = async (e: Edit) => {
    const idx = (e.style.bold ? 1 : 0) + (e.style.italic ? 2 : 0);
    const name = FONT_MAP[e.style.family][idx];
    if (!cache.has(name)) cache.set(name, await doc.embedFont(name));
    return cache.get(name)!;
  };
  const pages = doc.getPages();
  for (const e of Object.values(edits)) {
    if (e.pristine) continue;
    const page = pages[e.page];
    if (!page) continue;
    const c = Math.cos(e.angle), s = Math.sin(e.angle);
    const rot = degrees((e.angle * 180) / Math.PI);
    const at = (dx: number, dy: number) => ({ x: e.x + dx * c - dy * s, y: e.y + dx * s + dy * c });

    // 0. Eraser / whiteout: a plain rectangle filled with the surrounding background colour.
    if (e.kind === "erase") {
      page.drawRectangle({ x: e.x, y: e.y, width: e.rectW ?? 0, height: e.rectH ?? 0, color: toRgb(e.bg) });
      continue;
    }
    // 1. Cover the original glyphs with the sampled background color.
    const covers = e.covers ?? (e.original ? [{ x: e.x, y: e.y, size: e.original.size, angle: e.angle, width: e.width }] : []);
    if (!e.isNew) {
      for (const cv of covers) {
        const cc = Math.cos(cv.angle), cs = Math.sin(cv.angle);
        const pad = cv.size * 0.06;
        const dx = -pad, dy = -cv.size * 0.28;
        page.drawRectangle({
          x: cv.x + dx * cc - dy * cs,
          y: cv.y + dx * cs + dy * cc,
          width: cv.width + pad * 2,
          height: cv.size * 1.24,
          rotate: degrees((cv.angle * 180) / Math.PI),
          color: toRgb(e.bg),
        });
      }
    }
    // 2. Draw replacement text with matched font/size/color/position.
    if (!e.text) continue;
    const f = await font(e);
    const text = sanitize(f, e.text);
    const w = f.widthOfTextAtSize(text, e.style.size);
    let dx = 0;
    if (e.width && e.style.align === "center") dx = (e.width - w) / 2;
    if (e.width && e.style.align === "right") dx = e.width - w;
    page.drawText(text, { ...at(dx, 0), size: e.style.size, font: f, color: toRgb(e.style.color), rotate: rot });
  }
  return doc.save();
}

export function downloadBytes(bytes: Uint8Array, name: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
