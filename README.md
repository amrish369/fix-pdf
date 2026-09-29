# EditFlow PDF

Build a production-quality web app called DocEdit AI, an advanced PDF editor focused on one core feature:

Upload PDF → click/tap existing text → edit that exact text → preserve its original appearance → export the edited PDF.

Core requirements

Use:
- React + TypeScript
- Tailwind CSS
- PDF.js for rendering and text-layer extraction
- pdf-lib for PDF export/edit operations
- Web Workers where useful for performance

The most important feature:
When a user clicks/taps existing PDF text, detect that exact text element and make it editable directly at its original position.
For every text element detect/preserve where available:
- text content
- X/Y position
- width/height
- font family
- font size
- color
- bold
- italic
- rotation
- alignment

Example:
"AMRISH YADAV"
User taps "AMRISH" → edits it to "RAHUL".
The exported PDF should retain the original font, size, color, boldness, position and surrounding document layout as closely as possible.

Editor UI:
Create a clean professional PDF editor:
- Upload PDF
- PDF page viewer
- Page thumbnails
- Zoom in/out
- Click-to-edit existing text
- Add text
- Text properties
- Undo/Redo
- Find & Replace
- Download PDF

Desktop and mobile responsive.

Important:
This must be a real working PDF editor, not a UI mockup.
Do not create fake buttons or simulated downloads.
Prioritize the actual PDF rendering, text detection, click-to-edit, style preservation and PDF export over animations, marketing sections or unnecessary features.

Scanned PDFs:
Detect when a PDF has no usable text layer.
Create a clean OCR architecture using Tesseract.js, but do not let OCR work delay or compromise the native PDF text editor. Native text editing is the first priority.

AI:
Do not add expensive AI API calls for basic editing.
AI should only be used later for semantic commands such as: “Change all 2025 to 2026.”
Keep normal text editing completely local/client-side whenever possible.

Performance & security:
- Process PDFs locally whenever possible.
- Do not permanently upload/store user PDFs.
- Treat uploaded PDFs as untrusted files.
- Use lazy page rendering and Web Workers for large PDFs.
- Clean temporary object URLs/data.
- Handle corrupted/password-protected PDFs gracefully.

Development priority:
Phase 1:
1. PDF rendering (PDF.js)
2. Text extraction
3. Click/tap text selection
4. Editable overlay
5. Style detection
6. Real PDF modification/export (pdf-lib)
7. Undo/Redo
8. Add Text + Find/Replace
9. OCR architecture
10. AI features later

Do not spend credits on unnecessary UI polish until the click-to-edit → export workflow actually works.
Phase 1 shuru karo: PDF.js rendering, text extraction, click-to-edit overlay, aur working PDF export.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://fix-pdf.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/4a2fa0bc-0e5f-4bd3-bfbb-0286c926fb9d).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
