import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";
import { apply, invert, screenBox, type Mat } from "@/lib/pdf/geometry";
import { refineFonts } from "@/lib/pdf/pdfjs";
import { sampleColors } from "@/lib/pdf/colors";
import type { Edit, Edits, TextItemInfo } from "@/lib/pdf/types";

export const CSS_FONT = {
  sans: "Helvetica, Arial, 'Liberation Sans', sans-serif",
  serif: "'Times New Roman', Times, 'Liberation Serif', serif",
  mono: "'Courier New', Courier, 'Liberation Mono', monospace",
} as const;

interface Props {
  pdf: PDFDocumentProxy;
  pageIndex: number;
  scale: number;
  baseSize: { w: number; h: number };
  items: TextItemInfo[];
  edits: Edits;
  selectedId: string | null;
  mode: "edit" | "add";
  onCreateEdit: (edit: Edit) => void;
  onSelect: (id: string | null) => void;
  onCommitText: (id: string, text: string) => void;
  onItemsRefined: (page: number, items: TextItemInfo[]) => void;
  onVisible: (page: number) => void;
  registerEl: (page: number, el: HTMLDivElement | null) => void;
}

export function PageView(p: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);
  const [vt, setVt] = useState<Mat | null>(null);
  const refinedRef = useRef(false);
  const dprRef = useRef(1);

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
      task = page.render({ canvasContext: ctx, canvas, viewport: vp, transform: [dpr, 0, 0, dpr, 0, 0] });
      try { await task.promise; } catch { return; }
      if (cancelled) return;
      setVt(vp.transform);
      if (!refinedRef.current) {
        refinedRef.current = true;
        p.onItemsRefined(p.pageIndex, refineFonts(page, p.items));
      }
    })();
    return () => { cancelled = true; task?.cancel(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, p.scale, p.pdf, p.pageIndex]);

  const pageEdits = Object.values(p.edits).filter((e) => e.page === p.pageIndex);
  const editedIds = new Set(pageEdits.map((e) => e.id));

  const clickItem = (it: TextItemInfo) => {
    if (!vt || !canvasRef.current) return;
    const { color, bg } = sampleColors(canvasRef.current, dprRef.current, vt, it);
    p.onCreateEdit({
      id: it.id, page: it.page, text: it.str,
      style: { size: it.size, color, bold: it.bold, italic: it.italic, family: it.family, align: "left" },
      bg, x: it.x, y: it.y, angle: it.angle, width: it.width, original: it, isNew: false, pristine: true,
    });
  };

  const clickBlank = (ev: React.MouseEvent<HTMLDivElement>) => {
    if (ev.target !== ev.currentTarget) return;
    if (p.mode !== "add" || !vt) { p.onSelect(null); return; }
    const r = ev.currentTarget.getBoundingClientRect();
    const [x, y] = apply(invert(vt), ev.clientX - r.left, ev.clientY - r.top);
    p.onCreateEdit({
      id: `new-${Date.now()}`, page: p.pageIndex, text: "New text",
      style: { size: 14, color: "#111111", bold: false, italic: false, family: "sans", align: "left" },
      bg: "#ffffff", x, y, angle: 0, width: 0, isNew: true,
    });
  };

  const w = p.baseSize.w * p.scale, h = p.baseSize.h * p.scale;
  return (
    <div
      ref={wrapRef}
      data-page={p.pageIndex}
      className="relative mx-auto bg-card shadow-md ring-1 ring-border"
      style={{ width: w, height: h }}
    >
      <canvas ref={canvasRef} className="absolute inset-0" style={{ width: w, height: h }} />
      {!vt && <div className="absolute inset-0 grid place-items-center text-sm text-muted-foreground">Loading page {p.pageIndex + 1}…</div>}
      <div className={`absolute inset-0 ${p.mode === "add" ? "cursor-crosshair" : ""}`} onClick={clickBlank}>
        {vt && p.items.filter((it) => !editedIds.has(it.id)).map((it) => {
          const b = screenBox(vt, it);
          return (
            <button
              key={it.id}
              type="button"
              aria-label={`Edit text: ${it.str}`}
              title={it.str}
              onClick={(e) => { e.stopPropagation(); clickItem(it); }}
              className={`absolute cursor-text rounded-[2px] hover:bg-primary/10 hover:outline hover:outline-1 hover:outline-primary ${it.source === "ocr" ? "outline outline-1 outline-dashed outline-primary/40" : ""}`}
              style={{
                left: b.left, top: b.top, width: Math.max(b.width, 4), height: b.height,
                transform: `rotate(${b.angle}rad)`, transformOrigin: `0 ${b.ascent}px`,
              }}
            />
          );
        })}
        {vt && pageEdits.map((e) => (
          <EditBox key={e.id} e={e} vt={vt} selected={p.selectedId === e.id} onSelect={p.onSelect} onCommit={p.onCommitText} />
        ))}
      </div>
    </div>
  );
}

function EditBox({ e, vt, selected, onSelect, onCommit }: {
  e: Edit; vt: Mat; selected: boolean; onSelect: (id: string) => void; onCommit: (id: string, t: string) => void;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const cover = e.original ? screenBox(vt, e.original) : null;
  const b = screenBox(vt, { x: e.x, y: e.y, size: e.style.size, angle: e.angle, width: e.width });

  useEffect(() => {
    if (selected && ref.current) {
      ref.current.innerText = e.text;
      ref.current.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(ref.current);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  useEffect(() => {
    if (selected && ref.current && document.activeElement !== ref.current) ref.current.innerText = e.text;
  }, [e.text, selected]);

  const align = e.style.align;
  const textStyle: React.CSSProperties = {
    fontFamily: CSS_FONT[e.style.family],
    fontSize: b.fontH,
    lineHeight: `${b.height}px`,
    fontWeight: e.style.bold ? 700 : 400,
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
      {cover && (
        <div
          className="pointer-events-none absolute"
          style={{
            left: cover.left - cover.fontH * 0.06, top: cover.top, width: cover.width + cover.fontH * 0.12, height: cover.height,
            background: e.bg, transform: `rotate(${cover.angle}rad)`, transformOrigin: `${cover.fontH * 0.06}px ${cover.ascent}px`,
          }}
        />
      )}
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
      task = page.render({ canvasContext: c.getContext("2d")!, canvas: c, viewport: vp });
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
