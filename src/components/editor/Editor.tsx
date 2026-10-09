import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
  Download, FilePlus2, Minus, Plus, Redo2, Replace, ScanText, Trash2, Type, Undo2, Upload, MousePointer2, X, Bold, Italic,
} from "lucide-react";
import { extractPageItems, loadPdf, MAX_BYTES } from "@/lib/pdf/pdfjs";
import { exportPdf, downloadBytes } from "@/lib/pdf/export";
import { samplePageItems } from "@/lib/pdf/colors";
import { isLikelyScanned, ocrPage } from "@/lib/ocr/ocr";
import type { Edit, Edits, TextItemInfo, TextStyle } from "@/lib/pdf/types";
import { PageView, Thumb, type Mode, type PageApi } from "./PageView";
import { PreviewDialog } from "./Preview";
import { clearSession, loadSession, saveSession, type Session } from "@/lib/persist";
import { BoxSelect, Eraser, RotateCcw, Sparkles, Settings2 } from "lucide-react";
import { aiMatch, loadKeys, saveKeys, type AiKeys } from "@/lib/ai/match";

type Patch = Omit<Partial<Edit>, "style"> & { style?: Partial<TextStyle> };
type H = { past: Edits[]; present: Edits; future: Edits[] };
type A = { type: "apply"; edits: Edits; record: boolean } | { type: "undo" } | { type: "redo" } | { type: "reset" };
function hist(s: H, a: A): H {
  switch (a.type) {
    case "apply":
      return a.record ? { past: [...s.past.slice(-99), s.present], present: a.edits, future: [] } : { ...s, present: a.edits };
    case "undo":
      return s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s;
    case "redo":
      return s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s;
    case "reset":
      return { past: [], present: {}, future: [] };
  }
}
const stripPristine = (e: Edits) => Object.fromEntries(Object.entries(e).filter(([, v]) => !v.pristine));

