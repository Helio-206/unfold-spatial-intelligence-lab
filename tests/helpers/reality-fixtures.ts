import { BoxGeometry, SphereGeometry, CylinderGeometry, BufferGeometry, Vector3 } from 'three';
import { makeView, rasterise, type Tri } from '../../src/universal-spatial/reconstruction/silhouette';
import { orbitDirection } from '../../src/universal-spatial/reconstruction/multiview';
import { FRAME_HALF_PER_DIAGONAL } from '../../src/living/reality/model';
import { encodeColour, encodeMask, type RealityEvidence } from '../../src/living/reality/evidence';

export const trisOf = (g: BufferGeometry, offset = new Vector3()): Tri[] => {
  const p = g.getAttribute('position'), idx = g.index, out: Tri[] = [], at = (i: number) => new Vector3(p.getX(i), p.getY(i), p.getZ(i)).add(offset), n = idx ? idx.count : p.count;
  for (let i = 0; i < n; i += 3) out.push(idx ? [at(idx.getX(i)), at(idx.getX(i + 1)), at(idx.getX(i + 2))] : [at(i), at(i + 1), at(i + 2)]);
  return out;
};
/** Asymmetric test solid: a block, a sphere off to one side and a pole below. A ground truth for algorithm tests only (never a real object). */
export const solid = (): Tri[] => [...trisOf(new BoxGeometry(1.2, 0.6, 0.5)), ...trisOf(new SphereGeometry(0.35, 24, 16), new Vector3(0.55, 0.4, 0.1)), ...trisOf(new CylinderGeometry(0.12, 0.12, 0.9, 16), new Vector3(-0.3, -0.5, -0.1))];
export const bboxOf = (tris: Tri[]) => { const mn = new Vector3(Infinity, Infinity, Infinity), mx = new Vector3(-Infinity, -Infinity, -Infinity); for (const t of tris) for (const p of t) { mn.min(p); mx.max(p); } return { mn, mx, c: mn.clone().add(mx).multiplyScalar(0.5), diag: mx.clone().sub(mn).length() }; };

/** Evidence built straight from rendered masks (known cameras), bypassing the photo intake. */
export function evidenceFromRenders(tris: Tri[], poses: Array<[number, number]>, opts: { res?: number; cells?: number; withColour?: boolean; source?: 'given' | 'assumed' } = {}): RealityEvidence {
  const b = bboxOf(tris), half = FRAME_HALF_PER_DIAGONAL * b.diag, res = opts.res ?? 128, colourRes = 32;
  return {
    contract: 'unfold.reality-evidence.v1', mode: 'orbit', res, colourRes, cells: opts.cells ?? 48, frame: { centre: [b.c.x, b.c.y, b.c.z], half },
    views: poses.map(([az, el], i) => {
      const mask = rasterise(tris, makeView(orbitDirection(az, el), b.c, half, res)), rgb = new Uint8Array(colourRes * colourRes * 3);
      for (let Y = 0; Y < colourRes; Y++) for (let X = 0; X < colourRes; X++) { const k = (Y * colourRes + X) * 3; rgb[k] = 200; rgb[k + 1] = 80 + (X * 3) % 100; rgb[k + 2] = 60; }
      return { id: `v${i + 1}`, name: `render-${az}-${el}`, azimuthDeg: az, elevationDeg: el, azimuthSource: opts.source ?? 'given', outline: 'confirmed' as const, maskRle: encodeMask(mask), ...(opts.withColour === false ? {} : { colour: encodeColour(rgb, colourRes) }) };
    }),
    assumptions: ['Vistas renderizadas com câmaras conhecidas (teste).'],
  };
}
export const ORBIT6: Array<[number, number]> = [[0, 0], [60, 0], [120, 0], [180, 0], [240, 20], [300, 20]];
