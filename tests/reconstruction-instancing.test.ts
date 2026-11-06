import { describe, expect, it } from 'vitest';
import { BoxGeometry, InstancedMesh, Matrix4, MeshBasicMaterial } from 'three';
import { meshWorldTriangles } from '../src/universal-spatial/reconstruction/mesh-triangles';

describe('reconstruction instance transforms', () => {
  it('expands each instance in world coordinates', () => {
    const mesh = new InstancedMesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial(), 2);
    mesh.position.set(10, 0, 0); mesh.setMatrixAt(0, new Matrix4().makeTranslation(-3, 0, 0)); mesh.setMatrixAt(1, new Matrix4().makeTranslation(3, 0, 0)); mesh.updateMatrixWorld(true);
    const tris = meshWorldTriangles(mesh); const xs = tris.flat().map(p => p.x);
    expect(tris).toHaveLength(24); expect(Math.min(...xs)).toBeCloseTo(6.5); expect(Math.max(...xs)).toBeCloseTo(13.5);
    mesh.geometry.dispose(); (mesh.material as MeshBasicMaterial).dispose();
  });
});
