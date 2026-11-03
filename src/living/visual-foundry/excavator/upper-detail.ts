/**
 * Visual-only refinement of the upper structure: cab and hood/counterweight detail that reads in the hero and articulated views.
 *
 * Everything here is added to the SAME `PartBuilder` as the rest of `upper_body`, in the part's own frame, so every detail moves with the canonical part and
 * is picked as `upper_body`. Nothing here is a physical shape: collision shapes, joints, constraints, the 13 canonical ids and the poses are untouched, and
 * no material key is added (existing keys only). Dimensions are illustrative, not manufacturer data; no brand, logo or text is represented.
 *
 * Budget: a few thousand triangles (see foundry.test.ts), made of small primitives merged per material by the PartBuilder.
 */
import { Path, Vector3 } from 'three';
import { extrudeY, extrudeZ, hexBolt, latheZ, m4, merge, pipe, rbox, shapeFrom, v2, type P2, type PartBuilder } from '../geometry';

export type UpperContext = {
  DECK: { y0: number; y1: number; xFront: number; xRear: number; z: number };
  CAB: { x0: number; x1: number; z0: number; z1: number; y0: number; yBelt: number; yRoof: number; yFloor: number };
  hoodX0: number; hoodX1: number; cwFront: number; cw: P2[];
  front: (y: number) => number; sideGlass: P2[]; cabZ: number; cabW: number;
};

/** small details: one bevel segment keeps triangles low (the default two multiplies the count several times) */
const rb = (w: number, h: number, d: number, r = 0.01) => rbox(w, h, d, r, 1);
const rectPath = (x0: number, y0: number, x1: number, y1: number): Path => { const p = new Path(); p.moveTo(x0, y0); p.lineTo(x0, y1); p.lineTo(x1, y1); p.lineTo(x1, y0); p.lineTo(x0, y0); return p; };
const grow = (points: P2[], d: number): P2[] => { const cx = points.reduce((s, p) => s + p[0], 0) / points.length; const cy = points.reduce((s, p) => s + p[1], 0) / points.length; return points.map(([x, y]) => { const l = Math.hypot(x - cx, y - cy) || 1; return [x + ((x - cx) / l) * d, y + ((y - cy) / l) * d]; }); };
const shrinkXZ = (points: P2[], d: number): P2[] => grow(points, -d);

