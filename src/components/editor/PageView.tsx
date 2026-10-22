import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { apply, invert, screenBox, type Mat } from "@/lib/pdf/geometry";
import { refineFonts } from "@/lib/pdf/pdfjs";
import { sampleColors, sampleRectBg } from "@/lib/pdf/colors";
import type { CoverRect, Edit, Edits, TextItemInfo } from "@/lib/pdf/types";

export const CSS_FONT = {
  sans: "Helvetica, Arial, 'Liberation Sans', sans-serif",
  serif: "'Times New Roman', Times, 'Liberation Serif', serif",
  mono: "'Courier New', Courier, 'Liberation Mono', monospace",
} as const;

// Where the user tapped, so the caret lands exactly there once the editor opens.
let pendingCaret: { x: number; y: number } | null = null;
// Focusing an input inside the tap itself makes mobile browsers open the keyboard immediately.
function primeKeyboard() {
  let el = document.getElementById("kb-primer") as HTMLInputElement | null;
  if (!el) {
    el = document.createElement("input");
    el.id = "kb-primer";
    el.setAttribute("aria-hidden", "true");
    el.style.cssText = "position:fixed;top:40%;left:0;width:1px;height:1px;opacity:0;font-size:16px;border:0;padding:0";
    document.body.appendChild(el);
  }
  el.focus({ preventScroll: true });
}

export type Mode = "edit" | "add" | "select" | "erase";

export interface PageApi {
  selectItem: (id: string) => void;
}

interface Props {
  pdf: PDFDocumentProxy;
  pageIndex: number;
  scale: number;
  baseSize: { w: number; h: number };
  items: TextItemInfo[];
  edits: Edits;
  selectedId: string | null;
  mode: Mode;
  onCreateEdit: (edit: Edit) => void;
  onSelect: (id: string | null) => void;
  onCommitText: (id: string, text: string) => void;
  onItemsRefined: (page: number, items: TextItemInfo[]) => void;
  onVisible: (page: number) => void;
  onTab?: (id: string, back: boolean) => void;
  registerEl: (page: number, el: HTMLDivElement | null) => void;
  registerApi?: (page: number, api: PageApi | null) => void;
}