export function Editor() {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState("document.pdf");
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<{ w: number; h: number }[]>([]);
  const [items, setItems] = useState<Record<number, TextItemInfo[]>>({});
  const [scale, setScale] = useState(1.25);
  const [mode, setMode] = useState<Mode>("edit");
  const [preview, setPreview] = useState<Uint8Array | null>(null);
  const pageApis = useRef<Record<number, PageApi | null>>({});
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const [h, dispatch] = useReducer(hist, { past: [], present: {}, future: [] });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scanned, setScanned] = useState(false);
  const [findOpen, setFindOpen] = useState(false);
  const pageEls = useRef<Record<number, HTMLDivElement | null>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const edits = h.present;
  const editsRef = useRef(edits);
  editsRef.current = edits;
  const selectedIdRef = useRef(selectedId);
  selectedIdRef.current = selectedId;
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  useEffect(() => () => { void pdf?.loadingTask.destroy(); }, [pdf]);

  // Restore the last session after a refresh / tab close.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    void loadSession().then((s) => {
      if (s?.bytes) void openBytes(new Uint8Array(s.bytes), s.fileName, s);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-save edits (debounced) so no work is lost.
  useEffect(() => {
    if (!bytes) return;
    const t = setTimeout(() => {
      void saveSession({
        bytes: bytes.slice().buffer as ArrayBuffer, fileName, edits: stripPristine(edits), scale, currentPage, savedAt: Date.now(),
      });
    }, 600);
    return () => clearTimeout(t);
  }, [bytes, fileName, edits, scale, currentPage]);

  const openFile = async (file: File) => {
    setError(null);
    if (file.size > MAX_BYTES) return setError("File is larger than 100 MB.");
    await openBytes(new Uint8Array(await file.arrayBuffer()), file.name);
  };

  const startFresh = async () => {
    await clearSession();
    void pdf?.loadingTask.destroy();
    setPdf(null); setBytes(null); setItems({}); setSizes([]); dispatch({ type: "reset" }); setSelectedId(null);
  };

  const openBytes = async (buf: Uint8Array, name: string, resume?: Session) => {
    setError(null);
    setBusy(resume ? "Restoring your last session…" : "Opening PDF…");
    try {
      const doc = await loadPdf(buf);
      const sz: { w: number; h: number }[] = [];
      for (let i = 0; i < doc.numPages; i++) {
        const vp = (await doc.getPage(i + 1)).getViewport({ scale: 1 });
        sz.push({ w: vp.width, h: vp.height });
      }
      setBytes(buf); setFileName(name); setSizes(sz); setItems({}); setPdf(doc);
      dispatch({ type: "reset" }); setSelectedId(null); setCurrentPage(0); setScanned(false);
      if (resume) {
        dispatch({ type: "apply", edits: resume.edits ?? {}, record: false });
        setScale(resume.scale || 1.25);
        const pg = resume.currentPage || 0;
        setTimeout(() => pageEls.current[pg]?.scrollIntoView({ block: "start" }), 300);
      }
      setBusy("Reading text…");
      const all: Record<number, TextItemInfo[]> = {};
      for (let i = 0; i < doc.numPages; i++) {
        all[i] = await extractPageItems(doc, i).catch(() => []);
        if (i % 5 === 4 || i === doc.numPages - 1) {
          setItems((prev) => {
            const next = { ...prev };
            // merge, so pages already refined after rendering are not reset
            for (const [k, v] of Object.entries(all)) {
              const n = Number(k);
              if ((prev[n]?.length ?? 0) !== v.length) next[n] = v;
            }
            return next;
          });
        }
      }
      setScanned(isLikelyScanned(all, doc.numPages));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const select = useCallback((id: string | null) => {
    const cur = editsRef.current;
    const pristineIds = Object.keys(cur).filter((k) => cur[k].pristine && k !== id);
    if (pristineIds.length) {
      const next = { ...cur };
      pristineIds.forEach((k) => delete next[k]);
      dispatch({ type: "apply", edits: next, record: false });
    }
    setSelectedId(id);
  }, []);

  const createEdit = useCallback((e: Edit) => {
    const cur = { ...editsRef.current };
    Object.keys(cur).forEach((k) => cur[k].pristine && delete cur[k]);
    cur[e.id] = e;
    dispatch({ type: "apply", edits: cur, record: !e.pristine });
    setSelectedId(e.id);
    if (e.isNew && e.kind !== "erase") setMode("edit");
  }, []);

  const updateEdit = useCallback((id: string, patch: Patch) => {
    const cur = editsRef.current[id];
    if (!cur) return;
    const next: Edit = { ...cur, ...patch, style: { ...cur.style, ...(patch.style ?? {}) }, pristine: false };
    dispatch({ type: "apply", edits: { ...stripPristine(editsRef.current), [id]: next }, record: true });
  }, []);

  const commitText = useCallback((id: string, text: string) => {
    const cur = editsRef.current[id];
    if (!cur || cur.text === text) return;
    updateEdit(id, { text });
  }, [updateEdit]);

  const removeEdit = (id: string) => {
    const next = { ...editsRef.current };
    delete next[id];
    dispatch({ type: "apply", edits: stripPristine(next), record: true });
    setSelectedId(null);
  };

  const onRefined = useCallback((page: number, refined: TextItemInfo[]) => {
    setItems((prev) => {
      const existing = prev[page] ?? [];
      // never let an empty or partial refine wipe already-extracted text
      if (refined.length === 0 || refined.length < existing.length) return prev;
      return { ...prev, [page]: refined };
    });
  }, []);

  const goTo = (i: number) => pageEls.current[i]?.scrollIntoView({ behavior: "smooth", block: "start" });

  const onTab = useCallback((id: string, back: boolean) => {
    const cur = editsRef.current[id];
    if (!cur) return;
    const list = [...(itemsRef.current[cur.page] ?? [])]
      .filter((it) => !editsRef.current[it.id])
      .sort((a, b) => (Math.abs(a.y - b.y) > 1.2 ? b.y - a.y : a.x - b.x));
    const after = (it: TextItemInfo) => (Math.abs(it.y - cur.y) > 1.2 ? it.y < cur.y : it.x > cur.x);
    const next = back ? [...list].reverse().find((it) => !after(it)) : list.find(after);
    if (next) setTimeout(() => pageApis.current[cur.page]?.selectItem(next.id), 0);
  }, []);

  const download = async () => {
    if (!bytes) return;
    select(null);
    setBusy("Building preview…"); setError(null);
    try {
      const out = await exportPdf(bytes, stripPristine(editsRef.current));
      setPreview(out);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  const runOcr = async () => {
    if (!pdf) return;
    setBusy("OCR: loading engine…");
    try {
      const res = await ocrPage(pdf, currentPage, (p) => setBusy(`OCR page ${currentPage + 1}: ${Math.round(p * 100)}%`));
      setItems((prev) => ({ ...prev, [currentPage]: [...(prev[currentPage] ?? []).filter((i) => i.source !== "ocr"), ...res] }));
      if (!res.length) setError("OCR found no text on this page.");
    } catch (e) {
      setError("OCR failed: " + (e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      // Alt + Arrow nudges the selected text 1px (Shift = 5px), even while typing in it.
      const sid = selectedIdRef.current;
      if (e.altKey && sid && e.key.startsWith("Arrow")) {
        const cur = editsRef.current[sid];
        if (cur) {
          e.preventDefault();
          const step = (e.shiftKey ? 5 : 1) / scaleRef.current;
          const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
          const dy = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
          updateEdit(sid, { x: cur.x + dx, y: cur.y + dy });
        }
        return;
      }
      if (t.isContentEditable || /INPUT|TEXTAREA|SELECT/.test(t.tagName)) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); select(null); dispatch({ type: e.shiftKey ? "redo" : "undo" }); }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { e.preventDefault(); select(null); dispatch({ type: "redo" }); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select, updateEdit]);

  const selected = selectedId ? edits[selectedId] : null;
  const [aiOpen, setAiOpen] = useState(false);
  useEffect(() => {
    const f = () => setAiOpen(true);
    window.addEventListener("open-ai-settings", f);
    return () => window.removeEventListener("open-ai-settings", f);
  }, []);
  const [aiMsg, setAiMsg] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const runAi = async (e: Edit) => {
    if (!pdf) return;
    const keys = loadKeys();
    if (!keys.groq && !keys.gemini) { setAiOpen(true); return; }
    setAiBusy(true); setAiMsg("AI original text se match kar raha hai…");
    try {
      const r = await aiMatch(pdf, e, keys);
      updateEdit(e.id, { style: r.style, ...(r.bg ? { bg: r.bg } : {}) });
      setAiMsg("✓ Matched" + (r.note ? `: ${r.note}` : ""));
    } catch (err) { setAiMsg(err instanceof Error ? err.message : "AI match failed"); }
    finally { setAiBusy(false); }
  };
  const changeCount = Object.values(edits).filter((e) => !e.pristine).length;

  return (
    <div className="flex h-dvh flex-col bg-muted text-foreground">
      <header className="flex flex-wrap items-center gap-1 border-b border-border bg-card px-2 py-1.5 sm:gap-2 sm:px-3">
        <div className="mr-2 flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded bg-primary text-xs text-primary-foreground">DE</span>
          <span className="hidden sm:inline">DocEdit AI</span>
        </div>
        <input ref={fileInput} type="file" accept="application/pdf,.pdf" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void openFile(f); e.target.value = ""; }} />
        <TB onClick={() => fileInput.current?.click()} label="Open PDF"><Upload className="h-4 w-4" /></TB>
        <TB onClick={() => setAiOpen(true)} label="AI settings (Groq / Gemini keys)"><Settings2 className="h-4 w-4" /></TB>
        {pdf && <TB onClick={() => { if (window.confirm("Close this document and discard saved edits?")) void startFresh(); }} label="Start fresh (close document)"><RotateCcw className="h-4 w-4" /></TB>}
        {pdf && (
          <>
            <Sep />
            <TB onClick={() => setScale((s) => Math.max(0.5, +(s - 0.25).toFixed(2)))} label="Zoom out"><Minus className="h-4 w-4" /></TB>
            <span className="w-12 text-center text-xs tabular-nums">{Math.round(scale * 100)}%</span>
            <TB onClick={() => setScale((s) => Math.min(4, +(s + 0.25).toFixed(2)))} label="Zoom in"><Plus className="h-4 w-4" /></TB>
            <Sep />
            <TB active={mode === "edit"} onClick={() => setMode("edit")} label="Edit text"><MousePointer2 className="h-4 w-4" /></TB>
            <TB active={mode === "add"} onClick={() => { select(null); setMode("add"); }} label="Add text"><FilePlus2 className="h-4 w-4" /></TB>
            <TB active={mode === "select"} onClick={() => { select(null); setMode("select"); }} label="Drag to select multiple words"><BoxSelect className="h-4 w-4" /></TB>
            <TB active={mode === "erase"} onClick={() => { select(null); setMode("erase"); }} label="Eraser (drag over an area)"><Eraser className="h-4 w-4" /></TB>
            <Sep />
            <TB disabled={!h.past.length} onClick={() => { select(null); dispatch({ type: "undo" }); }} label="Undo"><Undo2 className="h-4 w-4" /></TB>
            <TB disabled={!h.future.length} onClick={() => { select(null); dispatch({ type: "redo" }); }} label="Redo"><Redo2 className="h-4 w-4" /></TB>
            <TB onClick={() => setFindOpen((v) => !v)} active={findOpen} label="Find & Replace"><Replace className="h-4 w-4" /></TB>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden text-xs text-muted-foreground md:inline">{changeCount} change{changeCount === 1 ? "" : "s"}</span>
              <button onClick={download} disabled={!!busy}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                <Download className="h-4 w-4" /> <span className="hidden sm:inline">Download</span>
              </button>
            </div>
          </>
        )}
      </header>
      {pdf && selected && selected.kind !== "erase" && (
        <FormatBar e={selected} onChange={(patch) => updateEdit(selected.id, patch)} onRemove={() => removeEdit(selected.id)} onClose={() => select(null)} onAi={() => void runAi(selected)} aiBusy={aiBusy} />
      )}
      {aiMsg && (
        <div className="flex items-center gap-2 border-b border-border bg-accent px-3 py-1 text-xs text-accent-foreground">
          <span className="flex-1">{aiMsg}</span><button onClick={() => setAiMsg(null)} aria-label="Dismiss"><X className="h-3.5 w-3.5" /></button>
        </div>
      )}
      {aiOpen && <AiSettings onClose={() => setAiOpen(false)} />}
      {pdf && selected && selected.kind === "erase" && (
        <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-1.5 text-sm">
          <span className="flex-1 text-muted-foreground">Erased area</span>
          <button onClick={() => removeEdit(selected.id)} className="inline-flex items-center gap-1 rounded-md border border-destructive/40 px-2 py-1 text-xs text-destructive"><Trash2 className="h-3.5 w-3.5" /> Remove</button>
          <button onClick={() => select(null)} aria-label="Done"><X className="h-4 w-4" /></button>
        </div>
      )}

      {(busy || error) && (
        <div className={`flex items-center gap-2 px-3 py-1.5 text-sm ${error ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-foreground"}`}>
          <span className="flex-1">{error ?? busy}</span>
          {error && <button onClick={() => setError(null)} aria-label="Dismiss"><X className="h-4 w-4" /></button>}
        </div>
      )}
      {pdf && scanned && (
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-accent px-3 py-1.5 text-sm">
          <ScanText className="h-4 w-4" />
          <span className="flex-1">This looks like a scanned PDF with no editable text. Run OCR (on your device) to make text editable.</span>
          <button onClick={runOcr} disabled={!!busy} className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium disabled:opacity-50">
            OCR page {currentPage + 1}
          </button>
        </div>
      )}

      {preview && pdf && (
        <PreviewDialog original={pdf} bytes={preview}
          pages={[...new Set(Object.values(stripPristine(edits)).map((e) => e.page))].sort((a, b) => a - b)}
          onClose={() => setPreview(null)}
          onConfirm={() => { downloadBytes(preview, fileName.replace(/\.pdf$/i, "") + "-edited.pdf"); setPreview(null); }} />
      )}
      {!pdf ? (
        <Landing onFile={openFile} onPick={() => fileInput.current?.click()} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <aside className="hidden w-40 shrink-0 space-y-1 overflow-y-auto border-r border-border bg-card p-2 md:block">
            {sizes.map((_, i) => <Thumb key={i} pdf={pdf} pageIndex={i} active={i === currentPage} onClick={() => goTo(i)} />)}
          </aside>
          <main className="min-w-0 flex-1 overflow-auto p-3 sm:p-6">
            <div className="flex w-max min-w-full flex-col items-center gap-6">
              {sizes.map((s, i) => (
                <PageView key={i} pdf={pdf} pageIndex={i} scale={scale} baseSize={s} items={items[i] ?? []} edits={edits}
                  selectedId={selectedId} mode={mode} onCreateEdit={createEdit} onSelect={select} onCommitText={commitText}
                  onItemsRefined={onRefined} onVisible={setCurrentPage} onTab={onTab}
                  registerEl={(p, el) => (pageEls.current[p] = el)} registerApi={(p, api) => (pageApis.current[p] = api)} />
              ))}
            </div>
          </main>
          {findOpen && (
            <aside className="fixed inset-x-0 bottom-0 z-30 max-h-[55dvh] overflow-y-auto border-t border-border bg-card p-3 shadow-lg md:static md:max-h-none md:w-72 md:border-l md:border-t-0 md:shadow-none">
              <FindReplace pdf={pdf} items={items} edits={edits} onApply={(next) => { select(null); dispatch({ type: "apply", edits: next, record: true }); }}
                onJump={goTo} onClose={() => setFindOpen(false)} setBusy={setBusy} />
            </aside>
          )}
        </div>
      )}
    </div>
  );
}

function TB({ children, label, onClick, disabled, active }: { children: React.ReactNode; label: string; onClick: () => void; disabled?: boolean; active?: boolean }) {
  return (
    <button type="button" title={label} aria-label={label} onClick={onClick} disabled={disabled}
      className={`grid h-8 w-8 place-items-center rounded-md disabled:opacity-40 ${active ? "bg-primary/15 text-primary" : "hover:bg-accent"}`}>
      {children}
    </button>
  );
}
const Sep = () => <span className="mx-0.5 hidden h-5 w-px bg-border sm:block" />;

function Landing({ onFile, onPick }: { onFile: (f: File) => void; onPick: () => void }) {
  const [over, setOver] = useState(false);
  return (
    <div className="grid flex-1 place-items-center p-6"
      onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}>
      <div className={`w-full max-w-lg rounded-xl border-2 border-dashed bg-card p-10 text-center ${over ? "border-primary" : "border-border"}`}>
        <Type className="mx-auto h-10 w-10 text-primary" />
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Edit the text inside any PDF</h1>
        <p className="mt-2 text-sm text-muted-foreground">Open a PDF, tap any text, change it, and download. Your file stays on your device — nothing is uploaded.</p>
        <button onClick={onPick} className="mt-6 inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          <Upload className="h-4 w-4" /> Choose PDF
        </button>
        <p className="mt-3 text-xs text-muted-foreground">or drag & drop it here</p>
        <button type="button" onClick={() => window.dispatchEvent(new Event("open-ai-settings"))}
          className="mt-4 inline-flex items-center gap-2 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent">
          <Settings2 className="h-4 w-4" /> AI keys paste karein (Groq / Gemini)
        </button>
      </div>
    </div>
  );
}

function AiSettings({ onClose }: { onClose: () => void }) {
  const [k, setK] = useState<AiKeys>(() => loadKeys());
  const inp = "h-9 w-full rounded-md border border-input bg-background px-2 text-sm";
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/40 p-4" onClick={onClose}>
      <form className="w-full max-w-md space-y-3 rounded-lg bg-card p-4 shadow-lg" onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); saveKeys({ groq: k.groq?.trim() || undefined, gemini: k.gemini?.trim() || undefined, provider: k.provider }); onClose(); }}>
        <h2 className="text-base font-semibold">AI Match settings</h2>
        <p className="text-xs text-muted-foreground">Keys sirf isi browser me save hoti hain. AI Match dabane par sirf us text ka chhota crop AI ko bheja jata hai.</p>
        <label className="block text-sm">GroqCloud key (gsk_…)
          <input className={inp} type="password" placeholder="gsk_..." value={k.groq ?? ""} onChange={(e) => setK({ ...k, groq: e.target.value })} /></label>
        <label className="block text-sm">Google Gemini key (AIza…)
          <input className={inp} type="password" placeholder="AIza..." value={k.gemini ?? ""} onChange={(e) => setK({ ...k, gemini: e.target.value })} /></label>
        <label className="block text-sm">Pehle kaun try kare
          <select className={inp} value={k.provider ?? "groq"} onChange={(e) => setK({ ...k, provider: e.target.value as AiKeys["provider"] })}>
            <option value="groq">GroqCloud (fast)</option><option value="gemini">Gemini</option>
          </select></label>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="rounded-md border border-input px-3 py-1.5 text-sm">Cancel</button>
          <button type="submit" className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground">Submit</button>
        </div>
      </form>
    </div>
  );
}

