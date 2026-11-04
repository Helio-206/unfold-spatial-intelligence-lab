import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { surfaceNets, type Field } from '../src/universal-spatial/fidelity/surface-nets';
import { clipMesh, type MeshArrays } from '../src/universal-spatial/fidelity/clip';

const sphere: Field = (x, y, z) => Math.hypot(x, y, z) - 1;
const arrays = (cells = 24): MeshArrays => { const g = surfaceNets({ min: new Vector3(-1.4, -1.4, -1.4), cells: [cells, cells, cells], size: 2.8 / cells, field: sphere }); return { positions: g.getAttribute('position').array as Float32Array, normals: g.getAttribute('normal').array as Float32Array, uvs: g.getAttribute('uv').array as Float32Array, indices: Uint32Array.from(g.index!.array as ArrayLike<number>) }; };
const edgeUse = (m: MeshArrays) => { const e = new Map<string, number>(); for (let t = 0; t < m.indices.length; t += 3) for (let k = 0; k < 3; k++) { const a = m.indices[t + k]!, b = m.indices[t + ((k + 1) % 3)]!, key = a < b ? `${a}_${b}` : `${b}_${a}`; e.set(key, (e.get(key) ?? 0) + 1); } return e; };

describe('sub-triangle clipping', () => {
  it('cuts exactly on the iso-line of a field, so the rim is smooth instead of cell-sized teeth', () => {
    const mesh = arrays(), plane: Field = (x) => x;
    const clipped = clipMesh(mesh, [{ f: plane, keep: 'ge', t: 0 }]);
    let worst = 0, onRim = 0; for (let i = 0; i < clipped.positions.length; i += 3) { worst = Math.min(worst, clipped.positions[i]!); if (Math.abs(clipped.positions[i]!) < 1e-3) onRim++; }
    expect(worst).toBeGreaterThan(-1e-3); expect(onRim).toBeGreaterThan(12);
    // the old whole-triangle discard leaves vertices up to one cell behind the line
    const cell = 2.8 / 24, discard = new Set<number>(); for (let t = 0; t < mesh.indices.length; t += 3) { const cx = (mesh.positions[mesh.indices[t]! * 3]! + mesh.positions[mesh.indices[t + 1]! * 3]! + mesh.positions[mesh.indices[t + 2]! * 3]!) / 3; if (cx >= 0) for (let k = 0; k < 3; k++) discard.add(mesh.indices[t + k]!); }
    let discardWorst = 0; for (const v of discard) discardWorst = Math.min(discardWorst, mesh.positions[v * 3]!); expect(discardWorst).toBeLessThan(-cell * 0.1);
  });

  it('keeps everything when nothing crosses, drops everything when all is outside, and keeps shared vertices shared', () => {
    const mesh = arrays(); expect(clipMesh(mesh, [{ f: () => -1, keep: 'le', t: 0 }]).indices.length).toBe(mesh.indices.length); expect(clipMesh(mesh, [{ f: () => 1, keep: 'le', t: 0 }]).indices.length).toBe(0);
    const half = clipMesh(mesh, [{ f: (x) => x, keep: 'ge', t: 0 }]); for (const uses of edgeUse(half).values()) expect(uses).toBeLessThanOrEqual(2);
    const boundary = new Map<number, number>(); for (const [key, uses] of edgeUse(half)) if (uses === 1) for (const v of key.split('_').map(Number)) boundary.set(v, (boundary.get(v) ?? 0) + 1);
    expect(boundary.size).toBeGreaterThan(20); for (const n of boundary.values()) expect(n).toBe(2); // one closed rim curve, nothing torn
  });

  it('applies several clips in sequence and interpolates normals and uvs without NaN', () => {
    const clipped = clipMesh(arrays(), [{ f: (x) => x, keep: 'ge', t: -0.2 }, { f: (_x, y) => y, keep: 'le', t: 0.3 }]);
    for (const a of [clipped.positions, clipped.normals, clipped.uvs]) for (const v of a) expect(Number.isFinite(v)).toBe(true);
    for (let i = 0; i < clipped.normals.length; i += 3) expect(Math.hypot(clipped.normals[i]!, clipped.normals[i + 1]!, clipped.normals[i + 2]!)).toBeGreaterThan(0.95);
    expect(clipped.indices.length).toBeGreaterThan(0); expect(clipped.indices.length % 3).toBe(0);
  });
});
