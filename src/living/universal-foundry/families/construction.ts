import { BufferGeometry, CylinderGeometry, Vector3 } from 'three';
import { Bucket, boltRow, extrudeProfile, hose, merge, panel, rbox, roundedRect, hinge, v3 } from '../ops';
import { mat } from '../materials';
import { shade } from '../recipe';
import type { Family, PartContext } from './types';
import { choiceSpec, frameOf, num, numSpec, place } from './common';

/** Construction equipment: crawler tracks with pads and rollers, cabs with glazing and a roof, booms as tapered I-sections with doublers and pins, buckets with teeth, hydraulic cylinders. */
const paint = (ctx: PartContext) => mat('paintedMetal', ctx.palette.primary);
const pin = (r: number, len: number): BufferGeometry => new CylinderGeometry(r, r, len, 18).rotateX(Math.PI / 2);

function track(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx), pads = Math.round(num(ctx, 'trackPads', 26)), h = f.H, rollers = Math.round(num(ctx, 'rollers', 5));
  const outline = roundedRect(f.L, h, h * 0.48, 8);
  b.add(place(extrudeProfile(outline.map(([x, y]) => [x * 0.94, y * 0.84] as [number, number]), f.W * 0.5, 0.01).translate(0, 0, -f.W * 0.25), f), mat('paintedMetal', '#34373D'));
  const loop: Vector3[] = []; for (let i = 0; i < pads * 2; i++) { const t = i / (pads * 2); const a = t * Math.PI * 2, rx = f.L / 2, ry = h / 2; const sx = Math.sign(Math.cos(a)) * Math.abs(Math.cos(a)) ** 0.5, sy = Math.sign(Math.sin(a)) * Math.abs(Math.sin(a)) ** 0.5; loop.push(v3(rx * sx, ry * sy, 0)); }
  const shoes: BufferGeometry[] = []; for (let i = 0; i < pads; i++) { const p = loop[i * 2]!, q = loop[(i * 2 + 2) % loop.length]!, d = q.clone().sub(p); shoes.push(rbox(d.length() * 0.92, h * 0.07, f.W * 0.7, 0.006, 1).rotateZ(Math.atan2(d.y, d.x)).translate((p.x + q.x) / 2, (p.y + q.y) / 2, 0)); }
  b.add(place(merge(shoes), f), mat('steelBrushed', '#4A4D52'));
  for (const s of [-1, 1]) b.add(place(merge(Array.from({ length: rollers }, (_, i) => new CylinderGeometry(h * 0.2, h * 0.2, f.W * 0.1, 24).rotateX(Math.PI / 2).translate(-f.L * 0.3 + (i * f.L * 0.6) / Math.max(1, rollers - 1), -h * 0.28, s * f.W * 0.28))), f), mat('steelBrushed', '#3A3D42'));
  for (const s of [-1, 1]) for (const x of [-1, 1]) b.add(place(new CylinderGeometry(h * 0.38, h * 0.38, f.W * 0.12, 28).rotateX(Math.PI / 2).translate(x * (f.L / 2 - h * 0.4), 0, s * f.W * 0.28), f), mat('steelBrushed', '#52555A'));
}
function cab(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx), t = Math.min(f.L, f.W) * 0.06;
  b.add(place(rbox(f.L, f.H * 0.08, f.W, 0.02, 2).translate(0, -f.H / 2 + f.H * 0.04, 0), f), paint(ctx));
  b.add(place(rbox(f.L * 0.94, f.H * 0.84, f.W * 0.94, 0.03, 3).translate(0, -f.H * 0.04, 0), f), mat('glass'));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) b.add(place(rbox(t, f.H * 0.86, t, 0.01, 2).translate(sx * f.L * 0.47, -f.H * 0.04, sz * f.W * 0.47), f), paint(ctx));
  b.add(place(rbox(f.L * 1.04, f.H * 0.07, f.W * 1.04, 0.03, 3).translate(0, f.H / 2 - f.H * 0.035, 0), f), paint(ctx));
  b.add(place(rbox(f.L * 0.1, 0.008, f.W * 0.7, 0.003, 1).translate(f.L * 0.46, f.H * 0.12, 0).rotateZ(0.12), f), mat('trim'));
  b.add(place(rbox(0.16, 0.05, 0.12, 0.015, 3).translate(f.L * 0.3, f.H / 2 + 0.03, f.W * 0.3), f), mat('emissive', '#FFF3D6', 'work-light'));
}
function house(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx);
  b.add(place(rbox(f.L, f.H, f.W, Math.min(f.L, f.H, f.W) * 0.06, 4), f), paint(ctx));
  b.add(place(rbox(f.L * 0.5, 0.01, f.W * 0.7, 0.004, 1).translate(-f.L * 0.15, f.H / 2, 0), f), mat('trim'));
  for (let i = 0; i < 7; i++) b.add(place(rbox(f.L * 0.3, 0.006, 0.006, 0.002, 1).translate(-f.L * 0.2, f.H / 2 + 0.004, -f.W * 0.28 + i * (f.W * 0.56) / 6), f), mat('steelBrushed', '#2B2D31'));
  b.add(place(new CylinderGeometry(f.H * 0.06, f.H * 0.06, f.H * 0.35, 18).translate(-f.L * 0.38, f.H / 2 + f.H * 0.15, f.W * 0.3), f), mat('steelBrushed', '#2B2D31'));
  for (const s of [-1, 1]) b.add(place(rbox(f.L * 0.35, f.H * 0.45, 0.01, 0.006, 1).translate(f.L * 0.05, 0, s * f.W / 2), f), mat('trim'));
  for (const g of boltRow(8, f.L * 0.1, Math.max(0.01, f.H * 0.025), 'z')) b.add(place(g.translate(0, f.H * 0.42, f.W / 2), f), mat('steelMachined'));
}
function boom(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx), thick = f.W * 0.9;
  const prof: Array<[number, number]> = [[-f.L / 2, -f.H * 0.45], [-f.L * 0.1, -f.H * 0.5], [f.L / 2, -f.H * 0.28], [f.L / 2, f.H * 0.28], [-f.L * 0.1, f.H * 0.5], [-f.L / 2, f.H * 0.42]];
  b.add(place(extrudeProfile(prof, thick, Math.min(0.015, f.H * 0.08)).translate(0, 0, -thick / 2), f), paint(ctx));
  for (const s of [-1, 1]) b.add(place(rbox(f.L * 0.7, f.H * 0.18, 0.012, 0.004, 1).translate(0, 0, s * (thick / 2 + 0.006)), f), mat('paintedMetal', shade(ctx.palette.primary, -0.15)));
  for (const x of [-1, 1]) b.add(place(pin(f.H * 0.11, thick * 1.2).translate(x * (f.L / 2 - f.H * 0.18), 0, 0), f), mat('steelMachined'));
}
function bucket(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx), teeth = Math.round(num(ctx, 'teeth', 5)), prof: Array<[number, number]> = [[-f.L / 2, f.H / 2], [f.L / 2 * 0.7, f.H / 2], [f.L / 2, -f.H * 0.15], [f.L * 0.35, -f.H / 2], [-f.L * 0.3, -f.H * 0.35], [-f.L / 2, -f.H * 0.05]];
  b.add(place(extrudeProfile(prof, f.W, 0.012).translate(0, 0, -f.W / 2), f), mat('steelBrushed', '#6B6E73'));
  for (let i = 0; i < teeth; i++) b.add(place(rbox(f.L * 0.18, f.H * 0.1, f.W / teeth * 0.5, 0.004, 1).rotateZ(-0.5).translate(f.L * 0.44, -f.H * 0.43, -f.W / 2 + (i + 0.5) * (f.W / teeth)), f), mat('steelMachined', '#8A8D92'));
}
function cylinder(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx, true), r = Math.min(f.H, f.W) / 2;
  b.add(place(new CylinderGeometry(r, r, f.L * 0.55, 28).rotateZ(Math.PI / 2).translate(-f.L * 0.22, 0, 0), f), paint(ctx));
  b.add(place(new CylinderGeometry(r * 0.5, r * 0.5, f.L * 0.6, 20).rotateZ(Math.PI / 2).translate(f.L * 0.2, 0, 0), f), mat('chrome'));
  for (const x of [-1, 1]) b.add(place(rbox(r * 1.6, r * 2.1, r * 2.4, r * 0.4, 3).translate(x * (f.L / 2 - r * 0.8), 0, 0), f), mat('steelMachined'));
  void hose; void panel; void hinge;
}

