/**
 * Front attachment display geometry: boom, stick, bucket, the bucket linkage and the three hydraulic cylinders.
 * Every pin, lug and cylinder end is placed at a canonical point or joint origin from `unfold.assembly.v1`; plate
 * outlines, wall thicknesses and fittings are illustrative display detail.
 */
import { Path, Shape, Vector3 } from 'three';
import { boss, chaikin, extrudeZ, hexBolt, hullWithCircles, latheX, latheZ, m4, merge, pipe, rbox, shapeFrom, type P2, PartBuilder } from '../geometry';
import type { CanonicalView } from './canonical';
import { lugPair, pin, tubeRun } from './details';

const lerpTable = (xs: number[], ys: number[], x: number) => {
  if (x <= xs[0]!) return ys[0]!;
  for (let i = 1; i < xs.length; i++) if (x <= xs[i]!) { const t = (x - xs[i - 1]!) / (xs[i]! - xs[i - 1]!); return ys[i - 1]! + (ys[i]! - ys[i - 1]!) * t; }
  return ys[ys.length - 1]!;
};

/** Offset band along an open polyline (thickness t toward +normal of the path's left side). */
function band(points: P2[], t0: number, t1: number): P2[] {
  const n = points.length, left: P2[] = [], right: P2[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)]!, c = points[Math.min(n - 1, i + 1)]!;
    const dx = c[0] - a[0], dy = c[1] - a[1], l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    left.push([points[i]![0] + nx * t1, points[i]![1] + ny * t1]); right.push([points[i]![0] + nx * t0, points[i]![1] + ny * t0]);
  }
  return [...right, ...left.reverse()];
}

