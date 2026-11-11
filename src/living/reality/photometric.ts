/**
 * Novel-view photometric check: render the reconstruction with its own vertex colours from a camera it was NOT built from, in the same orthographic window as
 * the stored views, and compare with that view's colours inside the outline. It measures how faithful the appearance (not the shape) is on views never used.
 * Orthographic, unlit, nearest-depth: a controlled check, not a rendering.
 */
import { Vector3 } from 'three';
import { orbitDirection } from '../../universal-spatial/reconstruction/multiview';
import { decodeColour, decodeMask, type RealityEvidence, type StoredView } from './evidence';
import type { RealityModel } from './model';

export type PhotometricResult = { /** mean absolute difference per channel on a 0..255 scale, over pixels both the view and the model cover */ meanAbsError: number; /** share of the view's outline pixels the model covers with colour */ coverage: number; compared: number };

export function renderModelColours(model: RealityModel, azimuthDeg: number, elevationDeg: number, size: number): { rgb: Float32Array; covered: Uint8Array } {
  const d = orbitDirection(azimuthDeg, elevationDeg), worldUp = Math.abs(d.y) > 0.98 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0), right = new Vector3().crossVectors(worldUp, d).normalize(), up = new Vector3().crossVectors(d, right).normalize();
  const half = model.frame.half, s = size / (2 * half), depth = new Float32Array(size * size).fill(-Infinity), rgb = new Float32Array(size * size * 3), covered = new Uint8Array(size * size);
  const k = model.evidence.frame.half / model.frame.half; void k;
  for (const part of model.parts) {
    const P = part.positions, C = part.colours, I = part.indices, o = part.origin;
    const proj = (v: number) => { const x = P[v * 3]! + o[0] - model.frame.centre.x, y = P[v * 3 + 1]! + o[1] - model.frame.centre.y, z = P[v * 3 + 2]! + o[2] - model.frame.centre.z; return [(x * right.x + y * right.y + z * right.z + half) * s, (x * up.x + y * up.y + z * up.z + half) * s, x * d.x + y * d.y + z * d.z] as const; };
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t]!, b = I[t + 1]!, c = I[t + 2]!, pa = proj(a), pb = proj(b), pc = proj(c), det = (pb[1] - pc[1]) * (pa[0] - pc[0]) + (pc[0] - pb[0]) * (pa[1] - pc[1]);
      if (Math.abs(det) < 1e-9) continue;
      const x0 = Math.max(0, Math.floor(Math.min(pa[0], pb[0], pc[0]))), x1 = Math.min(size - 1, Math.ceil(Math.max(pa[0], pb[0], pc[0]))), y0 = Math.max(0, Math.floor(Math.min(pa[1], pb[1], pc[1]))), y1 = Math.min(size - 1, Math.ceil(Math.max(pa[1], pb[1], pc[1])));
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5, py = y + 0.5, l1 = ((pb[1] - pc[1]) * (px - pc[0]) + (pc[0] - pb[0]) * (py - pc[1])) / det, l2 = ((pc[1] - pa[1]) * (px - pc[0]) + (pa[0] - pc[0]) * (py - pc[1])) / det, l3 = 1 - l1 - l2;
        if (l1 < -0.02 || l2 < -0.02 || l3 < -0.02) continue;
        const z = l1 * pa[2] + l2 * pb[2] + l3 * pc[2], i = y * size + x; if (z <= depth[i]!) continue;
        depth[i] = z; covered[i] = 1; for (let ch = 0; ch < 3; ch++) rgb[i * 3 + ch] = (l1 * C[a * 3 + ch]! + l2 * C[b * 3 + ch]! + l3 * C[c * 3 + ch]!) * 255;
      }
    }
  }
  return { rgb, covered };
}

/** Compares the model's colours with a stored view's colour grid (the view must NOT be one the model was built from). */
export function photometricError(model: RealityModel, view: StoredView, evidence: Pick<RealityEvidence, 'res' | 'colourRes'>): PhotometricResult {
  if (!view.colour) return { meanAbsError: NaN, coverage: 0, compared: 0 };
  const size = evidence.colourRes, ref = decodeColour(view.colour, size), outline = decodeMask(view.maskRle, evidence.res * evidence.res);
  const { rgb, covered } = renderModelColours(model, view.azimuthDeg, view.elevationDeg, size);
  let sum = 0, n = 0, inOutline = 0;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const m = outline[Math.min(evidence.res - 1, Math.floor(((y + 0.5) / size) * evidence.res)) * evidence.res + Math.min(evidence.res - 1, Math.floor(((x + 0.5) / size) * evidence.res))]!; if (!m) continue;
    inOutline++; const i = y * size + x; if (!covered[i]) continue;
    // an edge pixel of the outline mixes object and background in the reference: skip the 1-pixel rim
    let rim = false; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) { const xx = x + dx, yy = y + dy; if (xx < 0 || yy < 0 || xx >= size || yy >= size) { rim = true; break; } const mm = outline[Math.min(evidence.res - 1, Math.floor(((yy + 0.5) / size) * evidence.res)) * evidence.res + Math.min(evidence.res - 1, Math.floor(((xx + 0.5) / size) * evidence.res))]!; if (!mm) { rim = true; break; } }
    if (rim) continue;
    sum += (Math.abs(rgb[i * 3]! - ref[i * 3]!) + Math.abs(rgb[i * 3 + 1]! - ref[i * 3 + 1]!) + Math.abs(rgb[i * 3 + 2]! - ref[i * 3 + 2]!)) / 3; n++;
  }
  return { meanAbsError: n ? sum / n : NaN, coverage: inOutline ? n / inOutline : 0, compared: n };
}
