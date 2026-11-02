import { PDFDocument } from "pdf-lib";
import { loadPdf } from "@/lib/pdf/pdfjs";

export type SrcType = "pdf" | "png" | "jpeg";

export const isImageFile = (f: { type: string; name: string }) =>
  /^image\//.test(f.type) || /\.(png|jpe?g|webp|bmp|gif)$/i.test(f.name);

export const srcTypeOf = (name: string): SrcType =>
  /\.png$/i.test(name) ? "png" : /\.(jpe?g|webp|bmp|gif)$/i.test(name) ? "jpeg" : "pdf";

/** Wrap a photo/image into a one-page PDF (page size = image pixels at 72dpi) so the same editor works on it. */
export async function imageToPdf(file: File): Promise<Uint8Array> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error("Ye image khul nahi rahi (file kharab ho sakti hai)."));
      i.src = url;
    });
    const doc = await PDFDocument.create();
    let w = img.naturalWidth, h = img.naturalHeight;
    // keep pages a sane size: long side max ~1600pt
    const k = Math.min(1, 1600 / Math.max(w, h));
    w = Math.round(w * k); h = Math.round(h * k);
    let embedded;
    if (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) embedded = await doc.embedJpg(new Uint8Array(await file.arrayBuffer()));
    else if (file.type === "image/png" || /\.png$/i.test(file.name)) embedded = await doc.embedPng(new Uint8Array(await file.arrayBuffer()));
    else {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext("2d")!.drawImage(img, 0, 0);
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), "image/png"));
      embedded = await doc.embedPng(new Uint8Array(await blob.arrayBuffer()));
    }
    const page = doc.addPage([w, h]);
    page.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
    return await doc.save();
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Render every page of an (exported) PDF to an image file and download it. */
export async function downloadAsImages(pdfBytes: Uint8Array, baseName: string, type: "png" | "jpeg") {
  const doc = await loadPdf(pdfBytes.slice());
  try {
    for (let i = 0; i < doc.numPages; i++) {
      const page = await doc.getPage(i + 1);
      const base = page.getViewport({ scale: 1 });
      const vp = page.getViewport({ scale: Math.min(3, 2400 / Math.max(base.width, base.height)) * 1.5 > 1 ? Math.min(3, 3000 / Math.max(base.width, base.height)) : 1 });
      const c = document.createElement("canvas");
      c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: ctx, viewport: vp, canvas: c } as never).promise;
      const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), `image/${type}`, 0.95));
      const a = document.createElement("a");
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = `${baseName}${doc.numPages > 1 ? `-page${i + 1}` : ""}.${type === "png" ? "png" : "jpg"}`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      c.width = c.height = 0;
    }
  } finally {
    void doc.loadingTask.destroy();
  }
}
