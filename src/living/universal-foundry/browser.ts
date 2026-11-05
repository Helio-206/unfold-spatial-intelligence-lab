import { extractEvidence, type ImageEvidence } from './evidence';

/** Decodes a picture at most 160 px on its longest side and extracts local evidence from its pixels. Browser only; no network, no model. */
export async function evidenceFromDataUrl(dataUrl: string): Promise<ImageEvidence | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob(), bmp = await createImageBitmap(blob), k = Math.min(1, 160 / Math.max(bmp.width, bmp.height)), w = Math.max(8, Math.round(bmp.width * k)), h = Math.max(8, Math.round(bmp.height * k));
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; const ctx = canvas.getContext('2d'); if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, w, h); bmp.close?.(); return extractEvidence({ width: w, height: h, data: ctx.getImageData(0, 0, w, h).data });
  } catch { return null; }
}
