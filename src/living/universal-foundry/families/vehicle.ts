import { BufferGeometry, CylinderGeometry, Quaternion, TorusGeometry, Vector3 } from 'three';
import { Bucket, at, boltCircle, grille, latheAxis, loftSections, merge, rbox, v3, type Section } from '../ops';
import { mat } from '../materials';
import { shade } from '../recipe';
import type { Family, PartContext } from './types';
import { boolSpec, choiceSpec, flag, frameOf, num, numSpec, place, placeAt, thinAxis, toFrame } from './common';

/** Passenger vehicles: a lofted hull from sections, a glazed greenhouse, wheels with tyre/rim/spokes, lamps, grille, bumpers, door seams. Dimensions come from the plan. */
const ARCHETYPES: Record<string, { cabinStart: number; cabinEnd: number; cabinHeight: number; rearSlope: number; doors: string }> = {
  sedan: { cabinStart: 0.22, cabinEnd: 0.68, cabinHeight: 0.34, rearSlope: 0.45, doors: '4' },
  hatchback: { cabinStart: 0.12, cabinEnd: 0.66, cabinHeight: 0.38, rearSlope: 0.7, doors: '4' },
  suv: { cabinStart: 0.1, cabinEnd: 0.72, cabinHeight: 0.4, rearSlope: 0.9, doors: '4' },
  coupe: { cabinStart: 0.24, cabinEnd: 0.64, cabinHeight: 0.3, rearSlope: 0.3, doors: '2' },
  van: { cabinStart: 0.06, cabinEnd: 0.82, cabinHeight: 0.5, rearSlope: 1, doors: '4' },
};
const gr = (L: number, t: number) => -L / 2 + t * L; // t = 0 at the rear, 1 at the nose (+X is forward)

/** Hull sections: [t, bottom lift, top fraction, width fraction] relative to the hull height. */
const HULL: Array<[number, number, number, number]> = [[0, 0.2, 0.7, 0.88], [0.03, 0.1, 0.9, 0.96], [0.1, 0, 0.97, 1], [0.35, 0, 1, 1], [0.7, 0, 1, 1], [0.9, 0, 0.94, 1], [0.97, 0.06, 0.82, 0.96], [1, 0.2, 0.62, 0.86]];

function hull(L: number, hullH: number, W: number, y0: number): BufferGeometry {
  const sections: Section[] = HULL.map(([t, lo, hi, w]) => ({ x: gr(L, t), y: y0 + ((lo + hi) / 2) * hullH, z: 0, h: (hi - lo) * hullH, w: w * W, p: 5.5 }));
  return loftSections(sections, 36, 40);
}

/** Roof/glass volume sitting on the beltline. */
function greenhouse(L: number, cabH: number, W: number, belt: number, start: number, end: number, slope: number): { glass: BufferGeometry; roof: BufferGeometry; pillars: BufferGeometry[] } {
  const rear = start + (end - start) * (0.3 - 0.22 * slope), tailFall = start;
  const at4 = (t: number, hFrac: number, wFrac: number, p = 3.2): Section => ({ x: gr(L, t), y: belt + (cabH * hFrac) / 2 - 0.004, z: 0, h: cabH * hFrac, w: W * wFrac, p });
  const mid = (start + end) / 2;
  const glassSecs = [at4(tailFall, 0.18, 0.86), at4(rear, 0.9, 0.78), at4(mid - 0.04, 1, 0.74), at4(mid + 0.1, 1, 0.74), at4(end - 0.1, 0.62, 0.78), at4(end, 0.12, 0.86)];
  const glass = loftSections(glassSecs, 28, 50);
  const roofSecs = [rear + 0.04, mid - 0.04, mid + 0.1, end - 0.1].map((t, i) => ({ x: gr(L, t), y: belt + cabH * (i === 0 || i === 3 ? 0.9 : 1) - 0.012 + 0.01, z: 0, h: 0.03 + cabH * 0.06, w: W * (i === 0 || i === 3 ? 0.7 : 0.76), p: 4 }));
  const roof = loftSections(roofSecs, 24, 50);
  const pillars: BufferGeometry[] = [];
  const side = (zs: number) => {
    // pillars follow the glass edges: A up the windscreen rake, C up the rear glass, B vertical between the doors
    const bar = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, t: number) => { const a = v3(x0, y0, z0), b = v3(x1, y1, z1), d = b.clone().sub(a); return rbox(t, d.length(), t * 0.8, t * 0.3, 2).applyQuaternion(new Quaternion().setFromUnitVectors(v3(0, 1, 0), d.normalize())).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2); };
    pillars.push(bar(gr(L, end - 0.004), belt + cabH * 0.04, zs * W * 0.415, gr(L, end - 0.1), belt + cabH * 0.6, zs * W * 0.3, 0.05), bar(gr(L, tailFall + 0.004), belt + cabH * 0.04, zs * W * 0.415, gr(L, rear), belt + cabH * 0.86, zs * W * 0.3, 0.07), bar(gr(L, mid + 0.02), belt, zs * W * 0.385, gr(L, mid + 0.02), belt + cabH * 0.93, zs * W * 0.3, 0.05));
  };
  side(1); side(-1);
  return { glass, roof, pillars };
}

