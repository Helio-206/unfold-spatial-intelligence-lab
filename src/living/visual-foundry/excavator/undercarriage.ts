/**
 * Tracked undercarriage display geometry for canonical part `chassis` (frame: ground at y = 0, swing axis at the
 * `swing_axis` point). Illustrative proportions chosen to sit inside the canonical chassis envelope; not manufacturer data.
 *
 * Track loop: sprocket (rear, driven) and idler (front) joined by straight top and bottom runs. Shoes, links and pin
 * bushings are placed by arc length along that loop so pitch is uniform and nothing floats.
 */
import { CylinderGeometry, Shape } from 'three';
import { boss, chaikin, extrudeZ, extrudeY, flipWinding, hexBolt, latheZ, m4, merge, rbox, shapeFrom, type P2, PartBuilder } from '../geometry';
import type { CanonicalView } from './canonical';

export const TRACK = {
  gaugeZ: 1.08, shoeWidth: 0.6, pinLineBottomY: 0.09, pinLineTopY: 0.8,
  sprocket: { x: -1.33 }, idler: { x: 1.36 }, shoeOffset: [0.03, 0.055, 0.088] as const,
} as const;

type LoopSample = { p: [number, number]; t: [number, number]; n: [number, number] };

/** Stadium loop through sprocket and idler, counter-clockwise seen from +Z (outward normal n). */
export function trackLoop() {
  const r = (TRACK.pinLineTopY - TRACK.pinLineBottomY) / 2, cy = TRACK.pinLineBottomY + r;
  const xs = TRACK.sprocket.x, xi = TRACK.idler.x, straight = xi - xs;
  const length = 2 * straight + 2 * Math.PI * r;
  const at = (s: number): LoopSample => {
    let u = ((s % length) + length) % length;
    if (u < straight) return { p: [xs + u, TRACK.pinLineBottomY], t: [1, 0], n: [0, -1] };            // bottom run, moving +X
    u -= straight;
    if (u < Math.PI * r) { const a = -Math.PI / 2 + u / r; return { p: [xi + r * Math.cos(a), cy + r * Math.sin(a)], t: [-Math.sin(a), Math.cos(a)], n: [Math.cos(a), Math.sin(a)] }; }
    u -= Math.PI * r;
    if (u < straight) return { p: [xi - u, TRACK.pinLineTopY], t: [-1, 0], n: [0, 1] };              // top run, moving -X
    u -= straight;
    const a = Math.PI / 2 + u / r;
    return { p: [xs + r * Math.cos(a), cy + r * Math.sin(a)], t: [-Math.sin(a), Math.cos(a)], n: [Math.cos(a), Math.sin(a)] };
  };
  return { radius: r, centerY: cy, length, at };
}

function shoeGeometry(pitch: number, width: number) {
  const [o0, o1, o2] = TRACK.shoeOffset; // plate inner face, plate outer face, grouser tip (outward offsets from the pin line)
  const h = pitch / 2 - 0.004;
  // Profile in (tangent, outward): plate plus a single grouser bar, with chamfered leading and trailing edges.
  const prof: P2[] = [[-h, o0], [h, o0], [h + 0.004, o1 - 0.008], [h * 0.42, o1], [h * 0.3, o2], [-h * 0.05, o2], [-h * 0.2, o1], [-h - 0.004, o1 - 0.008]];
  const g = extrudeZ(shapeFrom(prof), width, 0, 0.006, 4);
  return g;
}

