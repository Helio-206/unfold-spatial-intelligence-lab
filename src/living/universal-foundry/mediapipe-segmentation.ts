/**
 * Segmentação aprendida local (opcional, atrás da flag `experimental-mediapipe`):
 * MediaPipe ImageSegmenter com DeepLab v3 (classes Pascal VOC; vehicle = bus 6 + car 7),
 * executado no browser do utilizador (WASM). Medido contra as anotações manuais:
 * IoU 0.54–0.77 nas fotografias reais (vs 0.20–0.27 do método clássico) — melhor, mas
 * ainda abaixo do alvo de 0.90, e continua sujeito ao mesmo gate de fiabilidade.
 *
 * O runtime WASM vem do CDN do pacote e o modelo do armazenamento público da MediaPipe
 * (rede opcional, nunca obrigatória): qualquer falha devolve null e o caminho clássico
 * continua. A máscara resultante tem proveniência `model:mediapipe-deeplab-v3`,
 * distinguível da automática clássica e da confirmada pelo utilizador.
 */
import { extractEvidence, largestComponentFilled, type ImageEvidence, type RGBA } from './evidence';

export const MEDIAPIPE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/deeplab_v3/float32/1/deeplab_v3.tflite';
export const MEDIAPIPE_WASM_BASE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm';
export const VEHICLE_CLASSES = [6, 7] as const; // Pascal VOC: bus, car

type Segmenter = { segment(image: HTMLImageElement): { categoryMask?: { getAsUint8Array(): Uint8Array; width: number; height: number } }; close(): void };
let segmenterPromise: Promise<Segmenter> | null = null;

async function loadSegmenter(): Promise<Segmenter> {
  segmenterPromise ??= (async () => {
    const vision = await import('@mediapipe/tasks-vision');
    const fileset = await vision.FilesetResolver.forVisionTasks(MEDIAPIPE_WASM_BASE);
    const segmenter = await vision.ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MEDIAPIPE_MODEL_URL },
      runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: false,
    });
    return segmenter as unknown as Segmenter;
  })();
  return segmenterPromise;
}

export function disposeMediapipeSegmenter(): void {
  if (segmenterPromise) void segmenterPromise.then((s) => { try { s.close(); } catch { /* já fechado */ } }).catch(() => undefined);
  segmenterPromise = null;
}

/** Constrói a evidência com a máscara do modelo sobre os píxeis decodificados (cores do caminho clássico). */
export function evidenceWithModelMask(rgba: RGBA, labels: Uint8Array, labelWidth: number, labelHeight: number): ImageEvidence | null {
  const base = extractEvidence(rgba);
  const { width: w, height: h } = rgba;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const lx = Math.min(labelWidth - 1, Math.floor(x * labelWidth / w));
    const ly = Math.min(labelHeight - 1, Math.floor(y * labelHeight / h));
    mask[y * w + x] = (VEHICLE_CLASSES as readonly number[]).includes(labels[ly * labelWidth + lx]!) ? 1 : 0;
  }
  const filled = largestComponentFilled(mask, w, h);
  const total = filled.reduce((s, v) => s + v, 0);
  if (total < w * h * 0.01) return null;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (filled[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return {
    ...base,
    mask: filled,
    bbox: { x0, y0, x1, y1 },
    aspect: (x1 - x0 + 1) / Math.max(1, y1 - y0 + 1),
    foregroundRatio: total / (w * h),
    largestComponentShare: 1,
  };
}

/** Segmenta uma imagem e devolve a evidência com a máscara do modelo, ou null (fallback clássico). */
export async function mediapipeVehicleEvidence(dataUrl: string): Promise<ImageEvidence | null> {
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, 160 / Math.max(bmp.width, bmp.height));
    const w = Math.max(8, Math.round(bmp.width * scale)), h = Math.max(8, Math.round(bmp.height * scale));
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d'); if (!ctx) return null;
    ctx.drawImage(bmp, 0, 0, w, h);
    const rgba: RGBA = { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
    const img = new Image();
    img.src = dataUrl;
    await img.decode();
    bmp.close?.();
    const segmenter = await loadSegmenter();
    const result = segmenter.segment(img);
    const category = result.categoryMask;
    if (!category) return null;
    return evidenceWithModelMask(rgba, category.getAsUint8Array(), category.width, category.height);
  } catch {
    return null; // rede/modelo indisponível: o caminho clássico continua, sem esconder a falha (quem chama regista a proveniência)
  }
}
