import { BufferGeometry, Path, Vector3 } from 'three';
import { Bucket, extrudeProfile, latheAxis, merge, plateWithOpenings, rbox, type Opening } from '../ops';
import { mat, type MaterialSpec } from '../materials';
import { shade } from '../recipe';
import type { Family, PartContext } from './types';
import { choiceSpec, frameOf, num, numSpec, place, str, toFrame } from './common';

/** Architectural structures: walls with openings cut where windows and doors sit (or inferred from a parameter), glazing in frames, pitched or flat roofs, columns, slabs with joints. */
const wallMat = (ctx: PartContext): MaterialSpec => { const m = str(ctx, 'walls', 'plaster'); return m === 'concrete' ? mat('concrete') : m === 'brick' ? mat('concrete', ctx.own ?? '#9C5B45', 'brick') : mat('paintedWall', ctx.own ?? ctx.palette.primary); };

function wall(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx), openings: Opening[] = [];
  for (const s of ctx.siblings.filter((x) => x.role === 'window' || x.role === 'door')) {
    const c = toFrame(ctx, f, s.centre), w = Math.max(s.size.x, s.size.z), h = s.size.y;
    if (Math.abs(c.x) < f.L / 2 + w / 2 && Math.abs(c.z) < f.W + Math.min(s.size.x, s.size.z) && Math.abs(c.y) < f.H / 2) openings.push({ x: c.x, y: c.y, w: Math.min(w, f.L * 0.9), h: Math.min(h, f.H * 0.9), r: 0.01 });
  }
  const wanted = Math.round(num(ctx, 'windows', 0));
  if (!openings.length && wanted > 0 && f.L > 1.2 && f.H > 1.2) for (let i = 0; i < wanted; i++) openings.push({ x: -f.L * 0.35 + (i + 0.5) * ((f.L * 0.7) / wanted), y: f.H * 0.08, w: Math.min(1, (f.L * 0.7) / wanted * 0.6), h: f.H * 0.32, r: 0.01 });
  const g = plateWithOpenings(f.L, f.H, f.W, openings, Math.min(0.02, f.W * 0.1)).translate(0, 0, -f.W / 2); b.add(place(g, f), wallMat(ctx));
  b.add(place(rbox(f.L * 1.002, f.H * 0.025, f.W * 1.015, 0.006, 1).translate(0, -f.H / 2 + f.H * 0.012, 0), f), mat('concrete'));
  b.add(place(rbox(f.L * 1.002, f.H * 0.02, f.W * 1.02, 0.006, 1).translate(0, f.H / 2 - f.H * 0.01, 0), f), mat('concrete', '#B9B8B2'));
}
function windowPart(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx), t = Math.min(f.L, f.H) * 0.06, cols = Math.max(1, Math.round(num(ctx, 'mullions', 2)));
  const frame = [rbox(f.L, t, f.W, 0.004, 1).translate(0, f.H / 2 - t / 2, 0), rbox(f.L, t, f.W, 0.004, 1).translate(0, -f.H / 2 + t / 2, 0), rbox(t, f.H, f.W, 0.004, 1).translate(-f.L / 2 + t / 2, 0, 0), rbox(t, f.H, f.W, 0.004, 1).translate(f.L / 2 - t / 2, 0, 0)];
  for (let i = 1; i < cols; i++) frame.push(rbox(t * 0.6, f.H, f.W * 0.8, 0.003, 1).translate(-f.L / 2 + (i * f.L) / cols, 0, 0));
  b.add(place(merge(frame), f), mat('paintedMetal', '#F2F1EC'));
  b.add(place(rbox(f.L - t * 2, f.H - t * 2, f.W * 0.1, 0.002, 1), f), mat('glass'));
  b.add(place(rbox(f.L * 1.12, t * 0.9, f.W * 1.7, 0.006, 1).translate(0, -f.H / 2 - t * 0.2, f.W * 0.4), f), mat('concrete', '#B9B8B2'));
}
function doorPart(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx);
  b.add(place(rbox(f.L, f.H, f.W, 0.01, 2), f), mat('wood', ctx.palette.secondary));
  for (const [x, y] of [[-0.22, 0.2], [0.22, 0.2], [-0.22, -0.2], [0.22, -0.2]] as Array<[number, number]>) b.add(place(rbox(f.L * 0.34, f.H * 0.34, f.W * 0.15, 0.008, 1).translate(x * f.L, y * f.H, f.W / 2), f), mat('wood', shade(ctx.palette.secondary, -0.12)));
  b.add(place(rbox(0.04, 0.04, 0.05, 0.015, 3).translate(f.L * 0.38, 0, f.W / 2 + 0.02), f), mat('chrome'));
}
function roof(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx), style = str(ctx, 'roof', ctx.archetype === 'house' ? 'gable' : 'flat'), m = mat('concrete', str(ctx, 'roofColour', '#6B4A3F'), 'tile');
  if (style === 'flat') { b.add(place(rbox(f.L, f.H * 0.6, f.W, 0.02, 2).translate(0, -f.H * 0.2, 0), f), mat('concrete', '#8E8F8B')); b.add(place(rbox(f.L, f.H * 0.4, f.W, 0.015, 1).translate(0, f.H * 0.3, 0).scale(1, 1, 1), f), mat('paintedWall', ctx.own ?? ctx.palette.primary)); return; }
  const h = f.H, w = f.W;
  const prof: Array<[number, number]> = [[-w / 2, -h / 2], [0, h / 2], [w / 2, -h / 2], [w / 2 - 0.05, -h / 2], [0, h / 2 - 0.06], [-w / 2 + 0.05, -h / 2]];
  const g = extrudeProfile(prof.map(([z, y]) => [z, y] as [number, number]), f.L, 0.01).translate(0, 0, -f.L / 2).rotateY(Math.PI / 2);
  b.add(place(g, f), m);
  const tiles: BufferGeometry[] = []; const rows = Math.max(3, Math.round(h / 0.18));
  for (let i = 1; i < rows; i++) for (const s of [-1, 1]) { const t = i / rows; tiles.push(rbox(f.L * 1.01, 0.012, 0.02, 0.004, 1).translate(0, -h / 2 + t * h * 0.97, s * (w / 2) * (1 - t) + s * 0.012).rotateX(0)); }
  b.add(place(merge(tiles), f), mat('concrete', shade(str(ctx, 'roofColour', '#6B4A3F'), -0.2), 'tile'));
  b.add(place(rbox(f.L * 1.01, 0.07, 0.1, 0.03, 3).translate(0, h / 2, 0), f), mat('concrete', shade(str(ctx, 'roofColour', '#6B4A3F'), -0.3), 'ridge'));
}
function column(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx), r = Math.min(f.L, f.W) / 2, h = f.H, e = (y: number) => y * h - h / 2;
  const prof: Array<[number, number]> = [[0.001, e(0)], [r * 1.25, e(0)], [r * 1.25, e(0.03)], [r * 1.05, e(0.04)], [r * 0.9, e(0.07)], [r * 0.82, e(0.5)], [r * 0.78, e(0.9)], [r * 0.9, e(0.92)], [r * 1.15, e(0.94)], [r * 1.25, e(0.97)], [r * 1.25, e(1)], [0.001, e(1)]];
  b.add(place(latheAxis(prof, 'y', ctx.lod.seg(32, 12)), f), mat('concrete', '#C9C5BA', 'stone'));
}
function slab(ctx: PartContext, b: Bucket): void {
  const f = frameOf(ctx); b.add(place(rbox(f.L, f.H, f.W, Math.min(0.02, f.H * 0.3), 3), f), mat('concrete'));
  const joints = Math.max(1, Math.round(f.L / 1.5)); for (let i = 1; i < joints; i++) b.add(place(rbox(0.01, 0.004, f.W * 0.998, 0.001, 1).translate(-f.L / 2 + (i * f.L) / joints, f.H / 2, 0), f), mat('trim'));
}

