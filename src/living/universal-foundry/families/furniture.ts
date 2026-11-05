import { BufferGeometry, CylinderGeometry } from 'three';
import { Bucket, boltRow, latheAxis, pillow, rbox, taper } from '../ops';
import { mat, type MaterialSpec } from '../materials';
import { shade, type Palette, type ParamValue } from '../recipe';
import type { Family, PartContext } from './types';
import { choiceSpec, frameOf, num, numSpec, place, str, thinAxis } from './common';

/** Furniture: soft seats (pillow + seams), tapered legs with feet, rounded slabs in wood, panels, drawers, frames with joints. The finish is a parameter, not a model. */
const surface = (finish: string, palette: Palette): MaterialSpec => finish === 'leather' ? mat('leather', palette.primary) : finish === 'fabric' ? mat('fabric', palette.primary) : finish === 'metal' ? mat('steelBrushed', palette.primary) : finish === 'plastic' ? mat('plasticGloss', palette.primary) : mat('wood', palette.primary);
const frameMat = (ctx: PartContext): MaterialSpec => (str(ctx, 'frame', 'wood') === 'metal' ? mat('steelBrushed', '#6B6E73') : mat('wood', ctx.palette.secondary));

function leg(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx), r = Math.min(f.L, f.W) / 2, round = str(ctx, 'legStyle', 'tapered') !== 'square';
  const top = r, bottom = r * (str(ctx, 'legStyle', 'tapered') === 'tapered' ? 0.62 : 1), h = f.H;
  const g: BufferGeometry = round ? latheAxis([[0.001, -h / 2], [bottom * 0.96, -h / 2], [bottom, -h / 2 + 0.006], [(top + bottom) / 2, 0], [top, h / 2 - 0.02], [top * 0.9, h / 2 - 0.004], [0.001, h / 2]], 'y', ctx.lod.seg(24, 10)) : taper(rbox(r * 2, h, r * 2, r * 0.18, 3), 'y', 1, bottom / top);
  b.add(place(g, f), frameMat(ctx));
  if (str(ctx, 'frame', 'wood') === 'wood') b.add(place(new CylinderGeometry(bottom * 1.02, bottom * 1.02, h * 0.04, ctx.lod.seg(20, 8)).translate(0, -h / 2 + h * 0.02, 0), f), mat('rubber'));
}

function seat(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx), m = surface(str(ctx, 'finish', 'fabric'), ctx.palette), soft = str(ctx, 'finish', 'fabric') !== 'wood' && str(ctx, 'finish', 'fabric') !== 'metal';
  const base = Math.min(f.H, 0.06);
  if (soft) {
    b.add(place(rbox(f.L * 0.98, base, f.W * 0.98, 0.012, 2).translate(0, -f.H / 2 + base / 2, 0), f), frameMat(ctx));
    b.add(place(pillow(f.L, f.H - base, f.W, num(ctx, 'puff', 0.025), Math.min(0.08, f.H * 0.4), ctx.lod.seg(8, 4)).translate(0, base / 2, 0), f), m);
    // piping seam around the cushion edge
    b.add(place(rbox(f.L * 0.99, 0.008, f.W * 0.99, 0.004, 1).translate(0, -f.H / 2 + base + 0.002, 0), f), mat('trim'));
  } else b.add(place(rbox(f.L, f.H, f.W, Math.min(0.03, f.H * 0.45), 4), f), m);
}

function slab(ctx: PartContext, b: Bucket, role: string): void {
  const f = frameOf(ctx), m = surface(str(ctx, role === 'top' ? 'topFinish' : 'finish', role === 'top' ? 'wood' : 'fabric'), ctx.palette);
  const r = Math.min(f.H * 0.45, num(ctx, 'edgeRadius', 0.012));
  b.add(place(rbox(f.L, f.H, f.W, r, 4), f), m);
  if (role === 'top' && f.H > 0.02) b.add(place(rbox(f.L * 0.985, f.H * 0.12, f.W * 0.985, r * 0.5, 2).translate(0, -f.H / 2 - f.H * 0.04, 0), f), frameMat(ctx));
}

function backrest(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx), finish = str(ctx, 'finish', 'fabric'), m = surface(finish, ctx.palette);
  if (finish === 'wood' || finish === 'metal') {
    const slats = Math.round(num(ctx, 'slats', 4)), h = f.H / (slats * 2 - 1);
    for (let i = 0; i < slats; i++) b.add(place(rbox(f.L, h, f.W, 0.006, 2).translate(0, -f.H / 2 + h / 2 + i * h * 2, 0), f), m);
  } else {
    b.add(place(pillow(f.L, f.H, f.W, num(ctx, 'puff', 0.025), Math.min(0.07, f.W * 0.45), ctx.lod.seg(8, 4)), f), m);
    for (const x of [-0.5, 0.5]) b.add(place(rbox(0.008, f.H * 0.92, f.W * 1.02, 0.003, 1).translate(x * f.L * 0.33, 0, 0), f), mat('trim'));
  }
}