function buildHull(ctx: PartContext, bucket: Bucket, withCabin: boolean): void {
  const f = frameOf(ctx), { L, H, W } = f, arch = ctx.archetype in ARCHETYPES ? ARCHETYPES[ctx.archetype]! : ARCHETYPES.sedan!;
  const paint = mat('paintedMetal', ctx.palette.primary), trim = mat('trim'), chrome = mat('chrome');
  const cabRatio = withCabin ? num(ctx, 'cabinHeight', arch.cabinHeight) : 0;
  const hullH = H * (1 - cabRatio), y0 = -H / 2;
  const P = (g: BufferGeometry) => place(g, f);
  bucket.add(P(hull(L, hullH, W, y0)), paint);
  const belt = y0 + hullH;
  if (withCabin) {
    const gh = greenhouse(L, H * cabRatio, W, belt, num(ctx, 'cabinStart', arch.cabinStart), num(ctx, 'cabinEnd', arch.cabinEnd), num(ctx, 'rearSlope', arch.rearSlope));
    bucket.add(P(gh.glass), mat('glass')).add(P(gh.roof), paint);
    for (const p of gh.pillars) bucket.add(P(p), mat('trim'));
    // door mirrors at the base of the A pillar
    for (const s of [1, -1]) { bucket.add(P(rbox(0.1, 0.075, 0.13, 0.025, 3).translate(gr(L, num(ctx, 'cabinEnd', arch.cabinEnd) - 0.02), belt + 0.06, s * (W / 2 + 0.06))), paint); }
  }
  // lower sill and bumpers: structural parts of the hull, in trim
  bucket.add(P(rbox(L * 0.62, 0.05, W * 1.0, 0.02, 2).translate(0, y0 + 0.035, 0)), trim);
  bucket.add(P(rbox(0.14, hullH * 0.26, W * 0.9, 0.04, 3).translate(L / 2 - 0.04, y0 + hullH * 0.2, 0)), mat('plastic', shade(ctx.palette.primary, -0.5)));
  bucket.add(P(rbox(0.14, hullH * 0.24, W * 0.88, 0.04, 3).translate(-L / 2 + 0.05, y0 + hullH * 0.2, 0)), mat('plastic', shade(ctx.palette.primary, -0.5)));
  // door seams (cut lines) and handles
  const doors = String(ctx.params.doors ?? arch.doors), seams = doors === '2' ? [0.5] : [0.36, 0.52, 0.72];
  for (const t of seams) for (const s of [1, -1]) bucket.add(P(rbox(0.008, hullH * 0.6, 0.006, 0.002, 1).translate(gr(L, t), y0 + hullH * 0.58, s * (W / 2 - 0.004))), trim);
  for (const t of doors === '2' ? [0.58] : [0.46, 0.66]) for (const s of [1, -1]) bucket.add(P(rbox(0.13, 0.022, 0.018, 0.008, 2).translate(gr(L, t), y0 + hullH * 0.86, s * (W / 2 - 0.002))), chrome);
  // headlights, grille, tail lights, plate, all in the nose/tail planes
  for (const s of [1, -1]) {
    bucket.add(P(rbox(0.07, hullH * 0.17, W * 0.2, 0.025, 3).translate(L / 2 - 0.02, y0 + hullH * 0.74, s * W * 0.34)), mat('glass', '#C9D3DC'));
    bucket.add(P(rbox(0.05, hullH * 0.09, W * 0.13, 0.018, 3).translate(L / 2 - 0.005, y0 + hullH * 0.74, s * W * 0.34)), mat('emissive'));
    bucket.add(P(rbox(0.05, hullH * 0.14, W * 0.17, 0.02, 3).translate(-L / 2 + 0.02, y0 + hullH * 0.72, s * W * 0.37)), mat('emissive', '#B3121B', 'tail'));
  }
  const slats = Math.round(num(ctx, 'grilleSlats', 5));
  bucket.add(P(rbox(0.04, hullH * 0.22, W * 0.4, 0.015, 2).translate(L / 2 - 0.005, y0 + hullH * 0.46, 0)), trim);
  for (const g of grille(W * 0.36, hullH * 0.17, slats, 0.02, 'horizontal')) bucket.add(P(g.rotateY(Math.PI / 2).translate(L / 2 + 0.006, y0 + hullH * 0.46, 0)), chrome);
  bucket.add(P(rbox(0.012, 0.11, 0.3, 0.004, 1).translate(-L / 2 + 0.005, y0 + hullH * 0.34, 0)), mat('plasticGloss', '#F2F0E6'));
  // wheel arches from the neighbouring wheels (never invented when the plan has none)
  if (flag(ctx, 'wheelArches', true)) for (const w of ctx.siblings.filter((s) => s.role === 'wheel')) {
    const p = toFrame(ctx, f, w.centre), dims = [w.size.x, w.size.y, w.size.z].sort((a, b) => b - a), R = (dims[1]! / 2) * 1.13;
    for (const s of [1, -1]) { const side = Math.sign(p.z) === s ? 1 : 0; if (!side && Math.abs(p.z) > 1e-3) continue; bucket.add(P(new TorusGeometry(R, Math.min(R * 0.035, 0.015), 8, 28, Math.PI).translate(p.x, p.y, s * (W / 2 - 0.004))), trim); }
    if (Math.abs(p.z) <= 1e-3) for (const s of [1, -1]) bucket.add(P(new TorusGeometry(R, Math.min(R * 0.035, 0.015), 8, 28, Math.PI).translate(p.x, p.y, s * (W / 2 - 0.004))), trim);
  }
}