export function buildUndercarriage(view: CanonicalView): PartBuilder {
  const b = new PartBuilder('chassis');
  const loop = trackLoop();
  const swingY = view.point('chassis', 'swing_axis')[1];
  const pitch0 = 0.2, count = Math.round(loop.length / pitch0), pitch = loop.length / count;

  for (const side of [-1, 1] as const) {
    const z0 = side * TRACK.gaugeZ;
    // --- shoes, links, pin bushings, shoe bolts
    const shoes = [], links = [], bushes = [], bolts = [];
    for (let i = 0; i < count; i++) {
      const s = loop.at((i + 0.5) * pitch);
      const ang = Math.atan2(s.t[1], s.t[0]);
      // shoe frame: x tangent, y outward normal (for a CCW loop, outward = tangent rotated -90°)
      const rot = ang; // rotating local +X onto the tangent; local +Y then points inward, so the shoe profile is mirrored below
      const shoe = shoeGeometry(pitch, TRACK.shoeWidth); shoe.scale(1, -1, 1); flipWinding(shoe); shoe.applyMatrix4(m4([s.p[0], s.p[1], z0], rot));
      shoes.push(shoe);
      for (const lz of [-0.13, 0.13]) {
        const link = rbox(pitch * 0.98, 0.085, 0.04, 0.012); link.applyMatrix4(m4([s.p[0] - s.n[0] * 0.012, s.p[1] - s.n[1] * 0.012, z0 + lz], rot)); links.push(link);
      }
      const pinS = loop.at(i * pitch);
      const bush = boss(0.03, 0.34, 0.004, 14); bush.applyMatrix4(m4([pinS.p[0] - pinS.n[0] * 0.012, pinS.p[1] - pinS.n[1] * 0.012, z0])); bushes.push(bush);
      for (const bz of [-0.2, 0.2]) for (const bx of [-0.03, 0.03]) {
        // head sits on the shoe's inner face (local -y is outward), pointing into the loop
        const bolt = hexBolt(0.016); bolt.translate(bx, -TRACK.shoeOffset[0], bz);
        bolt.applyMatrix4(m4([s.p[0], s.p[1], z0], rot)); bolts.push(bolt);
      }
    }
    b.add(merge(shoes), 'shoe').add(merge(links), 'castDark').add(merge(bushes), 'machined').add(merge(bolts), 'brushed');

    // --- sprocket (rear): toothed rim plates, hub and the final-drive housing on the inner side
    const rs = loop.radius - 0.035, teeth = 21;
    const sp: P2[] = [];
    for (let k = 0; k < teeth; k++) {
      const a0 = (k / teeth) * Math.PI * 2, da = (Math.PI * 2) / teeth;
      sp.push([Math.cos(a0) * (rs - 0.02), Math.sin(a0) * (rs - 0.02)], [Math.cos(a0 + da * 0.3) * (rs + 0.035), Math.sin(a0 + da * 0.3) * (rs + 0.035)], [Math.cos(a0 + da * 0.5) * (rs + 0.04), Math.sin(a0 + da * 0.5) * (rs + 0.04)], [Math.cos(a0 + da * 0.7) * (rs + 0.035), Math.sin(a0 + da * 0.7) * (rs + 0.035)]);
    }
    const sprocketShape = shapeFrom(sp);
    const hole = new Shape(); hole.absarc(0, 0, rs * 0.55, 0, Math.PI * 2, true); sprocketShape.holes.push(hole);
    for (const dz of [-0.05, 0.05]) b.add(extrudeZ(sprocketShape, 0.035, z0 + dz, 0.004, 6), 'castDark', m4([TRACK.sprocket.x, loop.centerY, 0]));
    b.add(latheZ([[0, -0.11], [rs * 0.58, -0.11], [rs * 0.62, -0.08], [rs * 0.62, 0.08], [rs * 0.58, 0.11], [0, 0.11]], 48), 'castDark', m4([TRACK.sprocket.x, loop.centerY, z0]));
    // final drive (motor housing) on the inner side, with a bolt circle
    const inner = -side;
    b.add(latheZ([[0, 0], [0.27, 0], [0.29, 0.03], [0.29, 0.16], [0.24, 0.2], [0.13, 0.22], [0, 0.22]], 48), 'castDark', m4([TRACK.sprocket.x, loop.centerY, z0 + inner * 0.1], 0, inner > 0 ? 0 : Math.PI));
    const ring = [];
    for (let k = 0; k < 12; k++) { const a = (k / 12) * Math.PI * 2; const bolt = hexBolt(0.016); bolt.rotateX(side * Math.PI / 2); bolt.translate(Math.cos(a) * rs * 0.48, Math.sin(a) * rs * 0.48, z0 + side * 0.11); ring.push(bolt); }
    b.add(merge(ring), 'brushed', m4([TRACK.sprocket.x, loop.centerY, 0]));

    // --- idler (front): flanged wheel with a central guide rib
    b.add(latheZ([[0, -0.13], [0.2, -0.13], [loop.radius - 0.05, -0.12], [loop.radius - 0.045, -0.035], [loop.radius - 0.012, -0.03], [loop.radius - 0.012, 0.03], [loop.radius - 0.045, 0.035], [loop.radius - 0.05, 0.12], [0.2, 0.13], [0, 0.13]], 56), 'castDark', m4([TRACK.idler.x, loop.centerY, z0]));
    b.add(boss(0.08, 0.36, 0.01, 24), 'machined', m4([TRACK.idler.x, loop.centerY, z0]));

    // --- bottom rollers (5) and carrier rollers (2): double flanged, on the link rails
    const rollerProfile = (r: number, w: number): P2[] => [[0, -w / 2], [r + 0.02, -w / 2], [r + 0.025, -w / 2 + 0.03], [r, -w / 2 + 0.04], [r, -0.04], [r - 0.01, -0.03], [r - 0.01, 0.03], [r, 0.04], [r, w / 2 - 0.04], [r + 0.025, w / 2 - 0.03], [r + 0.02, w / 2], [0, w / 2]];
    const linkInner = 0.0425 + 0.012;
    for (let k = 0; k < 5; k++) {
      const x = -0.92 + (k * 1.84) / 4, r = 0.1;
      b.add(latheZ(rollerProfile(r, 0.34), 40), 'castDark', m4([x, TRACK.pinLineBottomY + linkInner + r, z0]));
      b.add(boss(0.035, 0.42, 0.006, 16), 'machined', m4([x, TRACK.pinLineBottomY + linkInner + r, z0]));
    }
    for (const x of [-0.45, 0.5]) {
      const r = 0.072;
      b.add(latheZ(rollerProfile(r, 0.28), 36), 'castDark', m4([x, TRACK.pinLineTopY - linkInner - r, z0]));
      // carrier roller bracket from the track frame
      b.add(rbox(0.07, 0.03, 0.07, 0.008), 'paintDark', m4([x, 0.6, z0 + inner * 0.12]));
    }

    // --- track frame: a closed box beam with slanted ends, roller guards and the idler yoke
    const frameProfile: P2[] = chaikin([[-1.02, 0.34], [1.08, 0.34], [1.2, 0.45], [1.08, 0.56], [-0.95, 0.56], [-1.1, 0.47]], 1);
    b.add(extrudeZ(shapeFrom(frameProfile), 0.4, z0, 0.02), 'paintDark');
    b.add(extrudeZ(shapeFrom([[-1.0, 0.31], [1.02, 0.31], [1.02, 0.35], [-1.0, 0.35]]), 0.46, z0, 0.006), 'paintDark'); // lower flange
    b.add(extrudeZ(shapeFrom([[-0.92, 0.56], [1.02, 0.56], [1.0, 0.59], [-0.9, 0.59]]), 0.42, z0, 0.006), 'paintDark'); // top cover plate
    // roller guard plates (outer side), with seams between sections
    for (let k = 0; k < 3; k++) {
      const x0 = -0.98 + k * 0.67;
      b.add(extrudeZ(shapeFrom([[x0, 0.24], [x0 + 0.64, 0.24], [x0 + 0.64, 0.4], [x0, 0.4]]), 0.02, z0 + side * 0.215, 0.004), 'paintDark');
    }
    // idler yoke and recoil housing
    b.add(rbox(0.36, 0.14, 0.3, 0.02), 'paintDark', m4([TRACK.idler.x - 0.2, loop.centerY, z0]));
    b.add(latheZ([[0, 0], [0.07, 0], [0.07, 0.5], [0, 0.5]], 24), 'paintDark', m4([TRACK.idler.x - 0.4, loop.centerY - 0.02, z0 + 0.0], 0, -Math.PI / 2));
    // frame bolts on top cover
    const fb = [];
    for (let k = 0; k < 9; k++) for (const dz of [-0.16, 0.16]) { const bolt = hexBolt(0.014); bolt.translate(-0.85 + k * 0.22, 0.59, z0 + dz); fb.push(bolt); }
    b.add(merge(fb), 'brushed');
  }

  // --- car body: central frame between the track frames, X-shaped legs, swing bearing
  const body: P2[] = chaikin([[-0.9, -0.62], [0.9, -0.62], [1.0, -0.4], [1.0, 0.4], [0.9, 0.62], [-0.9, 0.62], [-1.0, 0.4], [-1.0, -0.4]], 1);
  b.add(extrudeY(body, 0.42, swingY - 0.12, 0.03), 'paintDark');
  for (const side of [-1, 1]) {
    // legs (sloped box beams) joining the body to each track frame
    for (const x of [-0.62, 0.62]) {
      const leg = extrudeZ(shapeFrom([[x - 0.2, 0.36], [x + 0.2, 0.36], [x + 0.16, 0.66], [x - 0.16, 0.66]]), 0.5, 0, 0.015);
      b.add(leg, 'paintDark', m4([0, 0, side * (TRACK.gaugeZ - 0.2 - 0.25 - 0.1) + side * 0.2]));
    }
  }
  // swing bearing: outer race with gear ring and a bolt circle, inner race to the upper structure
  const bearingR = 0.78;
  b.add(latheZ([[bearingR - 0.1, 0], [bearingR, 0], [bearingR + 0.01, 0.01], [bearingR + 0.01, 0.07], [bearingR, 0.08], [bearingR - 0.1, 0.08]], 72), 'machined', m4([0, swingY - 0.12, 0], 0, 0, -Math.PI / 2));
  b.add(latheZ([[bearingR - 0.22, 0], [bearingR - 0.1, 0], [bearingR - 0.1, 0.12], [bearingR - 0.22, 0.12]], 72), 'castDark', m4([0, swingY - 0.12, 0], 0, 0, -Math.PI / 2));
  const br = [];
  for (let k = 0; k < 36; k++) { const a = (k / 36) * Math.PI * 2; const bolt = hexBolt(0.014); bolt.translate(Math.cos(a) * (bearingR - 0.05), swingY - 0.04, Math.sin(a) * (bearingR - 0.05)); br.push(bolt); }
  b.add(merge(br), 'brushed');
  // centre swivel joint (hydraulic rotary coupling) visible under the deck
  b.add(latheZ([[0, 0], [0.12, 0], [0.12, 0.2], [0.08, 0.24], [0, 0.24]], 32), 'castDark', m4([0, swingY - 0.36, 0], 0, 0, -Math.PI / 2));
  return b;
}

// Kept for builders that need a plain cylinder along Y.
export const yCylinder = (r: number, h: number, seg = 24) => new CylinderGeometry(r, r, h, seg);