export function PageView(p: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [vt, setVt] = useState<Mat | null>(null);
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const refinedRef = useRef(false);
  const dprRef = useRef(1);
  const itemsRef = useRef(p.items);
  itemsRef.current = p.items;
  const vtRef = useRef<Mat | null>(null);
  vtRef.current = vt;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    p.registerEl(p.pageIndex, el);
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { rootMargin: "1200px 0px" });
    const io2 = new IntersectionObserver(([e]) => e.isIntersecting && p.onVisible(p.pageIndex), { threshold: 0.4 });
    io.observe(el);
    io2.observe(el);
    return () => { io.disconnect(); io2.disconnect(); p.registerEl(p.pageIndex, null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.pageIndex]);

  useEffect(() => {
    if (!near) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    (async () => {
      const page = await p.pdf.getPage(p.pageIndex + 1);
      if (cancelled) return;
      const vp = page.getViewport({ scale: p.scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      dprRef.current = dpr;
      const canvas = canvasRef.current!;
      canvas.width = Math.floor(vp.width * dpr);
      canvas.height = Math.floor(vp.height * dpr);
      const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
      task = page.render({ canvasContext: ctx, viewport: vp, transform: [dpr, 0, 0, dpr, 0, 0] });
      try { await task.promise; } catch { return; }
      if (cancelled) return;
      setVt(vp.transform);
      const current = itemsRef.current;
      if (!refinedRef.current && current.length) {
        refinedRef.current = true;
        p.onItemsRefined(p.pageIndex, refineFonts(page, current));
      }
    })();
    return () => { cancelled = true; task?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, p.scale, p.pdf, p.pageIndex, p.items.length]);

  const pageEdits = Object.values(p.edits).filter((e) => e.page === p.pageIndex);
  const hiddenIds = new Set<string>();
  pageEdits.forEach((e) => {
    hiddenIds.add(e.id);
    e.memberIds?.forEach((m) => hiddenIds.add(m));
  });

  const editFromItems = useCallback((list: TextItemInfo[]) => {
    const vtx = vtRef.current;
    if (!vtx || !canvasRef.current || !list.length) return;
    const ordered = [...list].sort((a, b) => (Math.abs(a.y - b.y) > 1.2 ? b.y - a.y : a.x - b.x));
    const head = ordered[0];
    const sampled = sampleColors(canvasRef.current, dprRef.current, vtx, head);
    const color = head.color ?? sampled.color;
    const firstLine = ordered.filter((it) => Math.abs(it.y - head.y) <= head.size * 0.5);
    const lineWidth = Math.max(...firstLine.map((it) => it.x + it.width - head.x));
    const covers: CoverRect[] = ordered.map((it) => ({ x: it.x, y: it.y, size: it.size, angle: it.angle, width: it.width }));
    let text = "";
    ordered.forEach((it, i) => {
      if (i === 0) { text = it.str; return; }
      const prev = ordered[i - 1];
      const sameLine = Math.abs(it.y - prev.y) <= prev.size * 0.5;
      const gap = it.x - (prev.x + prev.width);
      text += sameLine && gap <= prev.size * 0.12 ? it.str : " " + it.str;
    });
    p.onCreateEdit({
      id: ordered.length > 1 ? `sel-${head.id}-${ordered.length}` : head.id,
      page: p.pageIndex,
      kind: "text",
      text,
      style: { size: head.size, color, bold: ordered.some((it) => it.bold), italic: ordered.some((it) => it.italic), family: head.family, align: "left" },
      bg: sampled.bg,
      x: head.x, y: head.y, angle: head.angle, width: lineWidth,
      original: head,
      covers,
      memberIds: ordered.map((it) => it.id),
      isNew: false,
      pristine: true,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.pageIndex, p.onCreateEdit]);

  useEffect(() => {
    const api: PageApi = {
      selectItem: (id) => {
        const it = itemsRef.current.find((i) => i.id === id);
        if (it) editFromItems([it]);
      },
    };
    p.registerApi?.(p.pageIndex, api);
    return () => p.registerApi?.(p.pageIndex, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.pageIndex, editFromItems]);

  const addTextAt = (clientX: number, clientY: number, inherit = false) => {
    const el = overlayRef.current;
    if (!vt || !el) return;
    const r = el.getBoundingClientRect();
    let [x, y] = apply(invert(vt), clientX - r.left, clientY - r.top);
    // Copy the style of the nearest text (same row first, e.g. table cells), so new data looks the same.
    const items = itemsRef.current;
    let ref: TextItemInfo | undefined;
    if (items.length) {
      const row = items.filter((it) => Math.abs(it.y - y) <= Math.max(it.size, 4) * 1.2);
      const pool = row.length ? row : items;
      ref = pool.reduce((a, b) => (Math.hypot(b.x - x, (b.y - y) * 3) < Math.hypot(a.x - x, (a.y - y) * 3) ? b : a));
    }
    if (ref && Math.abs(ref.y - y) <= Math.max(ref.size, 4) * 1.2) y = ref.y; // snap to row baseline
    else y -= (ref?.size ?? 14) * 0.35;
    const size = ref?.size ?? 14;
    p.onCreateEdit({
      id: `new-${Date.now()}`, page: p.pageIndex, kind: "text", text: inherit ? "" : "New text",
      style: { size, color: ref?.color ?? "#111111", bold: !!ref?.bold, italic: !!ref?.italic, family: ref?.family ?? "sans", align: "left" },
      bg: "#ffffff", x, y, angle: 0, width: 0, isNew: true,
    });
  };

  // ---- marquee: drag to select several text runs, or to erase an area ----
  const dragging = useRef(false);
  const startPt = useRef<{ x: number; y: number } | null>(null);

  const onPointerDown = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (p.mode !== "select" && p.mode !== "erase") return;
    if (ev.button !== 0 && ev.pointerType === "mouse") return;
    const r = ev.currentTarget.getBoundingClientRect();
    startPt.current = { x: ev.clientX - r.left, y: ev.clientY - r.top };
    dragging.current = true;
    ev.currentTarget.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  };

  const onPointerMove = (ev: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !startPt.current) return;
    const r = ev.currentTarget.getBoundingClientRect();
    setMarquee({ x0: startPt.current.x, y0: startPt.current.y, x1: ev.clientX - r.left, y1: ev.clientY - r.top });
  };

  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    const m = marquee;
    startPt.current = null;
    setMarquee(null);
    if (!m || !vt) return;
    const left = Math.min(m.x0, m.x1), top = Math.min(m.y0, m.y1);
    const width = Math.abs(m.x1 - m.x0), height = Math.abs(m.y1 - m.y0);
    if (width < 6 || height < 6) return;

    if (p.mode === "erase") {
      const inv = invert(vt);
      const [ax, ay] = apply(inv, left, top);
      const [bx, by] = apply(inv, left + width, top + height);
      const bg = canvasRef.current ? sampleRectBg(canvasRef.current, dprRef.current, { left, top, width, height }) : "#ffffff";
      p.onCreateEdit({
        id: `erase-${Date.now()}`, page: p.pageIndex, kind: "erase", text: "",
        style: { size: 12, color: "#000000", bold: false, italic: false, family: "sans", align: "left" },
        bg, x: Math.min(ax, bx), y: Math.min(ay, by), angle: 0, width: 0,
        rectW: Math.abs(bx - ax), rectH: Math.abs(by - ay), isNew: true,
      });
      return;
    }

    const picked = p.items.filter((it) => {
      if (hiddenIds.has(it.id)) return false;
      const b = screenBox(vt, it);
      const r2 = { l: b.left, t: b.top, r: b.left + Math.max(b.width, 4), b: b.top + b.height };
      return r2.l < left + width && r2.r > left && r2.t < top + height && r2.b > top;
    });
    if (picked.length) editFromItems(picked);
  };

  const clickBlank = (ev: React.MouseEvent<HTMLDivElement>) => {
    if (ev.target !== ev.currentTarget) return;
    if (p.mode === "add" && vt) { addTextAt(ev.clientX, ev.clientY); return; }
    if (p.mode === "edit" && vt) {
      if (p.selectedId) { p.onSelect(null); return; }
      primeKeyboard();
      addTextAt(ev.clientX, ev.clientY, true);
    }
  };

  const w = p.baseSize.w * p.scale, h = p.baseSize.h * p.scale;
  const cursor = p.mode === "add" ? "cursor-crosshair" : p.mode === "select" || p.mode === "erase" ? "cursor-crosshair touch-none" : "";
  return (
    <div
      ref={wrapRef}
      data-page={p.pageIndex}
      className="relative mx-auto bg-card shadow-md ring-1 ring-border"
      style={{ width: w, height: h }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" style={{ width: w, height: h }} />
      {!vt && <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">Loading page {p.pageIndex + 1}…</div>}
      <div
        ref={overlayRef}
        className={`absolute inset-0 ${cursor}`}
        onClick={clickBlank}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {vt && p.mode !== "erase" && p.items.filter((it) => !hiddenIds.has(it.id)).map((it) => {
          const b = screenBox(vt, it);
          return (
            <button
              key={it.id}
              type="button"
              aria-label={`Edit text: ${it.str}`}
              title={it.str}
              onClick={(e) => {
                e.stopPropagation();
                if (p.mode !== "edit") return;
                pendingCaret = { x: e.clientX, y: e.clientY };
                primeKeyboard();
                editFromItems([it]);
              }}
              className={`absolute rounded-[2px] hover:bg-primary/10 hover:outline hover:outline-1 hover:outline-primary ${p.mode === "select" ? "pointer-events-none" : "cursor-text"} ${it.source === "ocr" ? "outline outline-1 outline-dashed outline-primary/40" : ""}`}
              style={{
                left: b.left, top: b.top, width: Math.max(b.width, 4), height: b.height,
                transform: `rotate(${b.angle}rad)`, transformOrigin: `0 ${b.ascent}px`,
              }}
            />
          );
        })}
        {vt && pageEdits.map((e) => (
          <EditBox key={e.id} e={e} vt={vt} selected={p.selectedId === e.id} onSelect={p.onSelect} onCommit={p.onCommitText} onTab={p.onTab ?? (() => {})} />
        ))}
        {marquee && (
          <div
            className="pointer-events-none absolute border-2 border-primary bg-primary/15"
            style={{
              left: Math.min(marquee.x0, marquee.x1), top: Math.min(marquee.y0, marquee.y1),
              width: Math.abs(marquee.x1 - marquee.x0), height: Math.abs(marquee.y1 - marquee.y0),
            }}
          />
        )}
      </div>
    </div>
  );
}

function EditBox({ e, vt, selected, onSelect, onCommit, onTab }: {
  e: Edit; vt: Mat; selected: boolean; onSelect: (id: string) => void; onCommit: (id: string, t: string) => void;
  onTab?: (id: string, back: boolean) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const covers = e.kind === "erase" ? [] : (e.covers ?? (e.original ? [{ x: e.x, y: e.y, size: e.original.size, angle: e.angle, width: e.width }] : []));
  const b = screenBox(vt, { x: e.x, y: e.y, size: e.style.size, angle: e.angle, width: e.width });

  useEffect(() => {
    if (selected && ref.current) {
      const el = ref.current;
      el.innerText = e.text;
      el.focus({ preventScroll: true });
      const sel = window.getSelection();
      let range: Range | null = null;
      const pt = pendingCaret;
      setTimeout(() => { pendingCaret = null; }, 0);
      const place = () => {
        range = null;
        const tn = el.firstChild;
        if (pt && tn && tn.nodeType === Node.TEXT_NODE) {
          // pick the character boundary nearest to the tap
          const len = tn.textContent?.length ?? 0;
          const probe = document.createRange();
          let best = len, bestD = Infinity;
          for (let i = 0; i <= len; i++) {
            probe.setStart(tn, i); probe.setEnd(tn, i);
            const r = probe.getClientRects()[0] ?? probe.getBoundingClientRect();
            const dist = Math.abs(r.left - pt.x) + (pt.y < r.top || pt.y > r.bottom ? 1000 : 0);
            if (dist < bestD) { bestD = dist; best = i; }
          }
          range = document.createRange(); range.setStart(tn, best);
        }
        if (!range) { range = document.createRange(); range.selectNodeContents(el); range.collapse(false); }
        range.collapse(true);
        sel?.removeAllRanges();
        sel?.addRange(range);
      };
      place();
      requestAnimationFrame(() => { if (document.activeElement === el) place(); });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEffect(() => {
    if (selected && ref.current && document.activeElement !== ref.current) ref.current.innerText = e.text;
  }, [e.text, selected]);

  if (e.kind === "erase") {
    const [sx, sy] = apply(vt, e.x, e.y + (e.rectH ?? 0));
    const [ex, ey] = apply(vt, e.x + (e.rectW ?? 0), e.y);
    return (
      <div
        className={`absolute ${selected ? "outline outline-2 outline-primary" : "hover:outline hover:outline-1 hover:outline-primary"}`}
        style={{ left: sx, top: sy, width: ex - sx, height: ey - sy, background: e.bg }}
        onClick={(ev) => { ev.stopPropagation(); onSelect(e.id); }}
      />
    );
  }

  const align = e.style.align;
  const textStyle: React.CSSProperties = {
    fontFamily: CSS_FONT[e.style.family],
    fontSize: b.fontH,
    lineHeight: `${b.height}px`,
    fontWeight: e.style.weight ?? (e.style.bold ? 700 : 400),
    opacity: e.style.opacity ?? 1,
    filter: e.style.blur ? `blur(${e.style.blur * (b.fontH / Math.max(e.style.size, 0.1)) * 0.75}px)` : undefined,
    letterSpacing: e.style.letterSpacing ? `${e.style.letterSpacing * (b.fontH / Math.max(e.style.size, 0.1))}px` : undefined,
    fontStyle: e.style.italic ? "italic" : "normal",
    color: e.style.color,
    whiteSpace: "pre",
    display: "block",
    minWidth: e.width ? b.width : 20,
    textAlign: align,
    outline: "none",
  };
  return (
    <>
      {covers.map((cv, i) => {
        const cb = screenBox(vt, cv);
        return (
          <div
            key={i}
            className="pointer-events-none absolute"
            style={{
              left: cb.left - cb.fontH * 0.06, top: cb.top, width: cb.width + cb.fontH * 0.12, height: cb.height,
              background: e.bg, transform: `rotate(${cb.angle}rad)`, transformOrigin: `${cb.fontH * 0.06}px ${cb.ascent}px`,
            }}
          />
        );
      })}
      <div
        className={`absolute ${selected ? "z-10 outline outline-2 outline-primary" : "cursor-text hover:outline hover:outline-1 hover:outline-primary"}`}
        style={{
          left: align === "left" || !e.width ? b.left : undefined,
          top: b.top,
          ...(e.width && align !== "left" ? { left: b.left, width: b.width } : {}),
          transform: `rotate(${b.angle}rad)`, transformOrigin: `0 ${b.ascent}px`,
        }}
        onClick={(ev) => { ev.stopPropagation(); if (!selected) onSelect(e.id); }}
      >
        {selected ? (
          <span
            ref={ref}
            contentEditable
            suppressContentEditableWarning
            spellCheck={false}
            style={textStyle}
            onBlur={(ev) => onCommit(e.id, ev.currentTarget.innerText.replace(/\n/g, " "))}
            onKeyDown={(ev) => {
              if (ev.key === "Enter" || ev.key === "Escape") { ev.preventDefault(); ev.currentTarget.blur(); }
              if (ev.key === "Tab") {
                ev.preventDefault();
                onCommit(e.id, ev.currentTarget.innerText.replace(/\n/g, " "));
                onTab?.(e.id, ev.shiftKey);
              }
            }}
          />
        ) : (
          <span style={textStyle}>{e.text}</span>
        )}
      </div>
    </>
  );
}

export function Thumb({ pdf, pageIndex, active, onClick }: { pdf: PDFDocumentProxy; pageIndex: number; active: boolean; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const io = new IntersectionObserver(([e]) => e.isIntersecting && setNear(true), { rootMargin: "400px" });
    if (btn.current) io.observe(btn.current);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!near) return;
    let task: RenderTask | null = null;
    (async () => {
      const page = await pdf.getPage(pageIndex + 1);
      const vp = page.getViewport({ scale: 120 / page.getViewport({ scale: 1 }).width });
      const c = ref.current;
      if (!c) return;
      c.width = vp.width; c.height = vp.height;
      task = page.render({ canvasContext: c.getContext("2d")!, viewport: vp });
      await task.promise.catch(() => {});
    })();
    return () => task?.cancel();
  }, [near, pdf, pageIndex]);
  return (
    <button ref={btn} onClick={onClick} className={`block w-full rounded p-1.5 text-center ${active ? "bg-primary/15 ring-2 ring-primary" : "hover:bg-accent"}`}>
      <canvas ref={ref} className="mx-auto w-[120px] bg-card shadow-sm ring-1 ring-border" style={{ minHeight: 60 }} />
      <span className="mt-1 block text-xs text-muted-foreground">{pageIndex + 1}</span>
    </button>
  );
}
