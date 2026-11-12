import { describe, it, expect } from 'vitest';
import { buildModel, type PartMesh } from '../src/living/reality/model';
import { buildLods, decimateByClustering } from '../src/living/reality/lod';
import { Mesh, LOD } from 'three';
import { RealityGeometry } from '../src/living/reality/geometry';
import { planFromModel } from '../src/living/reality/plan';
import { evidenceSha256 } from '../src/living/reality/evidence';
import { evidenceFromRenders, solid, ORBIT6 } from './helpers/reality-fixtures';

const model = buildModel(evidenceFromRenders(solid(), [...ORBIT6, [30, 40], [90, 40], [150, 40], [210, 40]], { cells: 96, res: 160 }));
const big = model.parts.reduce((a, b) => (b.indices.length > a.indices.length ? b : a));

/** geometric normal of triangle t vs the mean of its vertex normals; and signed volume (divergence theorem) of the closed shell */
function audit(m: Pick<PartMesh, 'positions' | 'normals' | 'indices'>) {
  let agree = 0, total = 0, volume = 0, nonUnit = 0, nan = 0;
  for (let i = 0; i < m.normals.length; i += 3) { const l = Math.hypot(m.normals[i]!, m.normals[i + 1]!, m.normals[i + 2]!); if (!Number.isFinite(l)) nan++; else if (Math.abs(l - 1) > 1e-3) nonUnit++; }
  for (let t = 0; t < m.indices.length; t += 3) {
    const a = m.indices[t]! * 3, b = m.indices[t + 1]! * 3, c = m.indices[t + 2]! * 3, P = m.positions;
    const u = [P[b]! - P[a]!, P[b + 1]! - P[a + 1]!, P[b + 2]! - P[a + 2]!], v = [P[c]! - P[a]!, P[c + 1]! - P[a + 1]!, P[c + 2]! - P[a + 2]!], n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!];
    const vn = [0, 1, 2].map((k) => m.normals[a + k]! + m.normals[b + k]! + m.normals[c + k]!), dot = n[0]! * vn[0]! + n[1]! * vn[1]! + n[2]! * vn[2]!; if (Math.hypot(...n) > 1e-12) { total++; if (dot > 0) agree++; }
    volume += (P[a]! * (P[b + 1]! * P[c + 2]! - P[b + 2]! * P[c + 1]!) - P[a + 1]! * (P[b]! * P[c + 2]! - P[b + 2]! * P[c]!) + P[a + 2]! * (P[b]! * P[c + 1]! - P[b + 1]! * P[c]!)) / 6;
  }
  return { agree: total ? agree / total : 0, volume, nonUnit, nan, total };
}

describe('Visual Foundry — normals and levels of detail of the reconstructed shells', () => {
  it('every shell has unit, finite normals that agree with its winding, and positive enclosed volume (outward orientation)', () => {
    for (const p of model.parts) { const a = audit(p); expect(a.nan).toBe(0); expect(a.nonUnit).toBe(0); expect(a.agree).toBeGreaterThan(0.99); expect(a.volume).toBeGreaterThan(0); }
  });
  it('level 0 is the untouched shell and each level is smaller with a measured, bounded error', () => {
    const levels = buildLods(big, { minTriangles: 500 });
    expect(levels[0]!.mesh).toBe(big); expect(levels[0]!.maxDisplacement).toBe(0);
    expect(levels.length).toBeGreaterThan(1);
    for (let i = 1; i < levels.length; i++) {
      const l = levels[i]!; expect(l.triangles).toBeLessThan(levels[i - 1]!.triangles);
      expect(l.maxDisplacement).toBeLessThanOrEqual(l.cell * Math.sqrt(3) + 1e-6); // vertices stay inside their cell: the bound is geometric, not tuned
      const a = audit(l.mesh); expect(a.nan).toBe(0); expect(a.nonUnit).toBe(0); expect(a.agree).toBeGreaterThan(0.95);
    }
  });
  it('decimation invents nothing: unobserved stays unobserved, colours stay inside the original range, no vertex leaves the original bounding box', () => {
    const l = decimateByClustering(big, 0.03)!; expect(l).not.toBeNull();
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < big.positions.length; i += 3) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, big.positions[i + k]!); hi[k] = Math.max(hi[k]!, big.positions[i + k]!); }
    for (let i = 0; i < l.mesh.positions.length; i += 3) for (let k = 0; k < 3; k++) { expect(l.mesh.positions[i + k]!).toBeGreaterThanOrEqual(lo[k]! - 1e-6); expect(l.mesh.positions[i + k]!).toBeLessThanOrEqual(hi[k]! + 1e-6); }
    const anySeen = big.observed.some((o) => o === 1); expect(l.mesh.observed.some((o) => o === 1)).toBe(anySeen);
    expect(Math.min(...l.mesh.colours)).toBeGreaterThanOrEqual(Math.min(...big.colours) - 1e-6); expect(Math.max(...l.mesh.colours)).toBeLessThanOrEqual(Math.max(...big.colours) + 1e-6);
  });
  it('a tiny shell gets no levels (nothing to gain, nothing degraded)', () => {
    const tiny = model.parts.reduce((a, b) => (b.indices.length < a.indices.length ? b : a)); expect(buildLods(tiny, { minTriangles: 1e9 })).toHaveLength(1);
  });
  it('the stage draws big shells through a LOD node, small ones plainly; the report states each level and its measured error; the surface is matte (no invented gloss)', async () => {
    const sha = await evidenceSha256(model.evidence), plan = planFromModel(model, sha, 'T'), seam = new RealityGeometry((s) => (s === sha ? model : null)), compiled = seam.compile(plan), rep = seam.report()!;
    expect(rep.status).toBe('shells');
    const bigRep = rep.components.find((c) => c.id === big.id)!; expect(bigRep.lod!.length).toBeGreaterThan(1); expect(bigRep.lod![0]!.maxDisplacementPct).toBe(0);
    for (const l of bigRep.lod!.slice(1)) expect(l.maxDisplacementPct).toBeGreaterThan(0), expect(l.maxDisplacementPct).toBeLessThan(15);
    let lods = 0; const materials = new Set<string>(); compiled.root.traverse((o) => { if (o instanceof LOD) lods++; if (o instanceof Mesh && o.userData.spatialEntityId) { const m = o.material as { clearcoat: number; metalness: number; roughness: number; userData: Record<string, unknown> }; if (m.userData.realityHypothesisColour) { expect(m.clearcoat).toBe(0); expect(m.metalness).toBe(0); expect(m.roughness).toBeGreaterThan(0.8); expect(String(m.userData.realityMaterialBasis)).toMatch(/assumed/); materials.add('x'); } } });
    expect(lods).toBeGreaterThanOrEqual(1); expect(materials.size).toBe(1);
  });
});