function wheel(ctx: PartContext, bucket: Bucket): void {
  const axle = thinAxis(ctx), dims = [ctx.size.x, ctx.size.y, ctx.size.z].sort((a, b) => b - a), R = dims[1]! / 2, w = Math.min(dims[2]!, R * 1.2), Rr = R * num(ctx, 'rimRatio', 0.62);
  const lod = ctx.lod, seg = lod.seg(48, 16), spokes = Math.round(num(ctx, 'spokes', 5));
  const orient = axle === 'x' ? at(0, 0, 0, 0, Math.PI / 2, 0) : axle === 'y' ? at(0, 0, 0, Math.PI / 2, 0, 0) : at();
  const into = (g: BufferGeometry) => g.applyMatrix4(orient).applyMatrix4(at(ctx.centre.x, ctx.centre.y, ctx.centre.z));
  // tyre: sidewall bulge, shoulder, tread with circumferential grooves
  const half = w / 2, tread: Array<[number, number]> = [];
  const grooves = [-0.62, -0.2, 0.2, 0.62];
  tread.push([R * 0.985, -half * 0.8]);
  for (let i = 0; i <= 12; i++) { const a = -0.8 + (1.6 * i) / 12, groove = grooves.some((g) => Math.abs(a - g) < 0.07); tread.push([R * (groove ? 0.975 : 1), half * a]); }
  tread.push([R * 0.985, half * 0.8]);
  const tyre: Array<[number, number]> = [[Rr * 1.02, -half * 0.75], [Rr * 1.22, -half * 0.96], [R * 0.9, -half * 0.97], ...tread, [R * 0.9, half * 0.97], [Rr * 1.22, half * 0.96], [Rr * 1.02, half * 0.75], [Rr * 0.96, half * 0.6], [Rr * 0.96, -half * 0.6], [Rr * 1.02, -half * 0.75]];
  bucket.add(into(latheAxis(tyre, 'z', seg)), mat('rubber'));
  const rimMat = mat('paintedMetal', '#C4C8CE');
  for (const flip of [1, -1]) {
  const F = (g: BufferGeometry) => (flip < 0 ? g.rotateX(Math.PI) : g);
  bucket.add(into(F(latheAxis([[0.01, half * 0.8], [Rr * 0.32, half * 0.82], [Rr * 0.55, half * 0.7], [Rr * 0.94, half * 0.62], [Rr * 1.0, half * 0.8], [Rr * 1.03, half * 0.5], [Rr * 0.96, half * 0.2], [Rr * 0.9, 0], [0.01, 0]].reverse() as Array<[number, number]>, 'z', seg))), rimMat);
  for (let i = 0; i < spokes; i++) { const a = (i / spokes) * Math.PI * 2, s = rbox(Rr * 0.8, Rr * 0.17, half * 0.28, Rr * 0.05, 2).translate(Rr * 0.5, 0, half * 0.8).applyMatrix4(at(0, 0, 0, 0, 0, a)); bucket.add(into(F(s)), rimMat); }
  bucket.add(into(F(latheAxis([[0.01, half * 0.93], [Rr * 0.26, half * 0.93], [Rr * 0.3, half * 0.78]].reverse() as Array<[number, number]>, 'z', 24))), mat('chrome'));
  for (const b of boltCircle(spokes, Rr * 0.2, Math.max(0.012, R * 0.03), 'z')) bucket.add(into(F(b.translate(0, 0, half * 0.92))), mat('chrome'));
  }
  bucket.add(into(new CylinderGeometry(Rr * 0.78, Rr * 0.78, half * 0.25, 40).rotateX(Math.PI / 2).translate(0, 0, 0)), mat('steelBrushed', '#5B5E63'));
}

