import { Bucket, bend, blobField, latheAxis, loftSections, rbox, subdivide, tubeAlong, v3, type Section } from '../ops';
import { mat, type MaterialSpec } from '../materials';
import { shade } from '../recipe';
import type { Family, PartContext } from './types';
import { choiceSpec, frameOf, num, numSpec, place, str } from './common';

/** Curved and organic objects: smooth-union implicit bodies (fruit, pebbles, gourds), turned vessels from a profile curve, lofted and bent leaves, swept stems. */
const skin = (ctx: PartContext): MaterialSpec => { const m = str(ctx, 'surface', ctx.archetype === 'vase' ? 'ceramic' : 'skin'); return m === 'ceramic' ? mat('ceramic', ctx.palette.primary) : m === 'leather' ? mat('leather', ctx.palette.primary) : m === 'plastic' ? mat('plasticGloss', ctx.palette.primary) : mat('plasticGloss', ctx.palette.primary, 'skin'); };

function organicBody(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx), rx = f.L / 2, ry = f.H / 2, rz = f.W / 2, lumps = Math.round(num(ctx, 'lumps', 2)), rnd = ctx.rnd, k = Math.min(rx, ry, rz) * num(ctx, 'smoothness', 0.55);
  if (ctx.archetype === 'vase') {
    const belly = num(ctx, 'belly', 0.9), neck = num(ctx, 'neck', 0.35), lip = num(ctx, 'lip', 0.5), R = Math.min(rx, rz), h = f.H;
    const prof: Array<[number, number]> = [[0.001, -h / 2], [R * 0.55, -h / 2], [R * 0.6, -h / 2 + h * 0.03], [R * belly, -h / 2 + h * 0.3], [R * belly * 0.96, -h / 2 + h * 0.5], [R * neck * 1.4, -h / 2 + h * 0.72], [R * neck, -h / 2 + h * 0.85], [R * lip * 0.9, h / 2 - h * 0.03], [R * lip, h / 2], [R * lip * 0.82, h / 2], [R * neck * 0.9, h / 2 - h * 0.03], [R * neck * 0.88, -h / 2 + h * 0.5], [0.001, -h / 2 + h * 0.15]];
    b.add(place(latheAxis(prof, 'y', ctx.lod.seg(56, 20)), f), skin(ctx)); return;
  }
  const shapes = [{ type: 'ellipsoid' as const, c: [0, 0, 0] as [number, number, number], radii: [rx * 0.82, ry * 0.8, rz * 0.82] as [number, number, number] }];
  for (let i = 0; i < lumps; i++) { const a = (i / Math.max(1, lumps)) * Math.PI * 2 + rnd(), r = 0.5 + rnd() * 0.15; shapes.push({ type: 'ellipsoid' as const, c: [Math.cos(a) * rx * r, (rnd() - 0.5) * ry * 0.4, Math.sin(a) * rz * r] as [number, number, number], radii: [rx * 0.5, ry * 0.55, rz * 0.5] as [number, number, number] }); }
  const { geometry } = blobField({ shapes, k, seed: Math.round(rnd() * 1e6), noise: num(ctx, 'roughness', 0.08), maxCells: ctx.lod.seg(56, 28), maxTriangles: 40_000 });
  b.add(place(subdivide(geometry, ctx.lod.scale >= 1 ? 0 : 0), f), skin(ctx));
  // stem dimple and stalk for fruit
  if (str(ctx, 'surface', 'skin') === 'skin') b.add(place(tubeAlong([v3(0, ry * 0.7, 0), v3(rx * 0.04, ry * 1.02, 0), v3(rx * 0.12, ry * 1.12, 0)], Math.min(rx, rz) * 0.05, 12, 8), f), mat('wood', '#5B4025'));
}
function leaf(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx), n = Math.max(6, Math.round(f.L * 0 + 8)), secs: Section[] = [];
  for (let i = 0; i <= n; i++) { const t = i / n, w = f.W * Math.sin(Math.PI * Math.min(1, t * 0.9 + 0.1)) ** 0.8; secs.push({ x: -f.L / 2 + t * f.L, y: 0, z: 0, h: Math.max(0.002, f.H * (1 - t * 0.6)), w: Math.max(0.004, w), p: 2.2 }); }
  const g = bend(loftSections(secs, 16, 60), 'x', num(ctx, 'leafCurl', 0.5) / Math.max(0.2, f.L));
  b.add(place(g, f), mat('plasticGloss', ctx.palette.secondary === ctx.palette.primary ? '#4F7A3C' : ctx.palette.secondary, 'leaf'));
  b.add(place(rbox(f.L * 0.95, f.H * 0.5, f.W * 0.03, 0.002, 1).translate(0, f.H * 0.3, 0), f), mat('plasticGloss', shade('#4F7A3C', 0.2), 'vein'));
}
function stem(ctx: PartContext, b: Bucket): void { const f = frameOf(ctx), r = Math.min(f.L, f.W) / 2; b.add(place(tubeAlong([v3(0, -f.H / 2, 0), v3(r * 1.5, -f.H * 0.1, 0), v3(-r * 0.8, f.H * 0.25, 0), v3(0, f.H / 2, 0)], r, 28, 10), f), mat('plasticGloss', '#5F7F3E', 'stem')); }
function pot(ctx: PartContext, b: Bucket): void { const f = frameOf(ctx), R = Math.min(f.L, f.W) / 2; b.add(place(latheAxis([[0.001, -f.H / 2], [R * 0.6, -f.H / 2], [R * 0.7, -f.H / 2 + f.H * 0.05], [R * 0.95, f.H / 2 - f.H * 0.1], [R, f.H / 2 - f.H * 0.02], [R * 0.98, f.H / 2], [R * 0.86, f.H / 2], [R * 0.86, f.H / 2 - f.H * 0.06], [0.001, f.H / 2 - f.H * 0.06]], 'y', ctx.lod.seg(40, 16)), f), mat('ceramic', '#B5593A', 'terracotta')); }

