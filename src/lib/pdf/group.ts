import type { TextItemInfo } from "./types";

/**
 * PDF text is stored as many tiny runs ("India", " Post", " Bank"). Merge runs that sit on the
 * same baseline with matching style so one tap selects the whole phrase instead of one fragment.
 */
export function groupItems(items: TextItemInfo[]): TextItemInfo[] {
  if (items.length < 2) return items;
  const sorted = [...items].sort((a, b) => (Math.abs(a.y - b.y) > 1.2 ? b.y - a.y : a.x - b.x));
  const out: TextItemInfo[] = [];
  let cur: TextItemInfo | null = null;

  const sameStyle = (a: TextItemInfo, b: TextItemInfo) =>
    a.source === b.source &&
    a.bold === b.bold &&
    a.italic === b.italic &&
    a.family === b.family &&
    (a.color ?? "") === (b.color ?? "") &&
    Math.abs(a.angle - b.angle) < 0.02 &&
    Math.abs(a.size - b.size) <= a.size * 0.08;

  for (const it of sorted) {
    if (!cur) { cur = { ...it }; continue; }
    const gap = it.x - (cur.x + cur.width);
    const joinable =
      sameStyle(cur, it) &&
      Math.abs(it.y - cur.y) <= cur.size * 0.22 &&
      gap >= -cur.size * 0.4 &&
      gap <= cur.size * 0.75;
    if (joinable) {
      const needsSpace = gap > cur.size * 0.12 && !/\s$/.test(cur.str) && !/^\s/.test(it.str);
      cur.str = cur.str + (needsSpace ? " " : "") + it.str;
      cur.width = Math.max(cur.width, it.x + it.width - cur.x);
    } else {
      out.push(cur);
      cur = { ...it };
    }
  }
  if (cur) out.push(cur);
  return out;
}
