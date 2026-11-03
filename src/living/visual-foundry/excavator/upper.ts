/**
 * Rotating upper structure display geometry for canonical part `upper_body` (origin on the swing axis at the top of the
 * bearing). Boom foot and boom-cylinder base brackets are placed at the canonical joint origins `boom_joint` and
 * `boom_cyl_base`. Cab, hood, counterweight and compartments are illustrative, not manufacturer data.
 */
import { Path, Vector3 } from 'three';
import { chaikin, extrudeY, extrudeZ, hexBolt, latheZ, m4, merge, pipe, rbox, shapeFrom, v2, type P2, PartBuilder } from '../geometry';
import type { CanonicalView } from './canonical';
import { lugPair, pin } from './details';

const DECK = { y0: 0, y1: 0.12, xFront: 1.38, xRear: -1.42, z: 1.22 };
const CAB = { x0: -0.3, x1: 1.28, z0: -1.2, z1: -0.36, y0: DECK.y1, yBelt: 0.5, yRoof: 1.84, yFloor: 0.38 };

function rearArc(xFront: number, depth: number, halfWidth: number, steps = 14): P2[] {
  // a shallow elliptical rear: x = xFront - depth * sqrt(1 - (z / halfWidth)²), sampled from +z to -z
  const pts: P2[] = [];
  for (let i = 0; i <= steps; i++) {
    const z = halfWidth - (2 * halfWidth * i) / steps;
    pts.push([xFront - 0.18 - depth * Math.sqrt(Math.max(0, 1 - (z / (halfWidth + 0.04)) ** 2)), z]);
  }
  return pts;
}

