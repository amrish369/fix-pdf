import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Download, Loader2, X } from "lucide-react";
import { loadPdf } from "@/lib/pdf/pdfjs";

function PageCanvas({ pdf, pageIndex, width }: { pdf: PDFDocumentProxy; pageIndex: number; width: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const page = await pdf.getPage(pageIndex + 1);
      if (cancelled) return;
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: width / base.width });
      const c = ref.current;
      if (!c) return;
      c.width = Math.floor(vp.width);
      c.height = Math.floor(vp.height);
      await page.render({ canvasContext: c.getContext("2d")!, viewport: vp }).promise.catch(() => {});
    })();
    return () => { cancelled = true; };
  }, [pdf, pageIndex, width]);
  return <canvas ref={ref} className="w-full bg-card ring-1 ring-border" />;
}

interface Props {
  original: PDFDocumentProxy;
  bytes: Uint8Array;
  pages: number[];
  onConfirm: () => void;
  onClose: () => void;
}

/** Side-by-side check of every changed page before the file is written to disk. */
export function PreviewDialog({ original, bytes, pages, onConfirm, onClose }: Props) {
  const [edited, setEdited] = useState<PDFDocumentProxy | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let doc: PDFDocumentProxy | null = null;
    loadPdf(bytes).then((d) => { doc = d; setEdited(d); }).catch((e) => setErr((e as Error).message));
    return () => { void doc?.loadingTask.destroy(); };
  }, [bytes]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/95 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Before & after — {pages.length} changed page{pages.length === 1 ? "" : "s"}</h2>
        <div className="ml-auto flex items-center gap-2">
          <button onClick={onClose} className="rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent">Back to editor</button>
          <button onClick={onConfirm} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90">
            <Download className="h-4 w-4" /> Confirm & download
          </button>
          <button onClick={onClose} aria-label="Close preview" className="grid h-8 w-8 place-items-center rounded-md hover:bg-accent"><X className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3 sm:p-5">
        {err && <p className="text-sm text-destructive">{err}</p>}
        {!edited && !err && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Preparing preview…</p>
        )}
        {edited && (
          <div className="mx-auto flex max-w-6xl flex-col gap-8">
            {pages.map((n) => (
              <div key={n}>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Page {n + 1}</p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <figure>
                    <figcaption className="mb-1 text-xs text-muted-foreground">Before</figcaption>
                    <PageCanvas pdf={original} pageIndex={n} width={900} />
                  </figure>
                  <figure>
                    <figcaption className="mb-1 text-xs font-medium text-primary">After</figcaption>
                    <PageCanvas pdf={edited} pageIndex={n} width={900} />
                  </figure>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
