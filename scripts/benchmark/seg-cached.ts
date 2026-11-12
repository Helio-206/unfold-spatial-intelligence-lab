// Segmentation validation on the cached composites (scripts/benchmark/seg-composites.py): reference = exact alpha. Compares selection policies:
//   baseline  = the product's consensus selection (autoOutlines)
//   geometry  = baseline start + per-view candidate choice by agreement with the hull of the other views (outline-consistency)
// and measures how well the held-out agreement DETECTS wrong outlines (accepted masks with IoU < 0.8).
//   npx tsx scripts/benchmark/seg-cached.ts [--assets A,B] [--cond fixed,varied,degraded] [--policy baseline,geometry]
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { candidateOutlines, selectOutline, maskCredibility } from '../../src/living/reality/auto-segmentation';
import { chooseByAgreement, perViewAgreement } from '../../src/living/reality/outline-consistency';
import type { SodRunner } from '../../src/living/reality/sod';

const W = 480, H = 360, arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1]! : null);
const only = arg('--assets')?.split(',') ?? null, conds = arg('--cond')?.split(',') ?? ['fixed', 'varied', 'degraded'], policies = arg('--policy')?.split(',') ?? ['baseline', 'static-first', 'oracle'];
const manifest = JSON.parse(readFileSync(resolve('reports/reality-engine/benchmark/manifest.json'), 'utf8')) as { assets: Array<{ id: string; split: string }> };
function npy(file: string): { shape: number[]; data: Uint8Array } {
  const b = readFileSync(file), hl = b.readUInt16LE(8), header = b.subarray(10, 10 + hl).toString(), shape = (/\(([^)]*)\)/.exec(header)![1]!.split(',').map((s) => s.trim()).filter(Boolean).map(Number));
  return { shape, data: new Uint8Array(b.buffer, b.byteOffset + 10 + hl, b.length - 10 - hl) };
}
const iou = (a: Uint8Array, b: Uint8Array) => { let i = 0, u = 0; for (let k = 0; k < a.length; k++) { i += a[k]! & b[k]!; u += a[k]! | b[k]!; } return u ? i / u : 0; };
const half = (u16: number) => { const s = (u16 >> 15) & 1, e = (u16 >> 10) & 31, f = u16 & 1023; return (s ? -1 : 1) * (e === 0 ? f / 1024 * 2 ** -14 : e === 31 ? NaN : (1 + f / 1024) * 2 ** (e - 15)); };
const auc = (pos: number[], neg: number[]) => { if (!pos.length || !neg.length) return NaN; let w = 0; for (const p of pos) for (const q of neg) w += p > q ? 1 : p === q ? 0.5 : 0; return w / (pos.length * neg.length); };

