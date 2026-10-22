import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Edit, TextStyle } from "@/lib/pdf/types";
import { screenBox } from "@/lib/pdf/geometry";
import { groqMatch } from "./groq.functions";

export type Provider = "groq" | "gemini";
const KEY = "docedit-ai-keys";

export interface AiKeys { groq?: string | undefined; gemini?: string | undefined; provider?: Provider | undefined }
export function loadKeys(): AiKeys {
  try { return JSON.parse(localStorage.getItem(KEY) || "{}"); } catch { return {}; }
}
export function saveKeys(k: AiKeys) { localStorage.setItem(KEY, JSON.stringify(k)); }

export interface MatchResult { style: Partial<TextStyle>; bg?: string | undefined; note?: string | undefined; score?: number | undefined; text?: string | undefined }

/** Render only the original area of the page (without edits) and return a PNG data URL. */
async function cropOriginal(pdf: PDFDocumentProxy, e: Edit): Promise<string> {
  const page = await pdf.getPage(e.page + 1);
  const scale = 3;
  const vp = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width); canvas.height = Math.ceil(vp.height);
  await page.render({ canvasContext: canvas.getContext("2d")!, viewport: vp, canvas } as never).promise;
  const src = e.original ?? e;
  const b = screenBox(vp.transform, { x: src.x, y: src.y, size: (e.original?.size ?? e.style.size), angle: src.angle, width: Math.max(e.width, e.style.size * 4) });
  const pad = b.fontH * 0.6;
  const x = Math.max(0, b.left - pad), y = Math.max(0, b.top - pad);
  const w = Math.min(canvas.width - x, b.width + pad * 2), h = Math.min(canvas.height - y, b.height + pad * 2);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(w)); out.height = Math.max(1, Math.round(h));
  out.getContext("2d")!.drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height);
  const url = out.toDataURL("image/png");
  canvas.width = canvas.height = 0;
  return url;
}

function prompt(e: Edit) {
  return `You are a typography matcher for a PDF editor. The image is a crop of the ORIGINAL PDF text "${e.original?.str ?? e.text}".
The editor currently replaces it with "${e.text}" using this style: ${JSON.stringify({ ...e.style, bg: e.bg })} (size in PDF points).
Detected font name: "${e.original?.fontName ?? "unknown"}".
Look carefully at the image and return ONLY a JSON object, no prose, with the corrected style so the new text looks identical to the original:
Pay close attention to: stroke thickness (weight), edge softness/blur from scanning or printing, ink fading (opacity) and spacing between letters.
{"family":"sans|serif|mono","weight":number 300-900 (400 regular, 500 medium, 600 semibold, 700 bold, 800 heavy),"bold":true|false,"blur":number 0-1.5 (edge softness in px, 0 for crisp vector text),"opacity":number 0.5-1 (ink strength),"letterSpacing":number -1 to 3 (extra points between letters, 0 normal),"score":number 0-100 (how identical the current style already is),"italic":true|false,"color":"#rrggbb text colour","bg":"#rrggbb background colour behind text","sizeAdjust":number between -1.5 and 1.5 (points to add to size),"note":"short reason"}`;
}

function commandPrompt(e: Edit, cmd: string) {
  return `You are an assistant inside a PDF editor. The image is a crop of the ORIGINAL PDF area around the text "${e.original?.str ?? e.text}".
The editor currently draws the text "${e.text}" with style ${JSON.stringify({ ...e.style, bg: e.bg })} (size in PDF points).
The user reports this problem / asks this (may be Hindi/Hinglish): "${cmd}"
Fix exactly what the user asks, keeping everything else as it is. Return ONLY JSON with the fields you change (omit others):
{"text":"new text only if user asks to change words","family":"sans|serif|mono","weight":300-900,"bold":bool,"italic":bool,"blur":0-1.5,"opacity":0.3-1,"letterSpacing":-1..3,"color":"#rrggbb","bg":"#rrggbb","size":absolute size in points,"sizeAdjust":-3..3,"note":"short reply in Hinglish"}`;
}

function parse(text: string, e: Edit): MatchResult {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI ne valid answer nahi diya");
  const j = JSON.parse(m[0]);
  const hex = (v: unknown) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined);
  const style: Partial<TextStyle> = {};
  if (["sans", "serif", "mono"].includes(j.family)) style.family = j.family;
  if (typeof j.bold === "boolean") style.bold = j.bold;
  if (typeof j.italic === "boolean") style.italic = j.italic;
  const c = hex(j.color); if (c) style.color = c;
  const num = (v: unknown, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined; };
  const wt = num(j.weight, 100, 900); if (wt !== undefined) { style.weight = Math.round(wt / 50) * 50; style.bold = style.weight >= 600; }
  const bl = num(j.blur, 0, 1.5); if (bl !== undefined) style.blur = +bl.toFixed(2);
  const op = num(j.opacity, 0.3, 1); if (op !== undefined) style.opacity = +op.toFixed(2);
  const sp = num(j.letterSpacing, -1, 3); if (sp !== undefined) style.letterSpacing = +sp.toFixed(2);
  const adj = Number(j.sizeAdjust);
  if (Number.isFinite(adj) && Math.abs(adj) <= 3 && adj !== 0) style.size = +(e.style.size + adj).toFixed(2);
  const abs = num(j.size, 1, 400); if (abs !== undefined) style.size = +abs.toFixed(2);
  return { style, bg: hex(j.bg), text: typeof j.text === "string" ? j.text : undefined, note: typeof j.note === "string" ? j.note : undefined, score: num(j.score, 0, 100) };
}

async function callGroq(key: string, img: string, p: string) {
  const r = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: [{ type: "text", text: p }, { type: "image_url", image_url: { url: img } }] }],
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Groq: ${j?.error?.message ?? r.status}`);
  return j.choices?.[0]?.message?.content ?? "";
}

async function callGemini(key: string, img: string, p: string) {
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: p }, { inline_data: { mime_type: "image/png", data: img.split(",")[1] } }] }],
      generationConfig: { temperature: 0, responseMimeType: "application/json" },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Gemini: ${j?.error?.message ?? r.status}`);
  return j.candidates?.[0]?.content?.parts?.map((x: { text?: string }) => x.text ?? "").join("") ?? "";
}

export async function aiMatch(pdf: PDFDocumentProxy, e: Edit, keys: AiKeys, cmd?: string): Promise<MatchResult> {
  const img = await cropOriginal(pdf, e);
  const p = cmd ? commandPrompt(e, cmd.slice(0, 500)) : prompt(e);
  let lastErr: unknown;
  // 1) Secure backend Groq (key stays on server)
  try {
    const res = await groqMatch({ data: { img, prompt: p } });
    if (res.ok) return parse(res.text, e);
    lastErr = new Error(res.error);
  } catch (err) { lastErr = err; }
  // 2) Optional fallback: browser-saved keys
  const order: Provider[] = keys.provider === "gemini" ? ["gemini", "groq"] : ["groq", "gemini"];
  for (const prov of order.filter((x) => keys[x])) {
    try {
      const txt = prov === "groq" ? await callGroq(keys.groq!, img, p) : await callGemini(keys.gemini!, img, p);
      return parse(txt, e);
    } catch (err) { lastErr = err; }
  }
  throw lastErr instanceof Error ? lastErr : new Error("AI match failed");
}
