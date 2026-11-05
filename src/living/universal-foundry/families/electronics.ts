import { BufferGeometry, CylinderGeometry } from 'three';
import { Bucket, extrudeProfile, merge, panel, rbox, roundedRect, hinge } from '../ops';
import { mat, type MaterialSpec } from '../materials';
import { shade, type Palette } from '../recipe';
import type { Family, PartContext } from './types';
import { boolSpec, choiceSpec, frameOf, num, numSpec, place, str } from './common';

/** Consumer electronics: shells with bezels and glass, key grids from rows x columns, ports, vents, hinges, camera lenses, stands. */
const shell = (ctx: PartContext): MaterialSpec => { const f = str(ctx, 'shell', 'aluminium'); return f === 'plastic' ? mat('plasticGloss', ctx.palette.primary) : f === 'dark' ? mat('plastic', '#25272B') : mat('steelBrushed', '#B4B7BC'); };

function screenPart(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx), t = Math.min(f.W, f.H, f.L), r = Math.min(0.02, t * 0.5), bez = num(ctx, 'bezel', 0.025);
  // thin axis of a display is its depth: model it as L x H panel, W thick
  b.add(place(rbox(f.L, f.H, f.W, r, 4), f), shell(ctx));
  b.add(place(rbox(f.L - bez * 2, f.H - bez * 2.4, f.W * 0.12, r * 0.4, 2).translate(0, -bez * 0.2, f.W / 2 - f.W * 0.04), f), mat('screen'));
  b.add(place(new CylinderGeometry(0.0035, 0.0035, 0.002, 12).rotateX(Math.PI / 2).translate(0, f.H / 2 - bez * 0.9, f.W / 2 - 0.0005), f), mat('emissive', '#2A6B3A', 'camera'));
  b.add(place(rbox(f.L * 0.14, f.H * 0.012, 0.003, 0.0015, 1).translate(0, -f.H / 2 + bez * 0.3, f.W / 2), f), mat('trim'));
}

function baseDeck(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx), r = Math.min(0.015, f.H * 0.4), rows = Math.round(num(ctx, 'keyRows', 5)), cols = Math.round(num(ctx, 'keyCols', 13));
  b.add(place(rbox(f.L, f.H, f.W, r, 4), f), shell(ctx));
  b.add(place(rbox(f.L * 0.94, 0.002, f.W * 0.5, 0.002, 1).translate(0, f.H / 2, -f.W * 0.14), f), mat('trim'));
  const kw = (f.L * 0.9) / cols, kd = (f.W * 0.44) / rows, keys: BufferGeometry[] = [];
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) keys.push(rbox(kw * 0.86, Math.max(0.003, f.H * 0.25), kd * (i === rows - 1 && j > 3 && j < cols - 4 ? 0.86 : 0.82), 0.0015, 1).translate(-f.L * 0.45 + (j + 0.5) * kw, f.H / 2 + 0.001, -f.W * 0.36 + (i + 0.5) * kd));
  b.add(place(merge(keys), f), mat('trim'));
  b.add(place(rbox(f.L * 0.34, 0.001, f.W * 0.24, 0.006, 2).translate(0, f.H / 2, f.W * 0.28), f), mat('plasticGloss', shade(ctx.palette.primary, -0.2)));
  for (const s of [1, -1]) for (let k = 0; k < 2; k++) b.add(place(rbox(0.014, f.H * 0.28, 0.006, 0.002, 1).translate(s * f.L / 2, 0, -f.W * 0.1 + k * 0.025 * 1.6), f), mat('trim'));
  const vents = Array.from({ length: 6 }, (_, i) => rbox(f.L * 0.2, 0.0012, 0.003, 0.0006, 1).translate(f.L * 0.3, -f.H / 2, -f.W * 0.1 + i * 0.008));
  b.add(place(merge(vents), f), mat('trim'));
}