type Row = { asset: string; split: string; cond: string; policy: string; accepted: number; wrong: number; meanIoU: number; refused: number; flagged: number; wrongFlagged: number };
const rows: Row[] = []; const agreementWrong: Record<string, number[]> = {}, agreementRight: Record<string, number[]> = {};
for (const a of manifest.assets) {
  if (only && !only.includes(a.id)) continue;
  const alpha = gunzipSync(readFileSync(resolve('scripts/benchmark/cache', `${a.id}.turn8.rgba.gz`))), truths = Array.from({ length: 8 }, (_, i) => { const m = new Uint8Array(W * H); for (let k = 0; k < m.length; k++) m[k] = alpha[i * W * H * 4 + k * 4 + 3]! > 127 ? 1 : 0; return m; });
  for (const cond of conds) {
    const rg = npy(resolve('scripts/benchmark/cache/seg', `${a.id}.${cond}.rgba.npy`)).data, sd = npy(resolve('scripts/benchmark/cache/seg', `${a.id}.${cond}.sod.npy`)).data, sd16 = new Uint16Array(sd.buffer, sd.byteOffset, sd.length / 2);
    const images = Array.from({ length: 8 }, (_, i) => ({ width: W, height: H, data: new Uint8ClampedArray(rg.buffer, rg.byteOffset + i * W * H * 4, W * H * 4) }));
    const soft = new Map<unknown, Float32Array>(); images.forEach((im, i) => { const f = new Float32Array(W * H); for (let k = 0; k < f.length; k++) f[k] = half(sd16[i * W * H + k]!); soft.set(im, f); });
    const sod: SodRunner = { available: async () => true, run: async (im) => soft.get(im)! };
    const cands = await candidateOutlines(images, { sod });
    if (process.env.CANDS) { const by: Record<string, number[]> = {}; cands.forEach((cs, i) => cs.forEach((c) => (by[c.method] ??= []).push(+iou(c.mask, truths[i]!).toFixed(2)))); console.log(a.id, cond, JSON.stringify(by)); }
    for (const policy of policies) {
      const sel = cands.map((cs, i) => selectOutline(cs, W, H)), idx = sel.map((s, i) => (s.method ? cands[i]!.findIndex((c) => c.method === s.method) : -1));
      let finalIdx = idx, agreement: number[] | null = null;
      const pick = (m: string) => (i: number) => { const c = cands[i]!.findIndex((x) => x.method === m && maskCredibility(x.mask, W, H)); return c; };
      if (policy === 'static-first') finalIdx = idx.map((c, i) => { const s = pick('static-background')(i); return s >= 0 ? s : c; });
      else if (policy === 'oracle') finalIdx = idx.map((_c, i) => { let b = -1, bi = -1; cands[i]!.forEach((x, k) => { if (!maskCredibility(x.mask, W, H)) return; const v = iou(x.mask, truths[i]!); if (v > bi) { bi = v; b = k; } }); return b; });
      if (policy === 'geometry') { const g = chooseByAgreement(images, cands, idx, 20); finalIdx = g.index; agreement = g.agreement; }
      else if (idx.every((c) => c >= 0)) agreement = perViewAgreement(images, idx.map((c, i) => cands[i]![c]!.mask), 20);
      const ious = finalIdx.map((c, i) => (c >= 0 ? iou(cands[i]![c]!.mask, truths[i]!) : null)), acc = ious.filter((v): v is number => v !== null);
      const wrongIdx = ious.map((v, i) => (v !== null && v < 0.8 ? i : -1)).filter((i) => i >= 0);
      const THR = 0.8, flagged = agreement ? agreement.map((v, i) => (v < THR && finalIdx[i]! >= 0 ? i : -1)).filter((i) => i >= 0) : [];
      if (agreement) ious.forEach((v, i) => { if (v === null) return; (v < 0.8 ? (agreementWrong[policy] ??= []) : (agreementRight[policy] ??= [])).push(agreement![i]!); });
      rows.push({ asset: a.id, split: a.split, cond, policy, accepted: acc.length, wrong: wrongIdx.length, meanIoU: +(acc.reduce((s, v) => s + v, 0) / Math.max(1, acc.length)).toFixed(4), refused: 8 - acc.length, flagged: flagged.length, wrongFlagged: wrongIdx.filter((i) => flagged.includes(i)).length });
      console.log(a.id, cond, policy, JSON.stringify(rows.at(-1)));
    }
  }
}
const summary: Record<string, unknown> = {};
for (const cond of conds) for (const policy of policies) { const r = rows.filter((x) => x.cond === cond && x.policy === policy), acc = r.reduce((s, x) => s + x.accepted, 0), wrong = r.reduce((s, x) => s + x.wrong, 0), fl = r.reduce((s, x) => s + x.flagged, 0), wf = r.reduce((s, x) => s + x.wrongFlagged, 0);
  summary[`${cond}/${policy}`] = { views: r.length * 8, accepted: acc, wrong, wrongRate: +(wrong / Math.max(1, acc)).toFixed(3), meanIoU: +(r.reduce((s, x) => s + x.meanIoU * x.accepted, 0) / Math.max(1, acc)).toFixed(4), flagged: fl, wrongCaught: wf, wrongCaughtRate: +(wf / Math.max(1, wrong)).toFixed(3), flaggedButRight: fl - wf }; }
for (const p of policies) summary[`agreementAUC/${p}`] = +auc(agreementRight[p] ?? [], agreementWrong[p] ?? []).toFixed(3);
console.log(JSON.stringify(summary, null, 1));
if (!only) writeFileSync(resolve('reports/reality-engine/benchmark/segmentation-cached.json'), JSON.stringify({ generatedBy: 'scripts/benchmark/seg-cached.ts', reference: 'renderer exact alpha', wrongDefinition: 'accepted outline with IoU < 0.8', flagThreshold: 'held-out agreement < 0.8', summary, rows }, null, 2) + '\n');