// ---------------------------------------------------------------------------------------------------------------- boom
export function buildBoom(view: CanonicalView): PartBuilder {
  const b = new PartBuilder('boom');
  const tip = view.pin('stick_joint');               // stick pivot on the boom
  const rodPin = view.point('boom', 'cyl_rod_pin');  // boom cylinder rod pin
  const stickBase = view.pin('stick_cyl_base');      // stick cylinder base pin
  const L = tip[0];
  // banana centreline (elbow ~47 % along) and depth table: welded box section, deepest at the elbow
  const elbowX = L * 0.47;
  const c = (x: number) => x < elbowX ? 0.25 * Math.sin((Math.PI / 2) * Math.max(0, x) / elbowX) : 0.25 * Math.cos((Math.PI / 2) * (x - elbowX) / (L - elbowX));
  const d = (x: number) => lerpTable([0, 0.7, elbowX, L * 0.78, L], [0.46, 0.6, 0.82, 0.58, 0.38], x);
  const xs: number[] = []; for (let i = 0; i <= 28; i++) xs.push(0.05 + ((L - 0.62) - 0.05) * (i / 28));
  const top = xs.map((x) => [x, c(x) + d(x) / 2] as P2), bot = xs.map((x) => [x, c(x) - d(x) / 2] as P2);
  const halfW = 0.2;
  // main body: side plates + webs as one closed section; rounded foot end around the canonical boom pivot (0, 0)
  const body = new Shape();
  body.moveTo(top[0]![0], top[0]![1]);
  for (const p of top) body.lineTo(p[0], p[1]);
  const endX = L - 0.6;
  body.lineTo(endX + 0.08, (c(endX) + d(endX) / 2) * 0.82); body.lineTo(endX + 0.08, (c(endX) - d(endX) / 2) * 0.82);
  for (const p of [...bot].reverse()) body.lineTo(p[0], p[1]);
  body.absarc(0, 0, 0.23, -Math.PI / 2, -Math.PI * 1.5, true);
  b.add(extrudeZ(body, halfW * 2, 0, 0.014, 24), 'paint');
  // top and bottom flange plates, a little wider than the webs (visible seam and shadow line)
  b.add(extrudeZ(shapeFrom(band(top.slice(3), 0, 0.024)), halfW * 2 + 0.03, 0, 0.005), 'paint');
  b.add(extrudeZ(shapeFrom(band(bot.slice(3), -0.024, 0)), halfW * 2 + 0.03, 0, 0.005), 'paint');
  // elbow doubler plates (reinforcement), slightly proud of each side
  const dbl = xs.filter((x) => x > L * 0.3 && x < L * 0.64);
  const dblShape = shapeFrom(chaikin([...dbl.map((x) => [x, c(x) + d(x) / 2 - 0.07] as P2), ...dbl.reverse().map((x) => [x, c(x) - d(x) / 2 + 0.07] as P2)], 1));
  b.addMirroredZ(extrudeZ(dblShape, 0.016, halfW + 0.008, 0), 'paint'); // flat plate, square edges: no rounded pillow
  // nose fork around the stick pivot (stick sits between the fork plates)
  const fork = shapeFrom(hullWithCircles([[endX - 0.1, c(endX) + d(endX) / 2 - 0.02], [endX - 0.1, c(endX) - d(endX) / 2 + 0.02]], [[tip, 0.2]]));
  b.addMirroredZ(extrudeZ(fork, 0.055, 0.19, 0.008, 24), 'paint');
  b.add(boss(0.19, 0.07, 0.008, 36), 'castDark', m4([tip[0], tip[1], 0.25]));
  b.add(boss(0.19, 0.07, 0.008, 36), 'castDark', m4([tip[0], tip[1], -0.25]));
  pin(b, tip[0], tip[1], 0.29, 0.065);
  // foot bushing (sits between the upper-structure foot plates)
  b.add(boss(0.215, halfW * 2 + 0.08, 0.01, 40, 0.07), 'castDark');
  // boom cylinder rod lugs under the boom, stick cylinder base lugs on top
  const bAt = (x: number) => c(x) - d(x) / 2, tAt = (x: number) => c(x) + d(x) / 2;
  lugPair(b, [[rodPin[0] - 0.4, bAt(rodPin[0] - 0.4) + 0.06], [rodPin[0] + 0.45, bAt(rodPin[0] + 0.45) + 0.06]], rodPin, 0.12, 0.105, 0.045, 'paint');
  pin(b, rodPin[0], rodPin[1], 0.135, 0.05);
  lugPair(b, [[stickBase[0] - 0.42, tAt(stickBase[0] - 0.42) - 0.06], [stickBase[0] + 0.4, tAt(stickBase[0] + 0.4) - 0.06]], stickBase, 0.11, 0.105, 0.045, 'paint');
  pin(b, stickBase[0], stickBase[1], 0.135, 0.05);
  // hydraulic tube runs on the top flange (two per side), with clamps and end fittings
  const run = (z: number, x0: number, x1: number, lift: number) => tubeRun(b, xs.filter((x) => x >= x0 && x <= x1).map((x) => [x, tAt(x) + 0.024 + lift] as P2), z, 0.019, 0.85);
  for (const s of [-1, 1]) { run(s * 0.165, 0.55, stickBase[0] - 0.5, 0.025); run(s * 0.205, 0.55, L - 0.75, 0.025); }
  // weld seam beads along the flange-to-web joints (thin, catch the light at grazing angles)
  for (const s of [-1, 1]) for (const line of [top, bot]) b.add(pipe(line.slice(3, -1).map(([x, y]) => new Vector3(x, y + (line === top ? -0.004 : 0.004), s * (halfW + 0.002))), 0.0045, 60, 6), 'paint');
  return b;
}

