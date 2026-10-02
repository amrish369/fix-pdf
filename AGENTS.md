<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

## Architecture
- PDF rendering/text extraction via pdfjs-dist (lazy, worker) in src/lib/pdf; export via pdf-lib cover-rect + redraw with standard fonts — why: embedded subset fonts lack glyphs for new text.
- All PDF processing is client-only (editor mounted in ClientOnly) — why: privacy, no uploads.
- OCR (tesseract.js) is lazy-imported only on explicit user action and outputs the same TextItemInfo model — why: never slow native editing.
- Text runs are merged into phrases (src/lib/pdf/group.ts) and multi-run edits carry `covers`/`memberIds` — why: PDFs split text into fragments; one tap should select a whole phrase.
- Work-in-progress (PDF bytes + edits) auto-saves to IndexedDB (src/lib/persist.ts) — why: survive refresh without uploading anything.
- Download first exports, then shows a before/after preview of the real exported file — why: what you see is exactly what gets saved.
