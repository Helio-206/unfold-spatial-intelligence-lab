import { Group, InstancedMesh, Matrix4, Mesh, PerspectiveCamera, Vector3, type Object3D } from 'three';
import type { CameraPose, Vec3 } from '../living/cinema/choreography';

/**
 * Scale-free framing for any compiled assembly. The V2 harness used `radius * 1.9 + 1` and a fixed 0.01..1000 depth range: an object a few tenths of a
 * unit across ended up a speck, and one hundreds of units across was clipped. Here the camera is fitted to the real world-space vertices of the
 * assembly, so the distance is a consequence of the geometry, the field of view and the viewport aspect, never of a magic constant.
 *
 * Presentation only: nothing here edits a plan, a component or a transform of the compiled geometry. `normalizeForPresentation` wraps the root in a
 * group that is scaled and lifted onto the floor; the compiled units stay exactly what the plan said.
 */

/** Cinema's `CameraPose` plus the depth range that goes with it. */
export type FittedPose = CameraPose & { near: number; far: number; distance: number };
export type ShotDirection = { azimuthDeg: number; elevationDeg: number; fovDeg: number };
export type FrameOptions = ShotDirection & { aspect: number; margin?: number };

/** Azimuth from +X toward +Z and elevation above the floor, the same convention as `living/cinema/choreography.ts`. The hero is a three-quarter view
 * that shows the front, a side and the top at once, which is what makes an unknown silhouette readable; the other shots are orthogonal views. */
export const SHOT_DIRECTIONS = {
  hero: { azimuthDeg: 38, elevationDeg: 20, fovDeg: 30 },
  px: { azimuthDeg: 0, elevationDeg: 8, fovDeg: 30 },
  nx: { azimuthDeg: 180, elevationDeg: 8, fovDeg: 30 },
  pz: { azimuthDeg: 90, elevationDeg: 8, fovDeg: 30 },
  nz: { azimuthDeg: 270, elevationDeg: 8, fovDeg: 30 },
  top: { azimuthDeg: 38, elevationDeg: 78, fovDeg: 30 },
} as const satisfies Record<string, ShotDirection>;
export type FramingShotId = keyof typeof SHOT_DIRECTIONS;

/** World-space vertices of every visible mesh below `root`, thinned to at most `maxPoints` (instanced meshes are expanded per instance). */
export function collectWorldPoints(root: Object3D, maxPoints = 8000, skip?: (object: Object3D) => boolean): Vector3[] {
  root.updateMatrixWorld(true);
  const sources: Array<{ mesh: Mesh; matrices: Matrix4[] }> = []; let total = 0;
  const visit = (object: Object3D) => {
    if (!object.visible || (object !== root && skip?.(object))) return;
    if (object instanceof Mesh && !object.userData.framingIgnore) {
      const position = object.geometry.getAttribute('position');
      if (position) {
        let matrices: Matrix4[];
        if (object instanceof InstancedMesh) {
          matrices = []; for (let i = 0; i < object.count; i++) { const local = new Matrix4(); object.getMatrixAt(i, local); matrices.push(new Matrix4().multiplyMatrices(object.matrixWorld, local)); }
        } else matrices = [object.matrixWorld];
        sources.push({ mesh: object, matrices }); total += position.count * matrices.length;
      }
    }
    for (const child of object.children) visit(child);
  };
  visit(root);
  const stride = Math.max(1, Math.ceil(total / maxPoints)), points: Vector3[] = []; let counter = 0;
  for (const { mesh, matrices } of sources) {
    const position = mesh.geometry.getAttribute('position');
    for (const matrix of matrices) for (let i = 0; i < position.count; i++) {
      if (counter++ % stride !== 0) continue;
      const point = new Vector3().fromBufferAttribute(position, i).applyMatrix4(matrix);
      if (Number.isFinite(point.x + point.y + point.z)) points.push(point);
    }
  }
  return points;
}

const HERO_CANDIDATES = [38, 128, 218, 308] as const;
function hullArea(points: Array<[number, number]>): number {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]); if (sorted.length < 3) return 0;
  const cross = (o: number[], a: number[], b: number[]) => (a[0]! - o[0]!) * (b[1]! - o[1]!) - (a[1]! - o[1]!) * (b[0]! - o[0]!);
  const build = (list: Array<[number, number]>) => { const hull: Array<[number, number]> = []; for (const p of list) { while (hull.length >= 2 && cross(hull[hull.length - 2]!, hull[hull.length - 1]!, p) <= 0) hull.pop(); hull.push(p); } hull.pop(); return hull; };
  const ring = [...build(sorted), ...build([...sorted].reverse())]; let area = 0;
  for (let i = 0; i < ring.length; i++) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!; area += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(area) / 2;
}

/**
 * Azimuth of the hero shot among the four diagonal three-quarter views. An unknown object has no "front", so this is a stated heuristic, not
 * recognition: prefer the view with the largest silhouette, and among equals the one facing the end that holds more vertex detail (what a viewer
 * reads first: the fan of an engine, the head of an animal, the face of a clock). Symmetric objects tie and keep the first candidate.
 */
