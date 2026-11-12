import { Vector3 } from 'three';
import { orbitDirection } from '../../universal-spatial/reconstruction/multiview';
import type { RealityModel } from './model';

/** A point INSIDE a part (its voxel closest to the centroid): what an edit uses to name the part, robust to the part being concave. */
export function partSeed(model: Pick<RealityModel, 'solid' | 'parts'>, partId: string): [number, number, number] | null {
  const part = model.parts.find((p) => p.id === partId); if (!part) return null; const label = Number(partId.replace('part-', '')), g = model.solid.grid, [nx, ny] = g.cells;
  const c = new Vector3(...part.origin); let best = Infinity, out: [number, number, number] | null = null;
  for (let id = 0; id < model.solid.labels.length; id++) { if (model.solid.labels[id] !== label) continue; const x = g.min.x + ((id % nx) + 0.5) * g.size, y = g.min.y + ((Math.floor(id / nx) % ny) + 0.5) * g.size, z = g.min.z + (Math.floor(id / (nx * ny)) + 0.5) * g.size, d = (x - c.x) ** 2 + (y - c.y) ** 2 + (z - c.z) ** 2; if (d < best) { best = d; out = [x, y, z]; } }
  return out;
}
export const PART_COLOURS: Array<[number, number, number]> = [[230, 70, 70], [70, 170, 90], [70, 110, 230], [235, 190, 40], [170, 80, 200], [60, 190, 210], [240, 130, 40], [130, 130, 130], [240, 120, 180], [140, 200, 60]];
/** First-surface colour-by-part picture of the solid from a pose (orthographic, same window as the reconstruction): what the person looks at to judge the structure. */
export function renderPartsPreview(model: Pick<RealityModel, 'solid' | 'frame'>, azimuthDeg: number, elevationDeg: number, size = 160): Uint8ClampedArray {
  const g = model.solid.grid, [nx, ny, nz] = g.cells, half = model.frame.half, d = orbitDirection(azimuthDeg, elevationDeg), wu = Math.abs(d.y) > 0.98 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
  const right = new Vector3().crossVectors(wu, d).normalize(), up = new Vector3().crossVectors(d, right).normalize(), out = new Uint8ClampedArray(size * size * 4);
  for (let Y = 0; Y < size; Y++) for (let X = 0; X < size; X++) {
    const a = ((X + 0.5) / size) * 2 * half - half, b = ((Y + 0.5) / size) * 2 * half - half, base = model.frame.centre.clone().addScaledVector(right, a).addScaledVector(up, b), o = ((size - 1 - Y) * size + X) * 4; let col: [number, number, number] | null = null, shade = 1;
    for (let t = half * 1.8; t > -half * 1.8; t -= g.size * 0.5) { const i = Math.floor((base.x + d.x * t - g.min.x) / g.size), j = Math.floor((base.y + d.y * t - g.min.y) / g.size), k = Math.floor((base.z + d.z * t - g.min.z) / g.size); if (i < 0 || j < 0 || k < 0 || i >= nx || j >= ny || k >= nz) continue; const id = i + nx * (j + ny * k); if (model.solid.occupancy[id]) { const l = model.solid.labels[id]!; col = l ? PART_COLOURS[(l - 1) % PART_COLOURS.length]! : [160, 160, 160]; shade = 0.65 + 0.35 * Math.min(1, Math.max(0, (t + half * 1.8) / (half * 3.6))); break; } }
    if (col) { out[o] = col[0] * shade; out[o + 1] = col[1] * shade; out[o + 2] = col[2] * shade; out[o + 3] = 255; } else { out[o + 3] = 0; }
  }
  return out;
}