function lamp(ctx: PartContext, bucket: Bucket, tail: boolean): void {
  const f = frameOf(ctx); const lens = tail ? mat('emissive', '#B3121B', 'tail') : mat('emissive');
  bucket.add(place(rbox(f.L, f.H, f.W, Math.min(f.L, f.H, f.W) * 0.3, 3), f), mat('glass', tail ? '#701018' : '#C9D3DC'));
  bucket.add(place(rbox(f.L * 0.6, f.H * 0.6, f.W * 0.6, Math.min(f.L, f.H, f.W) * 0.2, 3).translate(f.L * 0.12, 0, 0), f), lens);
}

function panelPart(ctx: PartContext, bucket: Bucket, kind: 'door' | 'bumper' | 'generic'): void {
  const f = frameOf(ctx), r = Math.min(f.L, f.H, f.W) * 0.18, bumper = kind === 'bumper';
  bucket.add(place(rbox(f.L, f.H, f.W, r, 4), f), bumper ? mat('plastic', shade(ctx.palette.primary, -0.5)) : mat('paintedMetal', ctx.palette.primary));
  if (kind === 'door') {
    bucket.add(place(rbox(f.L * 0.8, f.H * 0.3, f.W * 0.2, 0.01, 2).translate(0, f.H * 0.32, f.W * 0.4), f), mat('glass'));
    bucket.add(place(rbox(f.L * 0.18, f.H * 0.04, f.W * 0.04, 0.01, 2).translate(f.L * 0.2, f.H * 0.08, f.W * 0.5), f), mat('chrome'));
  }
}

