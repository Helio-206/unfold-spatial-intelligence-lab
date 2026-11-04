import { InstancedMesh, Matrix4, Mesh, Vector3 } from 'three';
import type { Tri } from './silhouette';

/** Expand instances in their actual world transforms, keeping component identity at the caller. */
export function meshWorldTriangles(mesh: Mesh): Tri[] {
  const pos = mesh.geometry.getAttribute('position'), idx = mesh.geometry.index;
  const n = idx ? idx.count : pos.count, result: Tri[] = [];
  const instance = new Matrix4(), world = new Matrix4();
  const count = mesh instanceof InstancedMesh ? mesh.count : 1;
  for (let k = 0; k < count; k++) {
    if (mesh instanceof InstancedMesh) { mesh.getMatrixAt(k, instance); world.multiplyMatrices(mesh.matrixWorld, instance); }
    else world.copy(mesh.matrixWorld);
    const vertex = (i: number) => new Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(world);
    for (let i = 0; i + 2 < n; i += 3) result.push([vertex(i), vertex(i + 1), vertex(i + 2)]);
  }
  return result;
}