export const architectureFamily: Family = {
  category: 'architecture', archetypes: ['house', 'tower', 'pavilion'],
  keywords: /\b(house|home|building|tower|pavilion|wall|roof|facade|door|window|column|pillar|floor|slab|chimney|casa|edif[ií]cio|torre|parede|telhado|janela|porta|coluna|pilar|fachada|laje)\b/i,
  archetypeOf: (w) => (/tower|torre|skyscraper/.test(w) ? 'tower' : /pavilion|pavilh[aã]o|gazebo/.test(w) ? 'pavilion' : 'house'),
  roles: [{ role: 'window', words: /window|janela|glazing/i }, { role: 'door', words: /door|porta/i }, { role: 'roof', words: /roof|telhado|cobertura/i }, { role: 'column', words: /column|pillar|coluna|pilar/i }, { role: 'wall', words: /wall|parede|facade|fachada/i }, { role: 'slab', words: /floor|slab|foundation|base|laje|piso|funda/i }],
  params: (a) => [choiceSpec('walls', 'Wall finish', ['plaster', 'concrete', 'brick'], 'plaster', 'Wall surface'), choiceSpec('roof', 'Roof', ['gable', 'flat'], a === 'house' ? 'gable' : 'flat', 'Roof form'), numSpec('windows', 'Inferred windows per wall', 0, 6, 0, 1, 'Openings added to a wall when the plan names no window (inferred, not read from the plan)'), numSpec('mullions', 'Window panes', 1, 4, 2, 1, 'Panes across a window')],
  style: () => ({}),
  materialOf: (role, palette) => (role === 'window' ? mat('glass') : role === 'roof' ? mat('concrete', '#6B4A3F', 'tile') : role === 'column' || role === 'slab' ? mat('concrete') : mat('paintedWall', palette.primary)),
  build(role, ctx) { const b = new Bucket(); if (role === 'wall') wall(ctx, b); else if (role === 'window') windowPart(ctx, b); else if (role === 'door') doorPart(ctx, b); else if (role === 'roof') roof(ctx, b); else if (role === 'column') column(ctx, b); else slab(ctx, b); void Path; void Vector3; return b; },
  detailRules: (r) => ({ wall: ['openings cut where windows and doors sit', 'plinth and cornice'], window: ['frame and mullions', 'glazing', 'sill'], door: ['panelled leaf', 'handle'], roof: ['pitched section', 'tile courses', 'ridge cap'], column: ['base, tapering shaft, capital'], slab: ['bevelled edge', 'expansion joints'] } as Record<string, string[]>)[r] ?? ['solid'],
};