function hingeBar(ctx: PartContext, b: Bucket): void { const f = frameOf(ctx); b.add(place(hinge(f.L * 0.9, Math.min(f.H, f.W) * 0.4).rotateZ(Math.PI / 2), f), mat('steelBrushed', '#6A6D72')); }
function stand(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx); const m = shell(ctx);
  b.add(place(rbox(f.L, Math.min(f.H * 0.06, 0.025), f.W, 0.01, 3).translate(0, -f.H / 2 + 0.01, 0), f), m);
  b.add(place(extrudeProfile(roundedRect(Math.min(f.L * 0.14, 0.08), f.H, 0.01), Math.min(f.W * 0.28, 0.03), 0.003).translate(0, 0, -Math.min(f.W * 0.28, 0.03) / 2), f), m);
}
function phoneBody(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx), r = Math.min(f.L, f.H, f.W) * 0.4;
  b.add(place(rbox(f.L, f.H, f.W, r, 5), f), shell(ctx));
  b.add(place(panel(f.L * 0.94, f.H * 0.97, 0.002, r * 0.8).translate(0, 0, f.W / 2), f), mat('screen'));
  for (let i = 0; i < 2; i++) { const y = f.H / 2 - 0.02 - i * 0.026; b.add(place(new CylinderGeometry(0.011, 0.011, 0.004, 24).rotateX(Math.PI / 2).translate(-f.L * 0.3, y, -f.W / 2), f), mat('glass')); b.add(place(new CylinderGeometry(0.0155, 0.0155, 0.003, 24).rotateX(Math.PI / 2).translate(-f.L * 0.3, y, -f.W / 2 + 0.001), f), mat('steelBrushed')); }
}

export const electronicsFamily: Family = {
  category: 'electronics', archetypes: ['laptop', 'monitor', 'phone'],
  keywords: /\b(laptop|notebook|computer|monitor|screen|display|keyboard|phone|smartphone|tablet|trackpad|bezel|tela|ecr[aã]|teclado|computador|port[aá]til|telem[oó]vel|hinge)\b/i,
  archetypeOf: (w) => (/phone|telem[oó]vel|tablet/.test(w) ? 'phone' : /monitor|display/.test(w) && !/keyboard|laptop|notebook/.test(w) ? 'monitor' : 'laptop'),
  roles: [{ role: 'screen', words: /screen|display|lid|tela|ecr[aã]|panel|monitor/i }, { role: 'hinge', words: /hinge|dobradi/i }, { role: 'stand', words: /stand|neck|foot|suporte|pedestal/i }, { role: 'base', words: /base|keyboard|deck|body|chassis|teclado|corpo|phone|tablet/i }],
  params: (a) => [choiceSpec('shell', 'Shell', ['aluminium', 'plastic', 'dark'], 'aluminium', 'Casing material'), numSpec('keyRows', 'Key rows', 3, 7, 5, 1, 'Rows of keys'), numSpec('keyCols', 'Key columns', 8, 16, 13, 1, 'Columns of keys'), numSpec('bezel', 'Bezel (m)', 0.004, 0.06, a === 'phone' ? 0.008 : 0.025, 0.002, 'Screen border'), boolSpec('ports', 'Ports', true, 'Side ports on the base')],
  style: () => ({}),
  materialOf: (role, palette: Palette) => (role === 'screen' ? mat('screen') : mat('steelBrushed', palette.primary)),
  build(role, ctx) { const b = new Bucket(); if (ctx.archetype === 'phone' && (role === 'base' || role === 'screen')) phoneBody(ctx, b); else if (role === 'screen') screenPart(ctx, b); else if (role === 'hinge') hingeBar(ctx, b); else if (role === 'stand') stand(ctx, b); else baseDeck(ctx, b); return b; },
  detailRules: (r) => ({ screen: ['bezel', 'glass panel', 'camera', 'chin trim'], base: ['key grid (rows x columns)', 'trackpad', 'side ports', 'vents'], hinge: ['hinge barrel and leaves'], stand: ['neck', 'weighted foot'] } as Record<string, string[]>)[r] ?? ['rounded shell'],
};
