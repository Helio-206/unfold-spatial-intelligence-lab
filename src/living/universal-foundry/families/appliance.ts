import { CylinderGeometry } from 'three';
import { Bucket, latheAxis, panel, rbox, roundedRect, extrudeProfile, grille } from '../ops';
import { mat, type MaterialSpec } from '../materials';
import type { Family, PartContext } from './types';
import { choiceSpec, frameOf, num, numSpec, place, str } from './common';

/** Household appliances: enamelled or steel cabinets, doors with seams and handles, portholes with gaskets, control panels with knobs and displays, feet, vents. */
const finishOf = (ctx: PartContext): MaterialSpec => { const f = str(ctx, 'finish', 'white'); return f === 'steel' ? mat('steelBrushed', '#B8BBC0') : f === 'black' ? mat('paintedMetal', '#1D1F23') : mat('paintedMetal', ctx.palette.primary.toLowerCase() === '#9aa0a6' ? '#EEF0F1' : ctx.palette.primary); };

function body(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx), r = Math.min(f.L, f.H, f.W) * 0.03;
  b.add(place(rbox(f.L, f.H, f.W, r, 4), f), finishOf(ctx));
  b.add(place(rbox(f.L * 0.9, f.H * 0.05, 0.004, 0.002, 1).translate(0, -f.H / 2 + f.H * 0.04, f.W / 2), f), mat('trim'));
  for (const g of grille(f.L * 0.8, f.H * 0.035, 4, 0.004, 'horizontal')) b.add(place(g.translate(0, -f.H / 2 + f.H * 0.04, f.W / 2 + 0.001), f), mat('trim'));
  for (const x of [-1, 1]) for (const z of [-1, 1]) b.add(place(new CylinderGeometry(0.02, 0.025, 0.02, 14).translate(x * (f.L / 2 - 0.05), -f.H / 2 - 0.008, z * (f.W / 2 - 0.05)), f), mat('rubber'));
}
function door(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx), washer = ctx.archetype === 'washer', r = Math.min(f.L, f.H) * 0.04;
  b.add(place(rbox(f.L, f.H, f.W, r, 4), f), finishOf(ctx));
  b.add(place(rbox(f.L * 0.94, f.H * 0.96, 0.003, r, 2).translate(0, 0, f.W / 2), f), mat('trim', undefined, 'seam'));
  if (washer) {
    const R = Math.min(f.L, f.H) * 0.34;
    b.add(place(latheAxis([[R * 1.12, 0], [R * 1.12, f.W * 0.5], [R * 0.98, f.W * 0.55], [R * 0.9, f.W * 0.3]], 'z', 48).translate(0, 0, f.W / 2 - f.W * 0.1), f), mat('steelBrushed', '#9EA1A6'));
    b.add(place(new CylinderGeometry(R * 0.92, R * 0.92, 0.01, 48).rotateX(Math.PI / 2).translate(0, 0, f.W / 2 + f.W * 0.06), f), mat('glass'));
  } else {
    const long = f.H > f.L, handleLen = (long ? f.H : f.L) * 0.5, sx = long ? f.L / 2 - 0.05 : 0, sy = long ? 0 : f.H / 2 - 0.05;
    const bar = rbox(long ? 0.018 : handleLen, long ? handleLen : 0.018, 0.02, 0.008, 3).translate(sx, sy, f.W / 2 + 0.03);
    b.add(place(bar, f), mat('steelBrushed', '#C0C3C7'));
    for (const s of [-1, 1]) b.add(place(rbox(0.014, 0.014, 0.03, 0.004, 1).translate(sx + (long ? 0 : s * handleLen * 0.4), sy + (long ? s * handleLen * 0.4 : 0), f.W / 2 + 0.013), f), mat('steelBrushed', '#9EA1A6'));
  }
}
function controls(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx), n = Math.round(num(ctx, 'knobs', 3));
  b.add(place(rbox(f.L, f.H, f.W, Math.min(f.H, f.W) * 0.2, 3), f), mat('plastic', '#202226'));
  b.add(place(rbox(f.L * 0.22, f.H * 0.5, 0.003, 0.003, 1).translate(-f.L * 0.3, 0, f.W / 2), f), mat('screen'));
  for (let i = 0; i < n; i++) b.add(place(latheAxis([[0.001, 0.0], [0.016, 0.0], [0.017, 0.006], [0.014, 0.014], [0.001, 0.015]], 'z', 24).translate(-f.L * 0.05 + (i + 0.5) * ((f.L * 0.55) / n), 0, f.W / 2), f), mat('steelBrushed', '#B4B7BC'));
}
function handleOnly(ctx: PartContext, b: Bucket): void { const f = frameOf(ctx); b.add(place(rbox(f.L, f.H, f.W, Math.min(f.L, f.H, f.W) * 0.4, 3), f), mat('steelBrushed', '#C0C3C7')); }
function glassWindow(ctx: PartContext, b: Bucket): void { const f = frameOf(ctx); b.add(place(extrudeProfile(roundedRect(f.L, f.H, Math.min(f.L, f.H) * 0.15), f.W, 0.002).translate(0, 0, -f.W / 2), f), mat('glass')); b.add(place(panel(f.L * 1.06, f.H * 1.06, f.W * 0.3, 0.01).translate(0, 0, -f.W * 0.2), f), mat('trim')); }

export const applianceFamily: Family = {
  category: 'appliance', archetypes: ['fridge', 'washer', 'oven', 'microwave'],
  keywords: /\b(fridge|refrigerator|freezer|washer|washing|dryer|oven|microwave|dishwasher|stove|cooker|appliance|frigor[ií]fico|m[aá]quina de lavar|forno|micro-?ondas|fog[aã]o|geladeira)\b/i,
  archetypeOf: (w) => (/washer|washing|lavar|dryer/.test(w) ? 'washer' : /microwave|micro-?ondas/.test(w) ? 'microwave' : /oven|forno|stove|cooker|fog[aã]o/.test(w) ? 'oven' : 'fridge'),
  roles: [{ role: 'handle', words: /handle|puxador|pega/i }, { role: 'window', words: /window|glass|porthole|vidro|janela/i }, { role: 'controls', words: /control|panel|knob|display|painel|botoeira/i }, { role: 'door', words: /door|porta/i }, { role: 'body', words: /body|cabinet|housing|corpo|carcass|case|appliance|fridge|washer|oven|microwave/i }],
  params: () => [choiceSpec('finish', 'Finish', ['white', 'steel', 'black'], 'white', 'Cabinet and door finish'), numSpec('knobs', 'Knobs', 1, 6, 3, 1, 'Rotary knobs on the control panel')],
  style: () => ({}),
  materialOf: (role, palette) => (role === 'window' ? mat('glass') : role === 'controls' ? mat('plastic') : mat('paintedMetal', palette.primary)),
  build(role, ctx) { const b = new Bucket(); if (role === 'door') door(ctx, b); else if (role === 'controls') controls(ctx, b); else if (role === 'handle') handleOnly(ctx, b); else if (role === 'window') glassWindow(ctx, b); else body(ctx, b); return b; },
  detailRules: (r) => ({ body: ['enamelled cabinet', 'toe-kick vent', 'levelling feet'], door: ['panel seam', 'handle on standoffs', 'porthole with gasket (washer)'], controls: ['display', 'rotary knobs'], handle: ['brushed bar'], window: ['glazing in a frame'] } as Record<string, string[]>)[r] ?? ['rounded cabinet part'],
};
