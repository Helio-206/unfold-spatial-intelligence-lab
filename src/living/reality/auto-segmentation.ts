/**
 * Automatic outlines, several strategies, one decision. Candidates: the classical background-colour outline, the static-background (turntable / fixed-camera)
 * outline, and the salient-object network (raw and graph-cut refined). Each candidate is scored by the credibility gate; among the credible ones the product keeps
 * the one that agrees most with the others (consensus), preferring the more specific method on ties. A view with no credible candidate is NOT guessed: it is sent
 * to the person's editor. Every outline records which method produced it.
 */
import type { RGBA } from '../universal-foundry/evidence';
import { segmentGeneric, segmentationCredibility } from './intake';
import { segmentInteractive } from './interactive-segmentation';
import { segmentStaticBackground } from './static-background';
import type { SodRunner } from './sod';

export type OutlineMethod = 'static-background' | 'salient-network+graphcut' | 'salient-network' | 'classical-colour';
export type Candidate = { method: OutlineMethod; mask: Uint8Array };
export type AutoOutline = { mask: Uint8Array | null; method: OutlineMethod | null; credible: boolean; consensus: number; considered: Array<{ method: OutlineMethod; credible: boolean; agreement: number }>; note: string };
const PREFERENCE: OutlineMethod[] = ['static-background', 'salient-network+graphcut', 'salient-network', 'classical-colour'];

const iou = (a: Uint8Array, b: Uint8Array) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += a[k]! & b[k]!; u += a[k]! | b[k]!; } return u ? i / u : 0; };
/** Credibility of a bare mask (same gate as the colour segmentation, computed from the mask itself). */
export function maskCredibility(mask: Uint8Array, width: number, height: number): boolean {
  let n = 0, x0 = width, y0 = height, x1 = -1, y1 = -1, band = 0; const bx = Math.max(1, Math.round(width * 0.04)), by = Math.max(1, Math.round(height * 0.04));
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (mask[y * width + x]) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; if (x < bx || x >= width - bx || y < by || y >= height - by) band++; }
  if (!n) return false;
  const ratio = n / (width * height), fill = n / ((x1 - x0 + 1) * (y1 - y0 + 1));
  // largest connected share
  const seen = new Uint8Array(mask.length); let largest = 0; const stack: number[] = [];
  for (let k = 0; k < mask.length; k++) if (mask[k] && !seen[k]) { let c = 0; stack.push(k); seen[k] = 1; while (stack.length) { const p = stack.pop()!, x = p % width; c++; for (const q of [x > 0 ? p - 1 : -1, x < width - 1 ? p + 1 : -1, p >= width ? p - width : -1, p + width < mask.length ? p + width : -1]) if (q >= 0 && mask[q] && !seen[q]) { seen[q] = 1; stack.push(q); } } if (c > largest) largest = c; }
  return ratio >= 0.008 && ratio <= 0.85 && fill >= 0.12 && band / n <= 0.15 && largest / n >= 0.75;
}

export function selectOutline(candidates: readonly Candidate[], width: number, height: number): AutoOutline {
  const scored = candidates.map((c) => ({ ...c, credible: maskCredibility(c.mask, width, height) })), credible = scored.filter((c) => c.credible);
  const considered = scored.map((c) => ({ method: c.method, credible: c.credible, agreement: 0 }));
  if (!credible.length) return { mask: null, method: null, credible: false, consensus: 0, considered, note: 'Nenhuma estratégia automática produziu um contorno credível: use «Ajustar contorno».' };
  const agree = credible.map((c) => ({ c, a: credible.length > 1 ? credible.filter((o) => o !== c).reduce((s, o) => s + iou(c.mask, o.mask), 0) / (credible.length - 1) : 0.5 }));
  for (const e of agree) considered.find((x) => x.method === e.c.method)!.agreement = +e.a.toFixed(3);
  // A credible static-background outline is a PHYSICAL cue (pixels that never change are not the object); it is kept over learned strategies. Measured on the
  // validation composites (fixed background): mean IoU 0.61 -> 0.75 against 0.79 for the oracle choice among the same candidates (reports/reality-engine/benchmark/segmentation-cached.json).
  const stat = agree.find((e) => e.c.method === 'static-background');
  if (stat) return { mask: stat.c.mask, method: 'static-background', credible: true, consensus: +stat.a.toFixed(3), considered, note: 'Fundo estático: o que não muda entre as fotografias não é o objecto.' };
  // consensus wins; candidates within 0.05 of the best agreement are ordered by method preference
  const best = Math.max(...agree.map((e) => e.a)), top = agree.filter((e) => e.a >= best - 0.05).sort((p, q) => PREFERENCE.indexOf(p.c.method) - PREFERENCE.indexOf(q.c.method))[0]!;
  const lone = credible.length === 1;
  return { mask: top.c.mask, method: top.c.method, credible: true, consensus: +top.a.toFixed(3), considered, note: lone ? `Só a estratégia «${top.c.method}» deu um contorno credível (sem confirmação por outra): confirme-o visualmente.` : `Contorno por «${top.c.method}» (concordância ${(top.a * 100).toFixed(0)}% com as outras estratégias).` };
}

const refine = (rgba: RGBA, soft: Float32Array, hi = 0.9, lo = 0.1): Uint8Array | null => {
  const { width: W, height: H } = rgba; let x0 = W, y0 = H, x1 = 0, y1 = 0, n = 0; const seeds = new Uint8Array(W * H);
  for (let k = 0; k < W * H; k++) { if (soft[k]! >= 0.5) { n++; const x = k % W, y = (k - x) / W; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; } seeds[k] = soft[k]! > hi ? 1 : soft[k]! < lo ? 2 : 0; }
  if (n < W * H * 0.003) return null; const pad = 0.06;
  return segmentInteractive(rgba, { box: { x0: Math.max(0, x0 - pad * W), y0: Math.max(0, y0 - pad * H), x1: Math.min(W, x1 + pad * W), y1: Math.min(H, y1 + pad * H) }, seeds }).mask;
};

/** Every strategy's outline for every image (same size = a turntable / fixed camera), before any decision. */
export async function candidateOutlines(images: readonly RGBA[], deps: { sod?: SodRunner | null; useStaticBackground?: boolean } = {}): Promise<Candidate[][]> {
  const n = images.length, cands: Candidate[][] = images.map((im) => [{ method: 'classical-colour', mask: segmentGeneric(im).mask }]);
  if (deps.useStaticBackground !== false && n >= 3 && images.every((im) => im.width === images[0]!.width && im.height === images[0]!.height)) { const st = segmentStaticBackground(images); if (st.applicable) st.masks.forEach((m, i) => cands[i]!.push({ method: 'static-background', mask: m })); }
  if (deps.sod && (await deps.sod.available())) for (let i = 0; i < n; i++) {
    const im = images[i]!, soft = await deps.sod.run(im as never), raw = new Uint8Array(im.width * im.height); for (let k = 0; k < raw.length; k++) raw[k] = soft[k]! >= 0.5 ? 1 : 0;
    cands[i]!.push({ method: 'salient-network', mask: raw }); const gc = refine(im, soft); if (gc) cands[i]!.push({ method: 'salient-network+graphcut', mask: gc });
  }
  return cands;
}
/** Runs every available strategy on a set of images and picks one outline per image. */
export async function autoOutlines(images: readonly RGBA[], deps: { sod?: SodRunner | null; useStaticBackground?: boolean } = {}): Promise<AutoOutline[]> {
  const cands = await candidateOutlines(images, deps);
  return images.map((im, i) => selectOutline(cands[i]!, im.width, im.height));
}
export { segmentationCredibility };
