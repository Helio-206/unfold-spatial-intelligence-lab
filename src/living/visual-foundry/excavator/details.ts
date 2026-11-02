/** Small shared mechanical details: pins with keeper plates, bolt rings, clamps, lug plates around a boss. */
import { Vector3 } from 'three';
import { boss, extrudeZ, hexBolt, hullWithCircles, latheZ, m4, merge, pipe, rbox, shapeFrom, type P2, type PartBuilder } from '../geometry';

/** A pin along Z through (x, y): machined shank, chamfered heads, keeper plate with two bolts on the +Z end. */
export function pin(b: PartBuilder, x: number, y: number, halfSpan: number, r = 0.055): void {
  b.add(boss(r, halfSpan * 2 + 0.03, 0.006, 28), 'machined', m4([x, y, 0]));
  b.add(latheZ([[0, 0], [r * 1.25, 0], [r * 1.3, 0.006], [r * 1.3, 0.02], [r * 1.2, 0.028], [0, 0.028]], 28), 'machined', m4([x, y, -halfSpan - 0.043]));
  b.add(rbox(r * 3.2, r * 1.5, 0.014, 0.004), 'brushed', m4([x, y, halfSpan + 0.022]));
  const bolts = [];
  for (const dx of [-r * 1.15, r * 1.15]) { const bolt = hexBolt(0.012); bolt.rotateX(Math.PI / 2); bolt.translate(x + dx, y, halfSpan + 0.029); bolts.push(bolt); }
  b.add(merge(bolts), 'brushed');
}

/** Lug plate pair (z = ±zOffset): the convex hull of the base points and a circle around the boss, so the plate
 *  reads as one forged lug; the boss runs through both plates. */
export function lugPair(b: PartBuilder, base: P2[], center: P2, radius: number, zOffset: number, thickness: number, material: 'paint' | 'paintDark' | 'castDark' = 'paint'): void {
  const s = shapeFrom(hullWithCircles(base, [[center, radius]]));
  for (const z of [-zOffset, zOffset]) b.add(extrudeZ(s, thickness, z, 0.006, 16), material);
  b.add(boss(radius * 0.92, zOffset * 2 + thickness + 0.012, 0.008, 32), 'castDark', m4([center[0], center[1], 0]));
}

/** Pipe clamp (bracket + band) at a point on a tube run, axis along the tube direction in XY. */
export function clamp(b: PartBuilder, x: number, y: number, z: number, angle: number, tubeR: number): void {
  b.add(rbox(0.035, tubeR * 2.6, tubeR * 2.6, 0.006), 'brushed', m4([x, y, z], angle));
  const bolt = hexBolt(0.008); bolt.translate(x, y + tubeR * 1.3, z); b.add(bolt, 'brushed');
}

/** A steel tube following a polyline in XY at a fixed z, with clamps every `every` metres. */
export function tubeRun(b: PartBuilder, points: P2[], z: number, r: number, every = 0.9): void {
  b.add(pipe(points.map(([x, y]) => new Vector3(x, y, z)), r, Math.max(24, points.length * 12), 10), 'steelTube');
  let acc = 0;
  for (let i = 1; i < points.length; i++) {
    const [x0, y0] = points[i - 1]!, [x1, y1] = points[i]!;
    const len = Math.hypot(x1 - x0, y1 - y0), angle = Math.atan2(y1 - y0, x1 - x0);
    for (let s = (every - acc) % every; s < len; s += every) { const t = s / len; clamp(b, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - r * 0.2, z, angle, r); }
    acc = (acc + len) % every;
  }
  // end fittings
  for (const [i, j] of [[0, 1], [points.length - 1, points.length - 2]] as const) {
    const p = points[i]!, q = points[j]!, angle = Math.atan2(p[1] - q[1], p[0] - q[0]);
    const fit = latheZ([[0, 0], [r * 1.6, 0], [r * 1.6, 0.03], [r * 1.3, 0.04], [r * 1.3, 0.06], [0, 0.06]], 6);
    fit.rotateY(Math.PI / 2); fit.applyMatrix4(m4([p[0], p[1], z], angle));
    b.add(fit, 'machined');
  }
}