function FormatBar({ e, onChange, onRemove, onClose, onAi, aiBusy }: { e: Edit; onChange: (p: Patch) => void; onRemove: () => void; onClose: () => void; onAi: () => void; aiBusy: boolean }) {
  // keep the caret inside the text while pressing toggle buttons
  const keep = (ev: React.MouseEvent) => ev.preventDefault();
  const inp = "h-8 rounded-md border border-input bg-background px-1.5 text-sm";
  const tg = (on: boolean) => `grid h-8 w-8 shrink-0 place-items-center rounded-md border border-input ${on ? "bg-primary text-primary-foreground" : ""}`;
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto border-b border-border bg-card px-2 py-1.5 sm:px-3">
      <select aria-label="Font" className={inp} value={e.style.family} onChange={(ev) => onChange({ style: { family: ev.target.value as TextStyle["family"] } })}>
        <option value="sans">Sans</option>
        <option value="serif">Serif</option>
        <option value="mono">Mono</option>
      </select>
      <input aria-label="Size (pt)" type="number" min={2} max={400} step={0.5} className={`${inp} w-16`} value={+e.style.size.toFixed(2)}
        onChange={(ev) => { const v = parseFloat(ev.target.value); if (v > 0) onChange({ style: { size: v } }); }} />
      <button onMouseDown={keep} onClick={() => onChange({ style: { bold: !e.style.bold } })} aria-label="Bold" className={tg(e.style.bold)}><Bold className="h-4 w-4" /></button>
      <button onMouseDown={keep} onClick={() => onChange({ style: { italic: !e.style.italic } })} aria-label="Italic" className={tg(e.style.italic)}><Italic className="h-4 w-4" /></button>
      <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" title="Text color">A
        <input type="color" aria-label="Text color" className="h-8 w-8 cursor-pointer rounded-md border border-input bg-background" value={e.style.color} onChange={(ev) => onChange({ style: { color: ev.target.value } })} />
      </label>
      <label className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground" title="Background">Bg
        <input type="color" aria-label="Background color" className="h-8 w-8 cursor-pointer rounded-md border border-input bg-background" value={e.bg} onChange={(ev) => onChange({ bg: ev.target.value })} />
      </label>
      {!!e.width && (
        <select aria-label="Alignment" className={inp} value={e.style.align} onChange={(ev) => onChange({ style: { align: ev.target.value as TextStyle["align"] } })}>
          <option value="left">Left</option>
          <option value="center">Center</option>
          <option value="right">Right</option>
        </select>
      )}
      {!e.isNew && (
        <button onMouseDown={keep} onClick={onAi} disabled={aiBusy} aria-label="AI Match" title="AI se original jaisa style match karein"
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md border border-primary/50 px-2 text-xs font-medium text-primary disabled:opacity-50"><Sparkles className="h-4 w-4" />{aiBusy ? "…" : "AI Match"}</button>
      )}
      <button onMouseDown={keep} onClick={onRemove} title={e.isNew ? "Delete text" : "Revert to original"} aria-label={e.isNew ? "Delete text" : "Revert to original"}
        className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-destructive/40 text-destructive"><Trash2 className="h-4 w-4" /></button>
      <button onClick={onClose} aria-label="Done" className="ml-auto shrink-0 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">Done</button>
    </div>
  );
}