export const organicFamily: Family = {
  category: 'organic', archetypes: ['fruit', 'vase', 'plant'],
  keywords: /\b(fruit|apple|pear|orange|vase|bottle|jug|pebble|stone|egg|gourd|pumpkin|plant|leaf|flower|stem|pot|bowl|cup|maçã|fruta|vaso|garrafa|folha|planta|flor|haste|caule|ovo|pedra|ta[cç]a)\b/i,
  archetypeOf: (w) => (/vase|vaso|bottle|garrafa|jug|jarro|bowl|cup/.test(w) ? 'vase' : /plant|planta|leaf|folha|flower|flor/.test(w) ? 'plant' : 'fruit'),
  roles: [{ role: 'leaf', words: /leaf|leaves|folha|petal/i }, { role: 'stem', words: /stem|stalk|haste|caule|talo/i }, { role: 'pot', words: /pot|planter|vaso de/i }, { role: 'body', words: /body|fruit|vase|bottle|egg|bowl|apple|pear|orange|corpo|fruta|vaso|garrafa|stone|pebble|cup/i }],
  params: (a) => [choiceSpec('surface', 'Surface', a === 'vase' ? ['ceramic', 'plastic', 'leather', 'skin'] : ['skin', 'ceramic', 'leather', 'plastic'], a === 'vase' ? 'ceramic' : 'skin', 'Surface finish'), numSpec('smoothness', 'Blend smoothness', 0.2, 1, 0.55, 0.05, 'Smooth-union radius relative to the body'), numSpec('lumps', 'Lumps', 0, 4, 2, 1, 'Extra implicit lobes'), numSpec('roughness', 'Surface undulation', 0, 0.25, 0.08, 0.01, 'Seeded noise amplitude'), numSpec('belly', 'Vase belly', 0.5, 1, 0.9, 0.02, 'Widest radius of a vase'), numSpec('neck', 'Vase neck', 0.15, 0.8, 0.35, 0.02, 'Neck radius'), numSpec('lip', 'Vase lip', 0.2, 0.9, 0.5, 0.02, 'Lip radius'), numSpec('leafCurl', 'Leaf curl', 0, 1.5, 0.5, 0.05, 'Bend of leaves')],
  style: () => ({}),
  materialOf: (role, palette) => (role === 'leaf' || role === 'stem' ? mat('plasticGloss', '#4F7A3C') : role === 'pot' ? mat('ceramic', '#B5593A') : mat('ceramic', palette.primary)),
  build(role, ctx) { const b = new Bucket(); if (role === 'leaf') leaf(ctx, b); else if (role === 'stem') stem(ctx, b); else if (role === 'pot') pot(ctx, b); else organicBody(ctx, b); return b; },
  detailRules: (r) => ({ body: ['smooth-union implicit surface (surface nets) or turned profile', 'seeded undulation', 'stalk'], leaf: ['lofted blade', 'curl (bend)', 'midrib'], stem: ['swept tube'], pot: ['turned terracotta with rim'] } as Record<string, string[]>)[r] ?? ['smooth solid'],
};