// --------------------------------------------------------------------------------------------------------------- stick
export function buildStick(view: CanonicalView): PartBuilder {
  const b = new PartBuilder('stick');
  const nose = view.pin('bucket_joint');             // bucket pin
  const tail = view.point('stick', 'cyl_rod_pin');   // stick cylinder rod pin
  const bktBase = view.pin('bucket_cyl_base');
  const idler = view.pin('idler_pivot');
  const halfW = 0.15;
  const outline: P2[] = chaikin([
    [-0.12, 0.27], [0.4, 0.3], [1.5, 0.22], [nose[0] - 0.25, 0.14], [nose[0] - 0.05, 0.12], [nose[0] + 0.1, 0.05],
    [nose[0] + 0.1, -0.06], [nose[0] - 0.1, -0.13], [idler[0] - 0.3, -0.24], [1.3, -0.33], [0.7, -0.42], [0.25, -0.45], [-0.12, -0.32],
  ], 2);
  b.add(extrudeZ(shapeFrom(outline), halfW * 2, 0, 0.014, 20), 'paint');
  // top/bottom wear plates
  const topLine = outline.filter((p) => p[1] > 0.13 && p[0] > 0.0 && p[0] < nose[0] - 0.3).sort((a, c) => a[0] - c[0]);
  if (topLine.length > 2) b.add(extrudeZ(shapeFrom(band(topLine, 0, 0.02)), halfW * 2 + 0.024, 0, 0.004), 'paint');
  // tail fork: two plates straddle the stick cylinder rod eye
  const forkShape = shapeFrom(hullWithCircles([[0.05, 0.27], [0.05, -0.3]], [[tail, 0.13]]));
  b.addMirroredZ(extrudeZ(forkShape, 0.05, halfW - 0.025, 0.008, 20), 'paint');
  b.add(boss(0.11, 0.06, 0.006, 32), 'castDark', m4([tail[0], tail[1], halfW + 0.01]));
  b.add(boss(0.11, 0.06, 0.006, 32), 'castDark', m4([tail[0], tail[1], -halfW - 0.01]));
  pin(b, tail[0], tail[1], halfW + 0.04, 0.05);
  // pivot bushing at the boom nose
  b.add(boss(0.17, halfW * 2 + 0.03, 0.008, 36, 0.065), 'castDark');
  // bucket cylinder base lugs under the stick, idler pivot and bucket pin bosses at the nose
  lugPair(b, [[bktBase[0] - 0.32, -0.36], [bktBase[0] + 0.35, -0.38]], bktBase, 0.11, 0.1, 0.045, 'paint');
  pin(b, bktBase[0], bktBase[1], 0.13, 0.05);
  b.add(boss(0.085, halfW * 2 + 0.02, 0.006, 28), 'castDark', m4([idler[0], idler[1], 0]));
  pin(b, idler[0], idler[1], 0.26, 0.045);
  b.add(boss(0.15, halfW * 2 + 0.01, 0.008, 36, 0.06), 'castDark', m4([nose[0], nose[1], 0]));
  pin(b, nose[0], nose[1], 0.2, 0.06);
  // side tube runs feeding the bucket cylinder (on both side faces), with clamps
  for (const s of [-1, 1]) tubeRun(b, [[-0.05, 0.12], [0.2, 0.05], [0.38, -0.2], [bktBase[0] - 0.02, -0.33]], s * (halfW + 0.03), 0.017, 0.3);
  // seams along the side plates
  for (const s of [-1, 1]) b.add(pipe(outline.filter((_, i) => i % 3 === 0 && outline[i]![1] > 0.1).map(([x, y]) => new Vector3(x, y - 0.006, s * (halfW + 0.002))), 0.004, 40, 6), 'paint');
  return b;
}