function drawer(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx); const m = surface(str(ctx, 'finish', 'wood'), ctx.palette);
  b.add(place(rbox(f.L, f.H, f.W, 0.01, 3), f), m);
  b.add(place(rbox(f.L * 0.8, f.H * 0.7, f.W * 0.02, 0.006, 2).translate(0, 0, f.W / 2 + 0.002), f), mat('wood', shade(ctx.palette.primary, -0.12)));
  b.add(place(rbox(f.L * 0.22, 0.014, 0.022, 0.006, 2).translate(0, 0, f.W / 2 + 0.018), f), mat('chrome'));
}

function frameBar(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx), r = Math.min(f.H, f.W) * 0.3;
  b.add(place(rbox(f.L, f.H, f.W, r, 3), f), frameMat(ctx));
  const n = Math.max(1, Math.round(f.L / 0.4) * 0 + 2); for (const g of boltRow(n, f.L * 0.8, Math.max(0.01, Math.min(f.H, f.W) * 0.25), 'z')) b.add(place(g.translate(0, 0, f.W / 2), f), mat('steelMachined'));
}

export const furnitureFamily: Family = {
  category: 'furniture', archetypes: ['chair', 'table', 'sofa', 'bed', 'shelf', 'stool'],
  keywords: /\b(chair|table|desk|sofa|couch|bed|shelf|bookcase|stool|cabinet|wardrobe|seat|leg|cushion|armchair|bench|cadeira|mesa|sof[aá]|cama|estante|banco|gaveta|pata|perna|assento|encosto)\b/i,
  archetypeOf: (w) => (/sofa|sofá|couch/.test(w) ? 'sofa' : /bed|cama/.test(w) ? 'bed' : /shelf|estante|bookcase/.test(w) ? 'shelf' : /stool|banco/.test(w) ? 'stool' : /table|desk|mesa/.test(w) ? 'table' : 'chair'),
  roles: [
    { role: 'leg', words: /leg|foot|pata|p[eé]|perna|post/i }, { role: 'top', words: /tabletop|table top|desk top|top|tampo|worktop/i }, { role: 'seat', words: /seat|cushion|assento|almofada/i },
    { role: 'backrest', words: /back|encosto|headboard/i }, { role: 'arm', words: /arm/i }, { role: 'drawer', words: /drawer|door|gaveta|porta/i }, { role: 'shelf', words: /shelf|prateleira/i },
    { role: 'frame', words: /frame|stretcher|rail|apron|base|estrutura|travess/i },
  ],
  params: (archetype) => [
    choiceSpec('finish', 'Upholstery / surface', ['fabric', 'leather', 'wood', 'metal', 'plastic'], archetype === 'table' || archetype === 'shelf' ? 'wood' : 'fabric', 'Material semantic of soft surfaces'),
    choiceSpec('frame', 'Frame', ['wood', 'metal'], 'wood', 'Leg and frame material'), choiceSpec('legStyle', 'Leg style', ['tapered', 'round', 'square'], 'tapered', 'Leg profile'),
    numSpec('puff', 'Cushion puff', 0, 0.06, 0.025, 0.005, 'Bulge of soft surfaces (m)'), numSpec('edgeRadius', 'Edge radius', 0.002, 0.04, 0.012, 0.002, 'Slab edge rounding (m)'), numSpec('slats', 'Backrest slats', 2, 8, 4, 1, 'Slats when the back is rigid'),
    choiceSpec('topFinish', 'Table top', ['wood', 'ceramic', 'plastic', 'metal'], 'wood', 'Finish of tops'),
  ],
  style: () => ({}),
  materialOf: (role, palette, params) => (role === 'leg' || role === 'frame' ? (params.frame === 'metal' ? mat('steelBrushed') : mat('wood', palette.secondary)) : surface(String(params.finish ?? 'fabric'), palette)),
  build(role, ctx) {
    const b = new Bucket();
    if (role === 'leg') leg(ctx, b); else if (role === 'seat') seat(ctx, b); else if (role === 'top' || role === 'shelf') slab(ctx, b, role === 'top' ? 'top' : 'shelf');
    else if (role === 'backrest') backrest(ctx, b); else if (role === 'arm') slab(ctx, b, 'arm'); else if (role === 'drawer') drawer(ctx, b); else frameBar(ctx, b);
    void thinAxis; void (null as ParamValue | null);
    return b;
  },
  detailRules: (role) => ({ leg: ['tapered turned leg', 'foot pad'], seat: ['pillowed cushion', 'frame base', 'piping seam'], top: ['bevelled slab', 'apron'], backrest: ['pillowed back or slats', 'tufting seams'], drawer: ['recessed panel', 'handle'], frame: ['rounded rail', 'joint fasteners'], shelf: ['bevelled board'] } as Record<string, string[]>)[role] ?? ['rounded slab'],
};
