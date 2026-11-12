import type { RealityModel } from '../../src/living/reality/model';
import { viewsOf } from '../../src/living/reality/model';
import { decodeColour, type RealityEvidence } from '../../src/living/reality/evidence';
import type { IntakeImage } from '../../src/living/reality/intake';
import { splitByAppearance, surfaceColours, type AppearanceOptions } from '../../src/universal-spatial/reconstruction/appearance-parts';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { liftProposals, type LiftOptions } from '../../src/universal-spatial/reconstruction/multiview-parts';
import { proposalToWindow, unpackBits } from '../../src/living/reality/part-proposals';
export type Variant = (model: RealityModel, evidence: RealityEvidence, photos: IntakeImage[]) => ArrayLike<number>;
const appearance = (o: AppearanceOptions): Variant => (m, ev) => {
  const views = viewsOf(ev), cv = views.map((v, i) => ({ view: v, colour: ev.views[i]!.colour ? decodeColour(ev.views[i]!.colour!, ev.colourRes) : null, colourRes: ev.colourRes }));
  const sc = surfaceColours(cv, m.solid.occupancy, m.solid.grid, m.frame, ev.res);
  return splitByAppearance(m.solid.labels, m.solid.occupancy, m.solid.grid, sc, o).labels;
};
const lifted = (o: LiftOptions, combine = false): Variant => (m, ev, photos) => {
  const id = photos[0]!.name.replace(/-\d+$/, ''), file = resolve('scripts/benchmark/cache/sam', `${id}.turn8.json`);
  if (!existsSync(file)) return m.solid.labels;
  const data = JSON.parse(readFileSync(file, 'utf8')) as { width: number; height: number; views: Array<Array<{ bits: string }>> }, views = viewsOf(ev);
  const input = views.map((v, i) => ({ view: v, res: ev.res, proposals: data.views[i]!.map((p) => proposalToWindow(unpackBits(p.bits, data.width * data.height), data.width, data.height, ev.views[i]!, ev.frame.half, ev.res)) }));
  const r = liftProposals(m.solid.occupancy, m.solid.grid, m.frame, input, o);
  if (!r.parts) return m.solid.labels;
  if (!combine) return r.labels;
  // intersection with the geometric parts: a part is split where the views say so, and never merged across a geometric neck
  const out = new Uint16Array(r.labels.length), map = new Map<string, number>(); for (let i = 0; i < out.length; i++) if (r.labels[i]) { const k = `${r.labels[i]}|${m.solid.labels[i]}`; if (!map.has(k)) map.set(k, map.size + 1); out[i] = map.get(k)!; }
  return out;
};
/** appearance split kept only where the multiview proposals independently agree (normalised mutual information within the geometric part) */
const consensus = (nmiMin: number): Variant => (m, ev, photos) => {
  const app = appearance({})(m, ev, photos), sam = lifted({ seedAffinity: 0.7 })(m, ev, photos), geo = m.solid.labels, out = new Uint16Array(geo.length); out.set(geo as ArrayLike<number> as never);
  const parts = new Set<number>(); for (let i = 0; i < geo.length; i++) if (geo[i]) parts.add(geo[i]!);
  let next = 1; for (const v of parts) next = Math.max(next, v + 1); next += 1000;
  for (const P of parts) {
    const idx: number[] = []; for (let i = 0; i < geo.length; i++) if (geo[i] === P) idx.push(i);
    const a = new Map<number, number>(), s = new Map<number, number>(), j = new Map<string, number>(); for (const i of idx) { a.set(app[i]!, (a.get(app[i]!) ?? 0) + 1); s.set(sam[i]!, (s.get(sam[i]!) ?? 0) + 1); const k = `${app[i]}|${sam[i]}`; j.set(k, (j.get(k) ?? 0) + 1); }
    if (a.size < 2) continue; const n = idx.length; let mi = 0, ha = 0, hs = 0; for (const c of a.values()) ha -= (c / n) * Math.log(c / n); for (const c of s.values()) hs -= (c / n) * Math.log(c / n);
    for (const [k, c] of j) { const [x, y] = k.split('|').map(Number) as [number, number]; mi += (c / n) * Math.log((c / n) / ((a.get(x)! / n) * (s.get(y)! / n))); }
    const nmi = ha + hs > 0 ? (2 * mi) / (ha + hs) : 0; if (nmi < nmiMin) continue;
    const remap = new Map<number, number>(); for (const i of idx) { const l = app[i]!; if (!remap.has(l)) remap.set(l, l === P ? P : next++); out[i] = remap.get(l)!; }
  }
  return out;
};
export const VARIANTS: Record<string, Variant> = {
  baseline: (m) => m.solid.labels,
  app: appearance({}), 'app∧sam-0.1': consensus(0.1), 'app∧sam-0.2': consensus(0.2), 'app∧sam-0.3': consensus(0.3),
  sam: lifted({}), 'sam+geom': lifted({}, true),
  'sam-m45': lifted({ mergeAffinity: 0.45 }), 'sam-m65': lifted({ mergeAffinity: 0.65 }), 'sam-s70': lifted({ seedAffinity: 0.7 }), 'sam-sh02': lifted({ minShare: 0.02 }), 'sam-sh06': lifted({ minShare: 0.06 }),
  'app-s8': appearance({ scale: 8 }), 'app-s24': appearance({ scale: 24 }), 'app-c15': appearance({ minContrast: 15 }), 'app-c32': appearance({ minContrast: 32 }), 'app-sh08': appearance({ minShare: 0.08 }), 'app-sh20': appearance({ minShare: 0.2 }),
};