// -------------------------------------------------------------------------------------------------------------- bucket
export function buildBucket(view: CanonicalView): PartBuilder {
  const b = new PartBuilder('bucket');
  const tip = view.point('bucket', 'tip');
  const linkPin = view.point('bucket', 'link_pin');
  const halfW = view.bucketHalfWidthM(); const plate = 0.028; // the only source of the width: the contract's bucket-box (no second reference value)
  // back/bottom wrap from the top of the back to the cutting edge (cavity on the -normal side)
  // rounder heel than a box: the wrap bulges at the back and turns tightly into the cutting edge
  const wrap: P2[] = chaikin([[-0.16, 0.12], [0.34, 0.31], [0.92, 0.25], [1.3, 0.0], [1.43, -0.36], [1.4, -0.56], [tip[0] + 0.02, tip[1] + 0.02]], 2, false);
  const lip: P2 = [-0.3, -0.52];
  // side plates: wrap outline + mouth + top
  const side: P2[] = [...band(wrap, 0, plate).slice(0, wrap.length), [tip[0] - 0.02, tip[1] - 0.01], lip, [linkPin[0] - 0.05, linkPin[1] + 0.02], [-0.28, -0.02]];
  b.addMirroredZ(extrudeZ(shapeFrom(chaikin(side, 1)), 0.03, halfW - 0.015, 0.006, 20), 'paint');
  // wrap plate and top plate across the width, between the side plates
  b.add(extrudeZ(shapeFrom(band(wrap, -plate, 0)), (halfW - 0.03) * 2, 0, 0.004, 4), 'paint');
  const topLine: P2[] = [[-0.16, 0.12], [-0.26, -0.18], lip];
  b.add(extrudeZ(shapeFrom(band(chaikin(topLine, 2, false), 0, plate)), (halfW - 0.03) * 2, 0, 0.004, 4), 'paint');
  // lip reinforcement bar along the mouth top
  b.add(rbox(0.07, 0.07, halfW * 2 - 0.02, 0.012), 'paintDark', m4([lip[0] + 0.01, lip[1] + 0.01, 0], 0.4));
  // cutting edge: thick wear plate at the end of the wrap
  const edge = wrap.slice(-5);
  b.add(extrudeZ(shapeFrom(band(edge, -plate - 0.03, 0.005)), halfW * 2 - 0.02, 0, 0.004, 4), 'castDark');
  // teeth: adapters welded on the edge, separate replaceable tips
  const e0 = wrap[wrap.length - 2]!, e1 = wrap[wrap.length - 1]!;
  const dir = Math.atan2(e1[1] - e0[1], e1[0] - e0[0]);
  const ext = (k: number): [number, number] => [e1[0] + Math.cos(dir) * k, e1[1] + Math.sin(dir) * k];
  // adapter (welded nose) and a longer replaceable tip with a visible taper and a centre ridge, so teeth read at a distance
  const adapter: P2[] = [[-0.16, -0.05], [0.08, -0.04], [0.11, -0.028], [0.11, 0.03], [0.08, 0.04], [-0.16, 0.058]];
  const toothTip: P2[] = [[0, -0.036], [0.16, -0.016], [0.27, -0.004], [0.28, 0.004], [0.2, 0.016], [0.06, 0.03], [0, 0.034]];
  const teeth = Math.max(3, Math.round((halfW * 2 - 0.24) / 0.215) + 1); // five at the reference width, more on a wider bucket
  for (let k = 0; k < teeth; k++) {
    const z = -halfW + 0.12 + (k * (halfW * 2 - 0.24)) / (teeth - 1);
    const at = ext(0);
    b.add(extrudeZ(shapeFrom(adapter), 0.11, 0, 0.012, 2), 'castDark', m4([at[0], at[1], z], dir));
    const t0 = ext(0.1);
    b.add(extrudeZ(shapeFrom(toothTip), 0.095, 0, 0.012, 2), 'machined', m4([t0[0], t0[1], z], dir));
    b.add(boss(0.013, 0.125, 0.002, 10), 'brushed', m4([at[0] + Math.cos(dir) * 0.085, at[1] + Math.sin(dir) * 0.085, z]));
  }
  // side cutters at the front of the side plates
  for (const s of [-1, 1]) b.add(extrudeZ(shapeFrom([[0, -0.03], [0.22, -0.02], [0.24, 0.03], [0, 0.04]]), 0.04, s * (halfW + 0.006), 0.006), 'castDark', m4([e0[0] - Math.cos(dir) * 0.16, e0[1] - Math.sin(dir) * 0.16, 0], dir));
  // side-plate edge reinforcement along the mouth (tip → lip) and around the heel, a touch proud of the side plate
  const mouth: P2[] = [[tip[0] - 0.02, tip[1] - 0.01], [(tip[0] + lip[0]) / 2, (tip[1] + lip[1]) / 2 - 0.03], lip];
  b.addMirroredZ(extrudeZ(shapeFrom(band(mouth, -0.045, 0.0)), 0.03, halfW + 0.012, 0.005), 'castDark');
  b.addMirroredZ(extrudeZ(shapeFrom(band(wrap.slice(Math.floor(wrap.length * 0.45)), 0.0, 0.03)), 0.026, halfW - 0.004, 0.004), 'castDark');
  // wear strips on the outside of the wrap
  const strip = wrap.slice(2, -5);
  for (const z of [-halfW * 0.58, halfW * 0.58]) b.add(extrudeZ(shapeFrom(band(strip, 0.002, 0.016)), 0.05, z, 0.005), 'paint');
  // ears carrying the hinge pin (0, 0) and the link pin: plates straddle the stick nose
  const earShape = shapeFrom(hullWithCircles([[0.28, 0.27], [-0.18, 0.1], [-0.36, -0.46]], [[[0, 0], 0.16], [linkPin, 0.13]]));
  b.addMirroredZ(extrudeZ(earShape, 0.035, 0.175, 0.007, 24), 'paint');
  b.add(boss(0.12, 0.43, 0.008, 32, 0.06), 'castDark', m4([0, 0, 0]));
  b.add(boss(0.105, 0.43, 0.008, 32, 0.05), 'castDark', m4([linkPin[0], linkPin[1], 0]));
  pin(b, linkPin[0], linkPin[1], 0.24, 0.05);
  // a lifting eye on the back
  b.add(latheZ([[0.03, -0.015], [0.06, -0.015], [0.06, 0.015], [0.03, 0.015]], 20), 'castDark', m4([0.62, 0.3, 0], 0.3));
  return b;
}

