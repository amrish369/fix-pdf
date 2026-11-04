import type { TextItemInfo, TextStyle } from "@/lib/pdf/types";
import { groqPageCommand } from "./page.functions";

export interface PageChange { id: string; text?: string | undefined; style: Partial<TextStyle> }

/** Ask AI which text blocks on the page to change for a plain-language command. */
export async function aiPageCommand(items: TextItemInfo[], cmd: string): Promise<{ changes: PageChange[]; note?: string | undefined }> {
  const list = items.slice(0, 600).map((it) => ({ id: it.id, t: it.str, x: Math.round(it.x), y: Math.round(it.y), s: +it.size.toFixed(1), b: it.bold || undefined }));
  const prompt = `You edit a PDF page. Text blocks on the page (y grows upward, so higher y = higher on page):
${JSON.stringify(list)}
User command (may be Hindi/Hinglish): "${cmd.slice(0, 500)}"
Decide which blocks must change to do exactly what the user asks, anywhere on the page. Keep unrelated blocks untouched.
Return ONLY JSON: {"changes":[{"id":"block id","text":"full new text of that block (omit if unchanged)","bold":bool,"italic":bool,"color":"#rrggbb","size":points}],"note":"short Hinglish reply"}
Only include fields that change. Use exact ids from the list.`;
  const res = await groqPageCommand({ data: { prompt } });
  if (!res.ok) throw new Error(res.error);
  const m = res.text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("AI ne valid answer nahi diya");
  type C = { id?: unknown; text?: unknown; bold?: unknown; italic?: unknown; color?: unknown; size?: unknown };
  const j = JSON.parse(m[0]) as { changes?: C[]; note?: string };
  const ids = new Set(items.map((i) => i.id));
  const changes: PageChange[] = [];
  for (const c of j.changes ?? []) {
    if (typeof c.id !== "string" || !ids.has(c.id)) continue;
    const style: Partial<TextStyle> = {};
    if (typeof c.bold === "boolean") { style.bold = c.bold; style.weight = c.bold ? 700 : 400; }
    if (typeof c.italic === "boolean") style.italic = c.italic;
    if (typeof c.color === "string" && /^#[0-9a-f]{6}$/i.test(c.color)) style.color = c.color.toLowerCase();
    const sz = Number(c.size); if (Number.isFinite(sz) && sz >= 1 && sz <= 400) style.size = sz;
    changes.push({ id: c.id, text: typeof c.text === "string" ? c.text : undefined, style });
  }
  return { changes, note: typeof j.note === "string" ? j.note : undefined };
}