export function buildUpperStructure(view: CanonicalView): PartBuilder {
  const b = new PartBuilder('upper_body');
  const foot = view.pin('boom_joint');
  const cylBase = view.pin('boom_cyl_base');

  // --- revolving frame deck, with the central channel for the boom foot
  const deck: P2[] = [[DECK.xRear, -DECK.z], [DECK.xFront, -DECK.z], [DECK.xFront, -0.32], [0.3, -0.32], [0.3, 0.32], [DECK.xFront, 0.32], [DECK.xFront, DECK.z], [DECK.xRear, DECK.z]];
  b.add(extrudeY(deck, DECK.y0, DECK.y1, 0.012), 'paintDark');
  // channel side walls (box section the boom foot plates rise from)
  for (const side of [-1, 1]) b.add(extrudeZ(shapeFrom([[0.3, -0.02], [DECK.xFront, -0.02], [DECK.xFront, DECK.y1 + 0.06], [0.3, DECK.y1 + 0.06]]), 0.04, side * 0.34, 0.006), 'paintDark');

  // --- counterweight: two cast blocks with a seam, elliptical rear
  const cwFront = DECK.xRear - 0.02;
  const cw: P2[] = [[cwFront, 1.2], [cwFront, -1.2], ...rearArc(cwFront, 0.42, 1.2).reverse()];
  b.add(extrudeY(cw, DECK.y1, 0.58, 0.035), 'paint');
  b.add(extrudeY(cw, 0.6, 1.05, 0.05), 'paint');
  for (const z of [-0.55, 0.55]) b.add(latheZ([[0.03, -0.012], [0.055, -0.012], [0.055, 0.012], [0.03, 0.012]], 20), 'castDark', m4([cwFront - 0.25, 1.09, z], 0, 0, 0)); // lifting eyes
  // rear lamps recessed in the counterweight face
  for (const z of [-0.85, 0.85]) b.add(rbox(0.03, 0.08, 0.16, 0.01), 'trim', m4([cwFront - 0.5 + 0.02, 0.85, z]));

  // --- engine hood module behind the cab, three top panels with controlled gaps, side grille
  const hoodX0 = cwFront, hoodX1 = CAB.x0 - 0.02;
  b.add(extrudeY([[hoodX0, -1.2], [hoodX1, -1.2], [hoodX1, 1.2], [hoodX0, 1.2]], DECK.y1, 0.97, 0.05), 'paint');
  for (const [z0, z1] of [[-1.19, -0.43], [-0.41, 0.41], [0.43, 1.19]] as const) b.add(extrudeY([[hoodX0 + 0.02, z0], [hoodX1 - 0.02, z0], [hoodX1 - 0.02, z1], [hoodX0 + 0.02, z1]], 0.975, 1.07, 0.015), 'paint');
  const topGrille = [];
  for (let k = 0; k < 11; k++) topGrille.push(rbox(0.035, 0.012, 0.5, 0.004).translate(hoodX0 + 0.25 + k * 0.065, 1.075, 0));
  b.add(merge(topGrille), 'trim');
  const slats = [];
  for (let k = 0; k < 9; k++) slats.push(rbox(0.05, 0.36, 0.012, 0.004).translate(hoodX0 + 0.18 + k * 0.1, 0.62, 1.205));
  b.add(merge(slats), 'trim');
  b.add(extrudeZ(shapeFrom([[hoodX0 + 0.12, 0.4], [hoodX0 + 1.06, 0.4], [hoodX0 + 1.06, 0.84], [hoodX0 + 0.12, 0.84]], [rectPath(hoodX0 + 0.14, 0.42, hoodX0 + 1.04, 0.82)]), 0.016, 1.2, 0.003), 'paint'); // grille frame
  // exhaust stack with rain cap, pre-cleaner
  b.add(pipe([new Vector3(-0.85, 1.05, 0.72), new Vector3(-0.85, 1.25, 0.72), new Vector3(-0.85, 1.42, 0.72)], 0.055, 8, 20), 'steelTube');
  b.add(latheZ([[0.05, 0], [0.075, 0], [0.075, 0.03], [0.05, 0.03]], 20), 'steelTube', m4([-0.85, 1.06, 0.72], 0, 0, -Math.PI / 2));
  b.add(rbox(0.14, 0.012, 0.13, 0.004), 'steelTube', m4([-0.82, 1.445, 0.72], 0.35));
  b.add(latheZ([[0, 0], [0.085, 0], [0.09, 0.02], [0.09, 0.16], [0.06, 0.2], [0.03, 0.2], [0.03, 0.26], [0, 0.26]], 28), 'trim', m4([-1.05, 1.07, -0.75], 0, 0, -Math.PI / 2));

  // --- right front compartment (tanks, tool box) with doors and a handrail
  const rc = { x0: CAB.x0, x1: 1.3, z0: 0.36, z1: 1.2, y1: 0.92 };
  b.add(extrudeY([[rc.x0, rc.z0], [rc.x1, rc.z0], [rc.x1, rc.z1], [rc.x0, rc.z1]], DECK.y1, rc.y1, 0.025), 'paint');
  for (const [x0, x1] of [[rc.x0 + 0.04, 0.48], [0.5, rc.x1 - 0.04]] as const) {
    b.add(extrudeZ(shapeFrom([[x0, 0.2], [x1, 0.2], [x1, 0.86], [x0, 0.86]]), 0.012, rc.z1 + 0.006, 0.003), 'paint');
    b.add(rbox(0.1, 0.022, 0.02, 0.006), 'trim', m4([x1 - 0.12, 0.7, rc.z1 + 0.018]));
  }
  b.add(latheZ([[0, 0], [0.07, 0], [0.07, 0.03], [0.05, 0.045], [0, 0.045]], 24), 'machined', m4([0.95, rc.y1, 0.8], 0, 0, -Math.PI / 2)); // fuel cap
  const rail = [new Vector3(rc.x1 - 0.05, rc.y1, rc.z1 - 0.06), new Vector3(rc.x1 - 0.05, rc.y1 + 0.32, rc.z1 - 0.06), new Vector3(0.4, rc.y1 + 0.34, rc.z1 - 0.06), new Vector3(-0.5, 1.07 + 0.34, rc.z1 - 0.06), new Vector3(-1.1, 1.07 + 0.34, rc.z1 - 0.06), new Vector3(-1.1, 1.07, rc.z1 - 0.06)];
  b.add(pipe(rail, 0.017, 80, 10), 'paintDark');
  b.add(pipe([new Vector3(0.4, rc.y1, rc.z1 - 0.06), new Vector3(0.4, rc.y1 + 0.34, rc.z1 - 0.06)], 0.015, 4, 10), 'paintDark');
  // access steps at the front corner
  for (const [y, x] of [[0.35, 1.36], [0.62, 1.34]] as const) b.add(rbox(0.16, 0.025, 0.3, 0.006), 'castDark', m4([x, y, 0.95]));

  // --- cab: lower body, slanted front pillars, roof, glazing with seals, interior seen through the glass
  const cabZ = (CAB.z0 + CAB.z1) / 2, cabW = CAB.z1 - CAB.z0;
  const front = (y: number) => CAB.x1 - ((y - CAB.yBelt) / (CAB.yRoof - CAB.yBelt)) * 0.2;
  b.add(extrudeZ(shapeFrom([[CAB.x0, CAB.y0], [CAB.x1 + 0.02, CAB.y0], [CAB.x1 + 0.03, CAB.yBelt], [CAB.x0, CAB.yBelt]]), cabW, cabZ, 0.03), 'paint');
  b.add(extrudeZ(shapeFrom(chaikin([[CAB.x0 - 0.03, CAB.yRoof], [front(CAB.yRoof) + 0.05, CAB.yRoof], [front(CAB.yRoof) - 0.04, CAB.yRoof + 0.11], [CAB.x0 + 0.05, CAB.yRoof + 0.12]], 1)), cabW + 0.04, cabZ, 0.025), 'paint');
  const pillar = (xa: number, ya: number, xb: number, yb: number, z: number) => {
    const len = Math.hypot(xb - xa, yb - ya), ang = Math.atan2(yb - ya, xb - xa);
    b.add(rbox(len + 0.04, 0.055, 0.055, 0.012), 'paintDark', m4([(xa + xb) / 2, (ya + yb) / 2, z], ang));
  };
  const zl = CAB.z0 + 0.03, zr = CAB.z1 - 0.03;
  for (const z of [zl, zr]) { pillar(front(CAB.yBelt), CAB.yBelt, front(CAB.yRoof), CAB.yRoof, z); pillar(CAB.x0 + 0.03, CAB.yBelt, CAB.x0 + 0.03, CAB.yRoof, z); }
  pillar(0.52, CAB.yBelt, 0.52, CAB.yRoof, zl); // door post
  // glazing: side windows (outline follows the slanted front), windshield, rear window; each with a rubber seal frame
  const sideGlass: P2[] = [[CAB.x0 + 0.06, CAB.yBelt + 0.03], [front(CAB.yBelt + 0.03) - 0.03, CAB.yBelt + 0.03], [front(CAB.yRoof - 0.03) - 0.03, CAB.yRoof - 0.03], [CAB.x0 + 0.06, CAB.yRoof - 0.03]];
  for (const z of [CAB.z0 + 0.005, CAB.z1 - 0.005]) {
    b.add(extrudeZ(shapeFrom(sideGlass), 0.01, z, 0.002), 'glass');
    b.add(extrudeZ(shapeFrom(offsetQuad(sideGlass, 0.02), [new Path(sideGlass.map(v2))]), 0.016, z + (z < cabZ ? -0.004 : 0.004), 0.002), 'trim');
  }
  const wsLen = Math.hypot(0.2, CAB.yRoof - CAB.yBelt) - 0.06, wsAng = Math.atan2(0.2, CAB.yRoof - CAB.yBelt);
  b.add(rbox(0.01, wsLen, cabW - 0.08, 0.003), 'glass', m4([(front(CAB.yBelt) + front(CAB.yRoof)) / 2 + 0.01, (CAB.yBelt + CAB.yRoof) / 2, cabZ], wsAng));
  b.add(rbox(0.01, CAB.yRoof - CAB.yBelt - 0.08, cabW - 0.08, 0.003), 'glass', m4([CAB.x0 - 0.004, (CAB.yBelt + CAB.yRoof) / 2, cabZ]));
  b.add(rbox(0.012, 0.42, 0.012, 0.004), 'trim', m4([front(CAB.yBelt + 0.3) + 0.02, CAB.yBelt + 0.3, cabZ + 0.15], wsAng)); // wiper
  // interior: seat, consoles, floor mat, rear wall (dark), visible through the glazing
  b.add(rbox(0.46, 0.1, 0.46, 0.04), 'interior', m4([0.32, CAB.yFloor + 0.3, cabZ]));
  b.add(rbox(0.1, 0.55, 0.44, 0.04), 'interior', m4([0.06, CAB.yFloor + 0.62, cabZ], -0.18));
  for (const dz of [-0.3, 0.3]) b.add(rbox(0.5, 0.2, 0.12, 0.02), 'trim', m4([0.45, CAB.yFloor + 0.28, cabZ + dz]));
  for (const dz of [-0.3, 0.3]) b.add(latheZ([[0, 0], [0.018, 0], [0.012, 0.16], [0.028, 0.18], [0.028, 0.24], [0, 0.25]], 12), 'trim', m4([0.62, CAB.yFloor + 0.38, cabZ + dz], 0, 0, -Math.PI / 2));
  b.add(rbox(0.04, CAB.yRoof - CAB.yBelt - 0.1, cabW - 0.12, 0.01), 'interior', m4([CAB.x0 + 0.04, (CAB.yBelt + CAB.yRoof) / 2, cabZ]));
  // door handle, mirror arm and mirror, roof work light
  b.add(rbox(0.022, 0.14, 0.025, 0.008), 'machined', m4([0.47, CAB.yBelt + 0.45, CAB.z0 - 0.015]));
  b.add(extrudeY([[CAB.x0 + 0.04, CAB.z0 + 0.04], [CAB.x1 - 0.04, CAB.z0 + 0.04], [CAB.x1 - 0.04, CAB.z1 - 0.04], [CAB.x0 + 0.04, CAB.z1 - 0.04]], CAB.y0, CAB.yFloor, 0.01), 'interior'); // floor
  b.add(pipe([new Vector3(CAB.x1 - 0.05, CAB.yBelt - 0.05, CAB.z0 + 0.02), new Vector3(CAB.x1 + 0.05, CAB.yBelt + 0.2, CAB.z0 - 0.12), new Vector3(CAB.x1 + 0.08, CAB.yBelt + 0.45, CAB.z0 - 0.16)], 0.01, 16, 8), 'paintDark');
  b.add(rbox(0.03, 0.2, 0.13, 0.012), 'trim', m4([CAB.x1 + 0.08, CAB.yBelt + 0.53, CAB.z0 - 0.16], 0, 0.3));
  b.add(latheZ([[0, 0], [0.05, 0], [0.055, 0.05], [0, 0.05]], 20), 'machined', m4([front(CAB.yRoof), CAB.yRoof + 0.09, cabZ - 0.25], 0, Math.PI / 2));

  // --- boom foot: twin plates rising from the channel around the canonical boom pivot, and the boom-cylinder base lugs
  lugPair(b, [[0.32, DECK.y1], [DECK.xFront - 0.02, DECK.y1], [DECK.xFront - 0.08, DECK.y1 + 0.18]], foot, 0.2, 0.275, 0.05, 'paint');
  pin(b, foot[0], foot[1], 0.31, 0.07);
  lugPair(b, [[cylBase[0] - 0.18, DECK.y1 - 0.02], [cylBase[0] + 0.2, DECK.y1 - 0.02]], cylBase, 0.1, 0.105, 0.035, 'paint');
  pin(b, cylBase[0], cylBase[1], 0.135, 0.045);
  // hydraulic supply blocks in the channel (where the boom hoses start), with bolts
  for (const z of [-0.2, 0.2]) {
    b.add(rbox(0.16, 0.08, 0.1, 0.01), 'brushed', m4([0.45, DECK.y1 + 0.06, z]));
    const bolts = [];
    for (const dx of [-0.05, 0.05]) { const bolt = hexBolt(0.01); bolt.translate(0.45 + dx, DECK.y1 + 0.1, z); bolts.push(bolt); }
    b.add(merge(bolts), 'brushed');
  }
  // deck perimeter bolts (cover plates)
  const db = [];
  for (let k = 0; k < 10; k++) { const bolt = hexBolt(0.011); bolt.translate(-1.25 + k * 0.17, DECK.y1, -1.16); db.push(bolt); }
  b.add(merge(db), 'brushed');
  return b;
}

function rectPath(x0: number, y0: number, x1: number, y1: number): Path {
  const p = new Path(); p.moveTo(x0, y0); p.lineTo(x0, y1); p.lineTo(x1, y1); p.lineTo(x1, y0); p.lineTo(x0, y0); return p;
}

/** Grows a convex quad outward by d (for seal frames around glazing). */
function offsetQuad(points: P2[], d: number): P2[] {
  const cx = points.reduce((s, p) => s + p[0], 0) / points.length, cy = points.reduce((s, p) => s + p[1], 0) / points.length;
  return points.map(([x, y]) => { const l = Math.hypot(x - cx, y - cy); return [x + ((x - cx) / l) * d * 1.4, y + ((y - cy) / l) * d * 1.4]; });
}