// --------------------------------------------------------------------------------------------------------- linkage
export function buildIdlerLink(view: CanonicalView): PartBuilder {
  const b = new PartBuilder('idler_link');
  const end = view.point('idler_link', 'end');
  const plate = new Shape();
  const r0 = 0.075, r1 = 0.07, w = 0.045;
  plate.absarc(0, 0, r0, Math.PI / 2, Math.PI * 1.5, false);
  plate.lineTo(end[0] * 0.5, -w); plate.absarc(end[0], end[1], r1, -Math.PI / 2, Math.PI / 2, false); plate.lineTo(end[0] * 0.5, w);
  b.addMirroredZ(extrudeZ(plate, 0.03, 0.245, 0.006, 24), 'paint');
  b.add(boss(0.05, 0.56, 0.006, 24), 'machined', m4([end[0], end[1], 0])); // cross pin carrying the cylinder rod eye
  for (const z of [-0.27, 0.27]) b.add(latheZ([[0, 0], [0.06, 0], [0.065, 0.006], [0.065, 0.016], [0, 0.016]], 24), 'machined', m4([end[0], end[1], z], 0, z > 0 ? 0 : Math.PI));
  return b;
}

export function buildBucketLink(view: CanonicalView): PartBuilder {
  const b = new PartBuilder('bucket_link');
  const end = view.point('bucket_link', 'end');
  const plate = new Shape();
  plate.absarc(0, 0, 0.08, Math.PI / 2, Math.PI * 1.5, false);
  plate.lineTo(end[0] * 0.5, -0.058); plate.absarc(end[0], end[1], 0.08, -Math.PI / 2, Math.PI / 2, false); plate.lineTo(end[0] * 0.5, 0.058);
  const lightening = new Path(); lightening.absarc(end[0] * 0.5, 0, 0.025, 0, Math.PI * 2, true); plate.holes.push(lightening);
  b.addMirroredZ(extrudeZ(plate, 0.032, 0.21, 0.006, 24), 'paint');
  b.add(latheZ([[0, -0.2], [0.042, -0.2], [0.042, 0.2], [0, 0.2]], 24), 'paintDark', m4([end[0] * 0.5, 0.0, 0])); // H cross tube
  b.add(boss(0.055, 0.44, 0.006, 24), 'machined');
  return b;
}