export const vehicleFamily: Family = {
  category: 'vehicle', archetypes: Object.keys(ARCHETYPES),
  keywords: /\b(car|sedan|suv|hatch|coupe|van|truck|vehicle|automobile|carro|automovel|autom[oó]vel|camioneta|pickup|wheel|tyre|tire|roda|pneu|chassis|windshield|bumper)\b/i,
  archetypeOf: (words, facts) => (/suv|jipe|crossover/.test(words) ? 'suv' : /hatch/.test(words) ? 'hatchback' : /coupe|coupé|sport/.test(words) ? 'coupe' : /van|minibus|carrinha/.test(words) ? 'van' : facts.size.y / Math.max(facts.size.x, facts.size.z) > 0.42 ? 'suv' : 'sedan'),
  roles: [
    { role: 'wheel', words: /wheel|tyre|tire|roda|pneu|rim/i }, { role: 'lamp', words: /headlight|head lamp|farol|lamp|light|luz/i }, { role: 'window', words: /window|windshield|glass|vidro|janela|pára-brisas|parabrisas/i },
    { role: 'bumper', words: /bumper|para-?choque/i }, { role: 'door', words: /door|porta/i }, { role: 'cabin', words: /cabin|cabine|greenhouse|roof|teto|habit[aá]culo/i },
    { role: 'body', words: /body|chassis|carroceria|corpo|hull|shell|carro\b|car\b|vehicle/i },
  ],
  params: (archetype) => { const a = ARCHETYPES[archetype] ?? ARCHETYPES.sedan!; return [
    numSpec('cabinHeight', 'Cabin height', 0.2, 0.55, a.cabinHeight, 0.01, 'Share of the overall height taken by the glazed cabin (inferred from the archetype)'),
    numSpec('cabinStart', 'Cabin start', 0.04, 0.4, a.cabinStart, 0.01, 'Where the rear glass begins along the length (0 = tail)'),
    numSpec('cabinEnd', 'Cabin end', 0.5, 0.9, a.cabinEnd, 0.01, 'Where the windscreen base sits along the length (1 = nose)'),
    numSpec('rearSlope', 'Rear slope', 0, 1, a.rearSlope, 0.05, '0 = notchback, 1 = upright tailgate'),
    numSpec('spokes', 'Wheel spokes', 3, 10, 5, 1, 'Spokes per rim'), numSpec('rimRatio', 'Rim ratio', 0.45, 0.8, 0.62, 0.01, 'Rim radius / tyre radius'),
    numSpec('grilleSlats', 'Grille slats', 2, 9, 5, 1, 'Horizontal slats in the front grille'), choiceSpec('doors', 'Doors', ['2', '4'], a.doors, 'Door count (cut lines)'), boolSpec('wheelArches', 'Wheel arches', true, 'Dark arches around the wheels the plan contains'),
  ]; },
  style: () => ({}),
  materialOf: (role, palette) => (role === 'wheel' ? mat('rubber') : role === 'window' ? mat('glass') : role === 'lamp' ? mat('emissive') : role === 'bumper' ? mat('plastic') : mat('paintedMetal', palette.primary)),
  build(role, ctx) {
    const b = new Bucket();
    if (role === 'body') buildHull(ctx, b, !ctx.siblings.some((s) => s.role === 'cabin'));
    else if (role === 'cabin') { const f = frameOf(ctx); const gh = greenhouse(f.L, f.H, f.W, -f.H / 2, 0.06, 0.94, num(ctx, 'rearSlope', 0.5)); b.add(place(gh.glass, f), mat('glass')).add(place(gh.roof, f), mat('paintedMetal', ctx.palette.primary)); for (const p of gh.pillars) b.add(place(p, f), mat('trim')); }
    else if (role === 'wheel') wheel(ctx, b);
    else if (role === 'lamp') lamp(ctx, b, ctx.centre.x < 0 === ctx.size.x >= ctx.size.z);
    else if (role === 'window') { const f = frameOf(ctx); b.add(place(rbox(f.L, f.H, f.W, Math.min(f.L, f.H, f.W) * 0.1, 3), f), mat('glass')); }
    else panelPart(ctx, b, role === 'door' ? 'door' : role === 'bumper' ? 'bumper' : 'generic');
    return b;
  },
  detailRules: (role) => ({ body: ['lofted hull', 'greenhouse glazing', 'roof panel and pillars', 'door cut lines and handles', 'headlights and tail lights', 'grille', 'bumpers', 'wheel arches from wheel siblings', 'mirrors'], wheel: ['tyre sidewall and grooved tread', 'machined rim', 'spokes', 'hub and lug bolts', 'brake disc'], cabin: ['glazing', 'roof', 'pillars'], lamp: ['lens', 'emissive core'], door: ['panel', 'window', 'handle'], window: ['glass'], bumper: ['moulded bumper'] } as Record<string, string[]>)[role] ?? ['rounded panel'],
};
void merge; void v3; void Vector3; void placeAt;