export function heroAzimuth(points: readonly Vector3[]): number {
  if (!points.length) throw new Error('SPATIAL_FRAMING_EMPTY');
  const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity); const mean = new Vector3();
  for (const p of points) { lo.min(p); hi.max(p); mean.add(p); }
  mean.divideScalar(points.length); const center = lo.clone().add(hi).multiplyScalar(0.5), half = Math.max((hi.x - lo.x) / 2, (hi.z - lo.z) / 2, 1e-12);
  const offset = [(mean.x - center.x) / half, (mean.z - center.z) / half] as const, el = (SHOT_DIRECTIONS.hero.elevationDeg * Math.PI) / 180;
  const scored = HERO_CANDIDATES.map((azimuthDeg) => {
    const az = (azimuthDeg * Math.PI) / 180, direction = new Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    const right = new Vector3().crossVectors(new Vector3(0, 1, 0), direction).normalize(), up = new Vector3().crossVectors(direction, right).normalize();
    const area = hullArea(points.map((p) => [p.clone().sub(center).dot(right), p.clone().sub(center).dot(up)] as [number, number]));
    const align = Math.max(-1, Math.min(1, offset[0] * Math.cos(az) + offset[1] * Math.sin(az)));
    return { azimuthDeg, area, align };
  });
  const maxArea = Math.max(...scored.map((s) => s.area), 1e-12);
  return scored.reduce((best, s) => { const score = 0.5 * (s.area / maxArea) + 0.5 * ((s.align + 1) / 2), bestScore = 0.5 * (best.area / maxArea) + 0.5 * ((best.align + 1) / 2); return score > bestScore + 1e-9 ? s : best; }).azimuthDeg;
}

export type ProjectedExtent = { maxAbsNdc: number; minNdc: [number, number]; maxNdc: [number, number]; centerNdc: [number, number] };
function cameraFor(pose: CameraPose & { near?: number; far?: number }, aspect: number): PerspectiveCamera {
  const camera = new PerspectiveCamera(pose.fov, aspect, pose.near ?? 0.01, pose.far ?? 1e6);
  camera.position.set(...pose.position); camera.lookAt(...pose.target); camera.updateMatrixWorld(true); camera.updateProjectionMatrix(); return camera;
}
export function projectedExtent(points: readonly Vector3[], pose: CameraPose & { near?: number; far?: number }, aspect: number): ProjectedExtent {
  const camera = cameraFor(pose, aspect); const min: [number, number] = [Infinity, Infinity], max: [number, number] = [-Infinity, -Infinity];
  for (const point of points) { const p = point.clone().project(camera); min[0] = Math.min(min[0], p.x); min[1] = Math.min(min[1], p.y); max[0] = Math.max(max[0], p.x); max[1] = Math.max(max[1], p.y); }
  return { maxAbsNdc: Math.max(Math.abs(min[0]), Math.abs(min[1]), Math.abs(max[0]), Math.abs(max[1])), minNdc: min, maxNdc: max, centerNdc: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2] };
}

export function fitCamera(points: readonly Vector3[], options: FrameOptions): FittedPose {
  if (!points.length) throw new Error('SPATIAL_FRAMING_EMPTY');
  const limit = 1 - (options.margin ?? 0.1), aspect = Math.max(0.1, options.aspect);
  const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of points) { lo.min(p); hi.max(p); }
  const target = lo.clone().add(hi).multiplyScalar(0.5);
  const radius = Math.max(1e-9, ...points.map((p) => p.distanceTo(target)));
  const az = (options.azimuthDeg * Math.PI) / 180, el = (options.elevationDeg * Math.PI) / 180;
  const direction = new Vector3(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
  const poseAt = (distance: number): CameraPose => ({ position: target.clone().addScaledVector(direction, distance).toArray() as Vec3, target: target.toArray() as Vec3, fov: options.fovDeg });
  const solveDistance = (): number => {
    let near = radius * 1.01, far = radius * 400;
    for (let i = 0; i < 48; i++) { const mid = (near + far) / 2; if (projectedExtent(points, poseAt(mid), aspect).maxAbsNdc > limit) near = mid; else far = mid; }
    return far;
  };
  let distance = solveDistance();
  for (let pass = 0; pass < 6; pass++) {
    const extent = projectedExtent(points, poseAt(distance), aspect), camera = cameraFor(poseAt(distance), aspect);
    const halfHeight = Math.tan((options.fovDeg * Math.PI) / 360) * distance, halfWidth = halfHeight * aspect;
    const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0), up = new Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
    target.addScaledVector(right, extent.centerNdc[0] * halfWidth).addScaledVector(up, extent.centerNdc[1] * halfHeight);
    distance = solveDistance();
  }
  return { ...poseAt(distance), near: distance * 0.05, far: distance * 20 + radius * 4, distance };
}

export type PresentationStage = { wrapper: Group; scale: number; restore(): void };
/** Wraps `root` in a group scaled so its longest side is `targetSize` and lifted so its lowest point rests on y = 0 and its centre on x = z = 0. */
export function normalizeForPresentation(root: Object3D, targetSize = 4): PresentationStage {
  const points = collectWorldPoints(root, 20_000);
  if (!points.length) throw new Error('SPATIAL_FRAMING_EMPTY');
  const lo = new Vector3(Infinity, Infinity, Infinity), hi = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const p of points) { lo.min(p); hi.max(p); }
  const size = hi.clone().sub(lo), longest = Math.max(size.x, size.y, size.z, 1e-12), scale = targetSize / longest;
  const wrapper = new Group(); wrapper.name = 'presentation-stage'; wrapper.userData.presentationScale = scale;
  wrapper.scale.setScalar(scale); wrapper.position.set(-(lo.x + hi.x) / 2 * scale, -lo.y * scale, -(lo.z + hi.z) / 2 * scale);
  const parent = root.parent; wrapper.add(root); wrapper.updateMatrixWorld(true);
  return { wrapper, scale, restore() { wrapper.remove(root); if (parent) parent.add(root); } };
}