// ----------------------------------------------------------------------------------------------------- cylinders
/**
 * Barrel and rod display meshes for one hydraulic cylinder. The pins are the canonical part origins; the closed length
 * comes from the slide joint. The display barrel follows the closed length (the fixture's collision cylinder is a
 * shorter envelope), and the rod's hidden inner end reaches deep enough to stay inside the barrel over the full stroke.
 */
export function buildCylinder(view: CanonicalView, actuatorId: string): { barrel: PartBuilder; rod: PartBuilder } {
  const cyl = view.cylinder(actuatorId);
  const barrel = new PartBuilder(cyl.actuator.barrelPartId);
  const rod = new PartBuilder(cyl.actuator.rodPartId);
  const R = cyl.barrelRadiusM, r = cyl.rodRadiusM, Lc = cyl.closedLengthM;
  const Lb = Lc - 0.24; // head face of the barrel (display)
  // base eye and tang
  barrel.add(boss(0.082, 0.15, 0.008, 32, 0.045), 'machined');
  barrel.add(latheX([[0, 0.04], [0.06, 0.04], [0.075, 0.12], [R * 1.08, 0.17], [R * 1.08, 0.24], [0, 0.24]], 40), 'machined');
  // tube (painted), base and head rings
  barrel.add(latheX([[0, 0.23], [R, 0.235], [R, Lb - 0.14], [0, Lb - 0.14]], 48), 'paintDark');
  barrel.add(latheX([[0, Lb - 0.15], [R * 1.12, Lb - 0.15], [R * 1.16, Lb - 0.13], [R * 1.16, Lb - 0.06], [R * 1.08, Lb - 0.05], [R * 1.08, Lb - 0.012], [r * 1.25, Lb], [0, Lb]], 48), 'machined');
  barrel.add(latheX([[r * 1.02, Lb - 0.004], [r * 1.22, Lb - 0.004], [r * 1.22, Lb + 0.012], [r * 1.02, Lb + 0.012]], 32), 'rubber'); // wiper seal
  const flange = [];
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2 + Math.PI / 8; const bolt = hexBolt(0.011); bolt.rotateZ(-Math.PI / 2); bolt.translate(Lb - 0.05, Math.cos(a) * R * 0.98, Math.sin(a) * R * 0.98); flange.push(bolt); }
  barrel.add(merge(flange), 'brushed');
  // ports and the rod-end steel tube along the top
  const portA = 0.34, portB = Lb - 0.22;
  for (const x of [portA, portB]) {
    barrel.add(rbox(0.07, 0.05, 0.075, 0.01), 'brushed', m4([x, R + 0.012, 0]));
    barrel.add(latheZ([[0, 0], [0.018, 0], [0.018, 0.035], [0.022, 0.04], [0.022, 0.06], [0, 0.06]], 12), 'machined', m4([x, R + 0.035, 0], 0, 0, -Math.PI / 2));
  }
  barrel.add(pipe([new Vector3(portB, R + 0.07, 0.035), new Vector3(portB - 0.08, R + 0.06, 0.05), new Vector3(portA + 0.12, R + 0.05, 0.05), new Vector3(portA + 0.06, R + 0.05, 0.05)], 0.012, 40, 8), 'steelTube');
  // rod: polished chrome shank, machined neck and eye at the canonical rod pin (part origin)
  rod.add(latheX([[0, -(Lc - 0.15)], [r, -(Lc - 0.15)], [r, -0.12], [0, -0.12]], 40), 'chrome');
  rod.add(latheX([[0, -0.125], [r * 1.12, -0.125], [r * 1.12, -0.07], [0.06, -0.05], [0, -0.05]], 32), 'machined');
  rod.add(boss(0.075, 0.13, 0.008, 32, 0.045), 'machined');
  rod.add(latheZ([[0, 0], [0.008, 0], [0.008, 0.02], [0, 0.02]], 8), 'brushed', m4([0, 0.075, 0], 0, 0, -Math.PI / 2)); // grease nipple
  return { barrel, rod };
}