export function addCabDetail(b: PartBuilder, c: UpperContext): void {
  const { CAB, front, sideGlass, cabZ } = c;
  // --- window frames with real thickness: a raised border around each side window (outer face), plus a flush inner lip
  for (const z of [CAB.z0, CAB.z1]) {
    const out = z < cabZ ? -1 : 1;
    b.add(extrudeZ(shapeFrom(grow(sideGlass, 0.05), [new Path(sideGlass.map(v2))]), 0.05, z + out * 0.012, 0.006), 'trim');
  }
  // --- door on the outer (z0) side: panel seams, hinge barrels, latch, sill step and grab handle
  const zo = CAB.z0 - 0.008; const dx0 = -0.2; const dx1 = 0.52;
  for (const x of [dx0, dx1]) b.add(rb(0.014, CAB.yBelt - CAB.y0 - 0.06, 0.012, 0.004), 'trim', m4([x, (CAB.yBelt + CAB.y0) / 2, zo]));
  for (const y of [CAB.y0 + 0.04, CAB.yBelt - 0.03]) b.add(rb(dx1 - dx0, 0.014, 0.012, 0.004), 'trim', m4([(dx0 + dx1) / 2, y, zo]));
  for (const y of [CAB.yBelt + 0.22, CAB.yBelt + 0.9, CAB.yRoof - 0.22]) b.add(latheZ([[0, 0], [0.018, 0], [0.018, 0.1], [0, 0.1]], 10), 'machined', m4([dx0 - 0.005, y - 0.05, zo - 0.012], 0, 0, Math.PI / 2));
  b.add(rb(0.12, 0.05, 0.02, 0.008), 'machined', m4([dx1 - 0.1, CAB.yBelt - 0.12, zo - 0.014])); // latch plate
  b.add(rb(0.5, 0.04, 0.12, 0.012), 'castDark', m4([0.15, CAB.y0 + 0.02, CAB.z0 - 0.06])); // sill step
  const grab = new Vector3(dx1 + 0.06, 0, CAB.z0 - 0.075);
  b.add(pipe([new Vector3(grab.x, CAB.yBelt + 0.05, grab.z), new Vector3(grab.x, CAB.yBelt + 0.95, grab.z)], 0.013, 4, 8), 'paintDark'); // functional grab handle (takes the accent colour)
  for (const y of [CAB.yBelt + 0.05, CAB.yBelt + 0.95]) b.add(rb(0.03, 0.03, 0.07, 0.008), 'castDark', m4([grab.x, y, CAB.z0 - 0.04]));
  // --- roof structure: raised ridges, visor over the windscreen, rear vent box, four work lights with lenses
  const roofY = CAB.yRoof + 0.12;
  for (const dz of [-0.28, 0, 0.28]) b.add(rb(front(CAB.yRoof) - CAB.x0 - 0.12, 0.022, 0.035, 0.008), 'trim', m4([(front(CAB.yRoof) + CAB.x0) / 2, roofY + 0.012, cabZ + dz]));
  b.add(rb(0.22, 0.022, c.cabW - 0.02, 0.01), 'trim', m4([front(CAB.yRoof) + 0.1, CAB.yRoof + 0.06, cabZ], -0.35)); // visor
  b.add(rb(0.3, 0.07, 0.4, 0.015), 'trim', m4([CAB.x0 + 0.2, roofY + 0.045, cabZ])); // rear vent box
  const slots = []; for (let k = 0; k < 4; k++) slots.push(rb(0.22, 0.008, 0.012, 0.003).translate(CAB.x0 + 0.2, roofY + 0.083, cabZ - 0.12 + k * 0.08)); b.add(merge(slots), 'steelTube');
  for (const [x, dz] of [[front(CAB.yRoof) - 0.05, -0.3], [front(CAB.yRoof) - 0.05, 0.3], [CAB.x0 + 0.1, -0.33], [CAB.x0 + 0.1, 0.33]] as const) {
    b.add(rb(0.1, 0.07, 0.12, 0.015), 'trim', m4([x, roofY + 0.05, cabZ + dz]));
    b.add(latheZ([[0, 0], [0.04, 0], [0.04, 0.012], [0, 0.012]], 16), 'chrome', m4([x + (x > 0 ? 0.052 : -0.052), roofY + 0.05, cabZ + dz], 0, Math.PI / 2 * (x > 0 ? 1 : -1)));
  }
  // --- headlamps on the cab's front corners (housing, lens, bracket) and a small mirror stay
  for (const z of [CAB.z0 + 0.1, CAB.z1 - 0.1]) {
    b.add(rb(0.1, 0.09, 0.14, 0.02), 'trim', m4([CAB.x1 + 0.03, CAB.yBelt + 0.1, z]));
    b.add(latheZ([[0, 0], [0.05, 0], [0.05, 0.012], [0, 0.012]], 20), 'chrome', m4([CAB.x1 + 0.085, CAB.yBelt + 0.1, z], 0, Math.PI / 2));
    b.add(rb(0.05, 0.03, 0.05, 0.008), 'castDark', m4([CAB.x1 - 0.02, CAB.yBelt + 0.04, z]));
  }
  // --- interior, simplified but readable through the glass: seat with back and headrest, armrests, console and monitor
  const sx = 0.3; const sy = CAB.yFloor;
  b.add(rb(0.46, 0.1, 0.46, 0.05), 'trim', m4([sx, sy + 0.32, cabZ]));
  b.add(rb(0.1, 0.55, 0.44, 0.05), 'trim', m4([sx - 0.2, sy + 0.62, cabZ], -0.14));
  b.add(rb(0.07, 0.15, 0.24, 0.03), 'trim', m4([sx - 0.24, sy + 0.98, cabZ], -0.14));
  for (const dz of [-0.27, 0.27]) b.add(rb(0.28, 0.04, 0.07, 0.015), 'trim', m4([sx + 0.02, sy + 0.5, cabZ + dz]));
  b.add(rb(0.1, 0.3, 0.16, 0.02), 'trim', m4([CAB.x1 - 0.2, sy + 0.55, CAB.z1 - 0.18], 0, 0.25)); // monitor
  b.add(rb(0.012, 0.22, 0.12, 0.004), 'chrome', m4([CAB.x1 - 0.147, sy + 0.55, CAB.z1 - 0.18], 0, 0.25)); // screen glare
  // --- cab skirt seam above the deck and a lip under the roof
  b.add(rb(CAB.x1 - CAB.x0, 0.016, 0.016, 0.005), 'trim', m4([(CAB.x1 + CAB.x0) / 2, CAB.yBelt + 0.01, CAB.z0 - 0.006]));
  b.add(rb(CAB.x1 - CAB.x0, 0.022, 0.03, 0.008), 'trim', m4([(CAB.x1 + CAB.x0) / 2, CAB.yRoof + 0.045, CAB.z0 - 0.03]));
}

