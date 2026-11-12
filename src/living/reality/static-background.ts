/**
 * Automatic outlines for a TURNTABLE or a fixed-camera video: the camera and the background do not move, the object does. Pixels that stay the same in every frame
 * are background (sure); pixels that differ from the per-pixel median are object (sure); what is left (the always-covered core, shadows) is decided by the
 * graph cut from the colour models those two groups provide. It does not apply to a hand-held orbit, where the background moves too: that is detected
 * (little static area) and reported, never silently trusted.
 */
import { segmentInteractive } from './interactive-segmentation';
import type { RGBA } from '../universal-foundry/evidence';

export type StaticBackgroundResult = { masks: Uint8Array[]; /** share of the picture that stayed identical in all frames */ staticShare: number; applicable: boolean; reason: string; staticThreshold: number };
export const STATIC_MIN_SHARE = 0.25;

export function segmentStaticBackground(frames: readonly RGBA[]): StaticBackgroundResult {
  const n = frames.length, { width: W, height: H } = frames[0]!;
  if (n < 3 || frames.some((f) => f.width !== W || f.height !== H)) return { masks: [], staticShare: 0, applicable: false, reason: 'são precisas ≥ 3 imagens do mesmo tamanho', staticThreshold: 0 };
  const px = W * H, median = new Float32Array(px * 3), dev = new Float32Array(px * n), tmp = new Float32Array(n);
  for (let p = 0; p < px; p++) for (let c = 0; c < 3; c++) { for (let i = 0; i < n; i++) tmp[i] = frames[i]!.data[p * 4 + c]!; const s = Array.from(tmp).sort((a, b) => a - b); median[p * 3 + c] = n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2; }
  const dist = (i: number, p: number) => Math.max(Math.abs(frames[i]!.data[p * 4]! - median[p * 3]!), Math.abs(frames[i]!.data[p * 4 + 1]! - median[p * 3 + 1]!), Math.abs(frames[i]!.data[p * 4 + 2]! - median[p * 3 + 2]!));
  const maxDev = new Float32Array(px); for (let p = 0; p < px; p++) { let m = 0; for (let i = 0; i < n; i++) { const d = dist(i, p); dev[p * n + i] = d; if (d > m) m = d; } maxDev[p] = m; }
  // noise level from the quietest 30% of pixels; the static threshold sits well above it
  const sorted = Float32Array.from(maxDev).sort(), noise = sorted[Math.floor(px * 0.3)]!, tStatic = Math.max(8, 3 * noise + 4), tObject = Math.max(30, 6 * tStatic);
  let staticCount = 0; for (let p = 0; p < px; p++) if (maxDev[p]! <= tStatic) staticCount++;
  const share = staticCount / px;
  if (share < STATIC_MIN_SHARE) return { masks: [], staticShare: share, applicable: false, reason: `só ${(share * 100).toFixed(0)}% da imagem é estático: a câmara ou o fundo mexem-se (órbita à mão); este método não se aplica`, staticThreshold: tStatic };
  // the object's total extent = bounding box of the non-static pixels
  let x0 = W, y0 = H, x1 = 0, y1 = 0; for (let p = 0; p < px; p++) if (maxDev[p]! > tStatic) { const x = p % W, y = (p - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  const pad = Math.round(0.02 * Math.max(W, H)), box = { x0: Math.max(0, x0 - pad), y0: Math.max(0, y0 - pad), x1: Math.min(W, x1 + pad), y1: Math.min(H, y1 + pad) };
  // Static pixels are sure background ONLY when they are far from every changing pixel AND connect to the picture border through such pixels. Static pixels next
  // to the object (a part of the object that never changes, a pocket enclosed by it) are left to the colour models: a static test cannot tell an unchanging part of the
  // object from the background it touches.
  const r = Math.max(3, Math.round(0.025 * Math.max(W, H))); let near = new Uint8Array(px); for (let p = 0; p < px; p++) near[p] = maxDev[p]! > tStatic ? 1 : 0;
  for (let it = 0; it < r; it++) { const nx = near.slice(); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const p = y * W + x; if (near[p]) { if (x > 0) nx[p - 1] = 1; if (x < W - 1) nx[p + 1] = 1; if (y > 0) nx[p - W] = 1; if (y < H - 1) nx[p + W] = 1; } } near = nx; }
  const outside = new Uint8Array(px), stack: number[] = [], push = (p: number) => { if (!outside[p] && !near[p]) { outside[p] = 1; stack.push(p); } };
  for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); } for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
  while (stack.length) { const p = stack.pop()!, x = p % W; if (x > 0) push(p - 1); if (x < W - 1) push(p + 1); if (p >= W) push(p - W); if (p < px - W) push(p + W); }
  const run = (bgOf: (p: number, c: number) => number, known: Uint8Array | null): Uint8Array[] => {
    const out: Uint8Array[] = [];
    for (let i = 0; i < n; i++) {
      const seeds = new Uint8Array(px), d = frames[i]!.data;
      for (let p = 0; p < px; p++) {
        if (outside[p]) { seeds[p] = 2; continue; }
        const dv = Math.max(Math.abs(d[p * 4]! - bgOf(p, 0)), Math.abs(d[p * 4 + 1]! - bgOf(p, 1)), Math.abs(d[p * 4 + 2]! - bgOf(p, 2)));
        seeds[p] = dv > tObject ? 1 : known && known[p] && dv <= tStatic ? 2 : 0;
      }
      out.push(segmentInteractive(frames[i]!, { box, seeds }).mask);
    }
    return out;
  };
  let masks = run((p, c) => median[p * 3 + c]!, null);
  // Second pass: the median is wrong where the object covers a pixel in half of the frames or more (it IS the object there). Re-estimate the background of every pixel
  // from the frames where the first pass found it uncovered (at least 2 of them) and decide again with that background.
  const bg2 = new Float32Array(px * 3), have = new Uint8Array(px), col = new Float32Array(n);
  for (let p = 0; p < px; p++) { let m = 0; for (let i = 0; i < n; i++) if (!masks[i]![p]) m++; if (m < 2) continue; have[p] = 1; for (let c = 0; c < 3; c++) { let k = 0; for (let i = 0; i < n; i++) if (!masks[i]![p]) col[k++] = frames[i]!.data[p * 4 + c]!; const s = Array.from(col.subarray(0, k)).sort((a, b) => a - b); bg2[p * 3 + c] = s[Math.floor(k / 2)]!; } }
  const refined = run((p, c) => (have[p] ? bg2[p * 3 + c]! : median[p * 3 + c]!), have);
  masks = refined;
  return { masks, staticShare: share, applicable: true, reason: `${(share * 100).toFixed(0)}% da imagem estática em todas as vistas: fundo separado por diferença temporal`, staticThreshold: tStatic };
}
