import { Path } from 'three';
import { Bucket, extrudeProfile, latheAxis, rbox, roundedRect } from '../ops';
import { mat, type MaterialSpec } from '../materials';
import type { Family, PartContext } from './types';
import { choiceSpec, frameOf, num, numSpec, place, str } from './common';

/** Mechanical hand tools: turned grips with rings, forged heads with chamfers and hex openings, tapered shafts, jaws with teeth. Long axis = X. */
const steel = (): MaterialSpec => mat('paintedMetal', '#AEB2B8');
const grip = (ctx: PartContext): MaterialSpec => { const g = str(ctx, 'grip', 'rubber'); return g === 'steel' ? mat('steelBrushed', '#AEB2B8') : g === 'wood' ? mat('wood', ctx.palette.secondary) : g === 'plastic' ? mat('plasticGloss', ctx.palette.accent) : mat('rubber', '#C0392B', 'grip'); };

function handle(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx, true), r = Math.min(f.H, f.W) / 2, L = f.L, rings = Math.round(num(ctx, 'gripRings', 5));
  const prof: Array<[number, number]> = [[0.001, -L / 2]];
  for (let i = 0; i <= 24; i++) { const t = i / 24, belly = 1 + 0.18 * Math.sin(Math.PI * t) - 0.1 * Math.cos(2 * Math.PI * t * 1) * 0; const ring = rings > 0 && Math.sin(t * Math.PI * rings * 2) > 0.7 && t > 0.15 && t < 0.9 ? 0.93 : 1; prof.push([r * belly * ring * (0.82 + 0.18 * t), -L / 2 + t * L]); }
  prof.push([0.001, L / 2]);
  b.add(place(latheAxis(prof, 'x', ctx.lod.seg(28, 10)), f), grip(ctx));
  b.add(place(latheAxis([[0.001, L / 2 - 0.0], [r * 0.9, L / 2], [r * 1.05, L / 2 + 0.01]], 'x', 24).translate(0, 0, 0), f), mat('steelBrushed', '#8E9196'));
}
function shaft(ctx: PartContext, b: Bucket): void { const f = frameOf(ctx, true), r = Math.min(f.H, f.W) / 2; b.add(place(latheAxis([[0.001, -f.L / 2], [r * 0.7, -f.L / 2], [r, -f.L / 2 + f.L * 0.1], [r * 0.85, f.L / 2 - f.L * 0.1], [r * 0.5, f.L / 2], [0.001, f.L / 2]], 'x', 28), f), mat('chrome')); }
function head(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx), c = Math.min(f.L, f.H, f.W) * 0.08;
  if (ctx.archetype === 'wrench' || ctx.archetype === 'ring-wrench') {
    const R = f.H / 2, hex = new Path(); const hr = R * 0.45; for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2 + Math.PI / 6, p: [number, number] = [Math.cos(a) * hr + f.L * 0.18, Math.sin(a) * hr]; if (i) hex.lineTo(...p); else hex.moveTo(...p); } hex.closePath();
    if (ctx.archetype === 'ring-wrench') {
      const outline = roundedRect(f.L, f.H, R * 0.4, 6);
      b.add(place(extrudeProfile(outline, f.W, c * 0.6, [hex]).translate(0, 0, -f.W / 2), f), steel());
    } else {
      // Continuous mouth open at +X; no internal closed hole.
      const L = f.L / 2, H = f.H / 2, gap = H * 0.42;
      const outline: Array<[number, number]> = [[-L, -H * .65], [-L * .7, -H], [L * .78, -H], [L, -H * .82], [L, -gap], [L * .05, -gap], [-L * .12, 0], [L * .05, gap], [L, gap], [L, H * .82], [L * .78, H], [-L * .7, H], [-L, H * .65]];
      b.add(place(extrudeProfile(outline, f.W, c * .3).translate(0, 0, -f.W / 2), f), steel());
    }
  } else {
    b.add(place(rbox(f.L * 0.62, f.H, f.W, c, 4).translate(-f.L * 0.19, 0, 0), f), steel());
    b.add(place(rbox(f.L * 0.5, f.H * 0.55, f.W * 0.7, c, 3).translate(f.L * 0.24, -f.H * 0.12, 0).rotateZ(-0.12), f), steel());
    b.add(place(latheAxis([[0.001, -f.L / 2], [f.H * 0.46, -f.L / 2], [f.H * 0.5, -f.L / 2 + f.L * 0.05], [f.H * 0.5, -f.L / 2 + f.L * 0.2], [0.001, -f.L / 2 + f.L * 0.2]].reverse() as Array<[number, number]>, 'x', 28), f), mat('steelMachined', '#7C7F84'));
  }
}
function jaw(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx, true), teeth = Math.round(num(ctx, 'teeth', 6)); b.add(place(rbox(f.L, f.H, f.W, f.H * 0.12, 3), f), steel());
  for (let i = 0; i < teeth; i++) b.add(place(rbox(f.L / teeth * 0.35, f.H * 0.12, f.W * 0.9, 0.001, 1).translate(-f.L / 2 + (i + 0.5) * (f.L / teeth), -f.H / 2, 0), f), mat('steelBrushed', '#6E7176'));
}

export const toolFamily: Family = {
  category: 'tool', archetypes: ['hammer', 'wrench', 'ring-wrench', 'screwdriver', 'pliers'],
  keywords: /\b(hammer|wrench|spanner|screwdriver|pliers|tool|handle|claw|jaw|chisel|saw|martelo|chave|alicate|ferramenta|punho|cabo)\b/i,
  archetypeOf: (w) => (/ring spanner|ring wrench|box.end wrench/.test(w) ? 'ring-wrench' : /wrench|spanner|chave/.test(w) ? 'wrench' : /screwdriver|chave de fendas/.test(w) ? 'screwdriver' : /pliers|alicate/.test(w) ? 'pliers' : 'hammer'),
  roles: [{ role: 'handle', words: /handle|grip|punho|cabo|haste de madeira/i }, { role: 'jaw', words: /jaw|plier|alicate|teeth/i }, { role: 'shaft', words: /shaft|shank|blade|haste/i }, { role: 'head', words: /head|claw|cabe[cç]a|garra|striking|tip|ponta/i }],
  params: () => [choiceSpec('grip', 'Grip', ['steel', 'rubber', 'wood', 'plastic'], 'steel', 'Handle material'), numSpec('gripRings', 'Grip rings', 0, 9, 5, 1, 'Turned rings on the grip'), numSpec('teeth', 'Jaw teeth', 3, 12, 6, 1, 'Serrations on jaws')],
  style: () => ({}),
  materialOf: (role) => (role === 'handle' ? mat('rubber') : mat('steelMachined')),
  build(role, ctx) { const b = new Bucket(); if (role === 'handle') handle(ctx, b); else if (role === 'shaft') shaft(ctx, b); else if (role === 'jaw') jaw(ctx, b); else head(ctx, b); return b; },
  detailRules: (r) => ({ handle: ['turned grip with rings', 'ferrule'], head: ['forged head with chamfers', 'hex opening (wrench) or face and claw (hammer)'], shaft: ['tapered polished shaft'], jaw: ['serrated jaw'] } as Record<string, string[]>)[r] ?? ['forged body'],
};