export function addHoodDetail(b: PartBuilder, c: UpperContext): void {
  const { DECK, hoodX0, hoodX1, cw } = c; const L = hoodX1 - hoodX0; const sides = [-1, 1] as const;
  // --- side access panels: seams, hinges, handles, latches (both sides; the -z side is the one seen from the cab side)
  for (const s of sides) {
    const zf = s * 1.206;
    for (const x of [hoodX0 + L * 0.34, hoodX0 + L * 0.68]) b.add(rb(0.014, 0.78, 0.012, 0.004), 'trim', m4([x, 0.54, zf]));
    b.add(rb(L - 0.1, 0.014, 0.012, 0.004), 'trim', m4([hoodX0 + L / 2, 0.88, zf]));
    b.add(rb(L - 0.1, 0.014, 0.012, 0.004), 'trim', m4([hoodX0 + L / 2, 0.2, zf]));
    for (const x of [hoodX0 + L * 0.34, hoodX0 + L * 0.68]) for (const y of [0.3, 0.78]) b.add(latheZ([[0, 0], [0.016, 0], [0.016, 0.07], [0, 0.07]], 10), 'machined', m4([x - 0.025, y - 0.035, zf + s * 0.012], 0, 0, Math.PI / 2));
    for (const x of [hoodX0 + L * 0.5, hoodX0 + L * 0.86]) { b.add(rb(0.1, 0.03, 0.022, 0.008), 'machined', m4([x, 0.62, zf + s * 0.014])); b.add(rb(0.03, 0.05, 0.016, 0.006), 'brushed', m4([x + 0.07, 0.62, zf + s * 0.012])); }
    // panel bolts along the lower and upper seams
    const bolts = []; for (let k = 0; k < 9; k++) { const bolt = hexBolt(0.009); bolt.rotateX(s * Math.PI / 2); bolt.translate(hoodX0 + 0.12 + k * ((L - 0.24) / 8), 0.17, zf); bolts.push(bolt); } b.add(merge(bolts), 'brushed');
  }
  // --- ventilation grilles with depth (both sides): a dark recess, a protruding frame and inclined louvres that throw their own shadows
  for (const s of sides) {
    const zf = s * 1.206; const gx0 = hoodX0 + 0.1; const gx1 = hoodX0 + L * 0.31; const gy0 = 0.4; const gy1 = 0.84;
    b.add(rb(gx1 - gx0, gy1 - gy0, 0.01, 0.004), 'trim', m4([(gx0 + gx1) / 2, (gy0 + gy1) / 2, zf + s * 0.002]));
    const fins = []; for (let k = 0; k < 9; k++) { const f = rb(gx1 - gx0 - 0.04, 0.014, 0.05, 0.004); f.rotateX(s * 0.55); f.translate((gx0 + gx1) / 2, gy0 + 0.03 + k * ((gy1 - gy0 - 0.06) / 8), zf + s * 0.028); fins.push(f); } b.add(merge(fins), 'brushed');
    b.add(extrudeZ(shapeFrom([[gx0, gy0], [gx1, gy0], [gx1, gy1], [gx0, gy1]], [rectPath(gx0 + 0.02, gy0 + 0.02, gx1 - 0.02, gy1 - 0.02)]), 0.03, zf + s * 0.016, 0.004), 'paint');
  }
  // --- radiator region on the -z side: framed bay, dark core with fine vertical fins, fan ring and hub seen through a mesh
  {
    const s = -1; const zf = s * 1.206; const rx0 = hoodX0 + L * 0.74; const rx1 = hoodX1 - 0.07; const ry0 = 0.2; const ry1 = 0.86; const cx = (rx0 + rx1) / 2; const cy = (ry0 + ry1) / 2;
    b.add(rb(rx1 - rx0 - 0.04, ry1 - ry0 - 0.04, 0.012, 0.005), 'trim', m4([cx, cy, zf + s * 0.003]));
    const core = []; for (let k = 0; k < 18; k++) core.push(rb(0.008, ry1 - ry0 - 0.1, 0.014, 0.003).translate(rx0 + 0.04 + k * ((rx1 - rx0 - 0.08) / 17), cy, zf + s * 0.014)); b.add(merge(core), 'brushed');
    b.add(extrudeZ(shapeFrom([[rx0, ry0], [rx1, ry0], [rx1, ry1], [rx0, ry1]], [rectPath(rx0 + 0.025, ry0 + 0.025, rx1 - 0.025, ry1 - 0.025)]), 0.034, zf + s * 0.018, 0.006), 'paint');
    const rad = Math.min(rx1 - rx0, ry1 - ry0) * 0.34;
    b.add(latheZ([[rad * 0.82, 0], [rad, 0], [rad, 0.02], [rad * 0.82, 0.02]], 32), 'castDark', m4([cx, cy, zf + s * 0.036]));
    b.add(latheZ([[0, 0], [rad * 0.22, 0], [rad * 0.22, 0.03], [0, 0.03]], 20), 'castDark', m4([cx, cy, zf + s * 0.04]));
    const blades = []; for (let k = 0; k < 6; k++) { const bl = rb(rad * 0.7, 0.04, 0.008, 0.003); bl.translate(rad * 0.5, 0, 0); bl.rotateZ((k * Math.PI) / 3); bl.translate(cx, cy, zf + s * 0.034); blades.push(bl); } b.add(merge(blades), 'castDark');
    const bars = []; for (let k = 0; k < 7; k++) bars.push(rb(rx1 - rx0 - 0.05, 0.012, 0.01, 0.003).translate(cx, ry0 + 0.07 + k * ((ry1 - ry0 - 0.14) / 6), zf + s * 0.044)); b.add(merge(bars), 'trim');
  }
  // --- top: recessed grille bay under the existing slats, service hatch outline and a pair of lifting handles
  b.add(rb(0.8, 0.012, 0.56, 0.004), 'trim', m4([hoodX0 + 0.62, 1.073, 0]));
  b.add(rb(L - 0.2, 0.006, 0.01, 0.003), 'trim', m4([hoodX0 + L / 2, 1.078, 0.42]));
  b.add(rb(L - 0.2, 0.006, 0.01, 0.003), 'trim', m4([hoodX0 + L / 2, 1.078, -0.42]));
  for (const x of [hoodX0 + 0.3, hoodX1 - 0.3]) b.add(pipe([new Vector3(x, 1.07, -0.14), new Vector3(x, 1.12, -0.14), new Vector3(x, 1.12, 0.14), new Vector3(x, 1.07, 0.14)], 0.01, 12, 8), 'brushed');
  // --- counterweight: a dark seam filling the gap between the two cast blocks, bolt covers on the rear, a tow plate and a rear camera
  const seam = shrinkXZ(cw, 0.014); b.add(extrudeY(seam, 0.579, 0.601, 0), 'trim');
  const rear = []; for (const z of [-0.9, -0.45, 0.45, 0.9]) for (const y of [0.3, 0.9]) { const bolt = hexBolt(0.016); bolt.rotateZ(Math.PI / 2); bolt.translate(c.cwFront - 0.42 + 0.06, y, z); rear.push(bolt); } b.add(merge(rear), 'brushed');
  b.add(rb(0.04, 0.16, 0.3, 0.01), 'castDark', m4([c.cwFront - 0.44, 0.46, 0])); // tow plate
  b.add(rb(0.08, 0.06, 0.1, 0.015), 'trim', m4([c.cwFront - 0.3, 1.08, 0])); // rear camera housing
  b.add(latheZ([[0, 0], [0.022, 0], [0.022, 0.01], [0, 0.01]], 14), 'chrome', m4([c.cwFront - 0.345, 1.08, 0], 0, -Math.PI / 2));
  void DECK;
}