function FindReplace({ pdf, items, edits, onApply, onJump, onClose, setBusy }: {
  pdf: PDFDocumentProxy; items: Record<number, TextItemInfo[]>; edits: Edits; onApply: (e: Edits) => void;
  onJump: (p: number) => void; onClose: () => void; setBusy: (s: string | null) => void;
}) {
  const [find, setFind] = useState("");
  const [rep, setRep] = useState("");
  const [cs, setCs] = useState(false);
  const re = find ? new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), cs ? "g" : "gi") : null;
  const matches: { id: string; page: number; text: string; item?: TextItemInfo | undefined }[] = [];
  if (re) {
    Object.values(items).flat().forEach((it) => {
      const cur = edits[it.id] && !edits[it.id].pristine ? edits[it.id].text : it.str;
      if (cur.match(re)) matches.push({ id: it.id, page: it.page, text: cur, item: edits[it.id] && !edits[it.id].pristine ? undefined : it });
    });
    Object.values(edits).filter((e) => e.isNew && e.text.match(re)).forEach((e) => matches.push({ id: e.id, page: e.page, text: e.text }));
  }
  const replaceAll = async () => {
    if (!re || !matches.length) return;
    setBusy("Replacing…");
    try {
      const next = stripPristine(edits);
      const fresh = matches.filter((m) => m.item);
      const pages = [...new Set(fresh.map((m) => m.page))];
      for (const p of pages) {
        const sampled = await samplePageItems(pdf, p, fresh.filter((m) => m.page === p).map((m) => m.item!));
        sampled.forEach(({ item: it, color, bg }) => {
          next[it.id] = {
            id: it.id, page: it.page, text: it.str, bg, x: it.x, y: it.y, angle: it.angle, width: it.width, original: it, isNew: false,
            style: { size: it.size, color, bold: it.bold, italic: it.italic, family: it.family, align: "left" },
          };
        });
      }
      matches.forEach((m) => { next[m.id] = { ...next[m.id], text: next[m.id].text.replace(re, rep) }; });
      onApply(next);
    } finally {
      setBusy(null);
    }
  };
  const inp = "w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";
  return (
    <div className="mb-4 space-y-2 border-b border-border pb-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Find & Replace</h2>
        <button onClick={onClose} aria-label="Close"><X className="h-4 w-4" /></button>
      </div>
      <input className={inp} placeholder="Find" value={find} onChange={(e) => setFind(e.target.value)} />
      <input className={inp} placeholder="Replace with" value={rep} onChange={(e) => setRep(e.target.value)} />
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={cs} onChange={(e) => setCs(e.target.checked)} /> Match case</label>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{find ? `${matches.length} match${matches.length === 1 ? "" : "es"}` : ""}</span>
        <button onClick={replaceAll} disabled={!matches.length}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-40">Replace all</button>
      </div>
      <ul className="max-h-40 space-y-0.5 overflow-y-auto text-xs">
        {matches.slice(0, 100).map((m) => (
          <li key={m.id}><button className="w-full truncate rounded px-1 py-0.5 text-left hover:bg-accent" onClick={() => onJump(m.page)}>
            <span className="text-muted-foreground">p{m.page + 1}</span> {m.text}</button></li>
        ))}
      </ul>
    </div>
  );
}