export const constructionFamily: Family = {
  category: 'construction', archetypes: ['excavator', 'loader', 'dozer'],
  keywords: /\b(excavator|digger|bulldozer|dozer|loader|backhoe|crane|boom|bucket|track|crawler|undercarriage|cab|hydraulic|escavadora|p[aá] carregadora|lagarta|balde|lan[cç]a|ca[cç]amba|cilindro|trator)\b/i,
  archetypeOf: (w) => (/dozer|bulldozer|blade/.test(w) ? 'dozer' : /loader|carregadora/.test(w) ? 'loader' : 'excavator'),
  roles: [{ role: 'track', words: /track|crawler|undercarriage|lagarta|esteira/i }, { role: 'cylinder', words: /cylinder|piston|hydraulic|cilindro/i }, { role: 'bucket', words: /bucket|scoop|blade|balde|ca[cç]amba|l[aâ]mina/i }, { role: 'cab', words: /cab\b|cabin|cabine|operator/i }, { role: 'boom', words: /boom|arm|stick|lan[cç]a|brao|bra[cç]o/i }, { role: 'house', words: /house|body|upper|engine|counterweight|chassis|corpo|motor|contrapeso|superstructure/i }],
  params: () => [numSpec('trackPads', 'Track pads', 14, 40, 26, 1, 'Shoes around each track'), numSpec('rollers', 'Track rollers', 3, 8, 5, 1, 'Bottom rollers per track'), numSpec('teeth', 'Bucket teeth', 3, 8, 5, 1, 'Teeth on the bucket'), choiceSpec('paint', 'Paint', ['as plan', 'safety yellow', 'orange'], 'as plan', 'Body paint; "as plan" keeps the plan/evidence colour')],
  style: () => ({}),
  materialOf: (role, palette) => (role === 'track' || role === 'bucket' ? mat('steelBrushed', '#4A4D52') : role === 'cylinder' ? mat('chrome') : mat('paintedMetal', palette.primary)),
  build(role, ctx) { const b = new Bucket(); if (role === 'track') track(ctx, b); else if (role === 'cab') cab(ctx, b); else if (role === 'boom') boom(ctx, b); else if (role === 'bucket') bucket(ctx, b); else if (role === 'cylinder') cylinder(ctx, b); else house(ctx, b); return b; },
  detailRules: (r) => ({ track: ['track shoes', 'rollers', 'sprocket and idler'], cab: ['glazing', 'pillars', 'roof', 'work light'], boom: ['tapered I-section', 'doubler plates', 'pivot pins'], bucket: ['bucket profile', 'teeth'], cylinder: ['barrel', 'chrome rod', 'clevis ends', 'inferred appearance; attachment not verified'], house: ['engine hood', 'vents', 'exhaust', 'access panels', 'fasteners'] } as Record<string, string[]>)[r] ?? ['painted steel solid'],
};
