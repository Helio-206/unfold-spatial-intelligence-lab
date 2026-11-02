/**
 * Reusable parametric geometry builders for display meshes, all in metres, plus PartBuilder, which collects the
 * geometry of one canonical part and merges it into one mesh per material (few draw calls, stable part identity).
 *
 * Conventions: XY is the side-profile plane of the machine (the plane its arm moves in), Z is across the machine.
 * `extrudeZ` extrudes a side profile symmetrically about z = zCenter; `boss` is a cylinder whose axis is Z.
 */
import {
  BufferGeometry, CatmullRomCurve3, CylinderGeometry, ExtrudeGeometry, Float32BufferAttribute, Group, LatheGeometry, Matrix4, Mesh,
  Quaternion, Shape, TubeGeometry, Vector2, Vector3, type Path,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MaterialKey, MaterialLibrary } from './materials';

export type P2 = [number, number];

export const v2 = (p: P2) => new Vector2(p[0], p[1]);

/** Chaikin corner cutting: rounds a polyline/polygon without moving it much. */
export function chaikin(points: P2[], iterations = 2, closed = true): P2[] {
  let pts = points;
  for (let it = 0; it < iterations; it++) {
    const out: P2[] = [];
    const n = pts.length;
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = pts[i]!, b = pts[(i + 1) % n]!;
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) { out.unshift(pts[0]!); out.push(pts[n - 1]!); }
    pts = out;
  }
  return pts;
}

/** Convex hull (Andrew's monotone chain), counter-clockwise. */
export function convexHull(points: P2[]): P2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: P2[] = [], upper: P2[] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop(); lower.push(p); }
  for (const p of pts.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Hull of points plus sampled circles: plates that wrap bosses. */
export function hullWithCircles(points: P2[], circles: Array<[P2, number]>, samples = 28): P2[] {
  const all: P2[] = [...points];
  for (const [[cx, cy], r] of circles) for (let k = 0; k < samples; k++) { const a = (k / samples) * Math.PI * 2; all.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
  return convexHull(all);
}

export function shapeFrom(points: P2[], holes: Path[] = []): Shape {
  const s = new Shape(points.map(v2));
  s.holes.push(...holes);
  return s;
}

/** Side profile (XY) extruded across Z, centred on zCenter, with a small chamfer-like bevel. */
export function extrudeZ(shape: Shape, depth: number, zCenter = 0, bevel = 0.012, curveSegments = 10): BufferGeometry {
  const b = Math.min(bevel, depth * 0.3);
  const g = new ExtrudeGeometry(shape, { depth: Math.max(1e-4, depth - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments, steps: 1 });
  g.translate(0, 0, zCenter - (depth - 2 * b) / 2);
  // ExtrudeGeometry shades every side segment flat; smooth curved walls, keep real edges (> 20°) crisp
  const smooth = toCreasedNormals(g, (20 * Math.PI) / 180);
  g.dispose();
  return smooth;
}

/** Top-view profile (in X, Z) extruded upward in Y from y0 to y1. */
export function extrudeY(shapeXZ: P2[], y0: number, y1: number, bevel = 0.02): BufferGeometry {
  // Shape is drawn in (x, -z) so that after rotating -90° about X the result has +Y up and z as given.
  const s = shapeFrom(shapeXZ.map(([x, z]) => [x, -z] as P2));
  const g = extrudeZ(s, y1 - y0, 0, bevel);
  g.rotateX(-Math.PI / 2);
  g.translate(0, (y0 + y1) / 2, 0);
  return g;
}

/** Cylinder along Z with chamfered ends (a lathe), for pin bosses, bushings and wheels. */
export function boss(radius: number, length: number, chamfer = 0.008, segments = 40, innerRadius = 0): BufferGeometry {
  const c = Math.min(chamfer, radius * 0.25, length * 0.25), h = length / 2;
  const prof: Vector2[] = innerRadius > 0
    ? [new Vector2(innerRadius, -h), new Vector2(radius - c, -h), new Vector2(radius, -h + c), new Vector2(radius, h - c), new Vector2(radius - c, h), new Vector2(innerRadius, h), new Vector2(innerRadius, -h)]
    : [new Vector2(0, -h), new Vector2(radius - c, -h), new Vector2(radius, -h + c), new Vector2(radius, h - c), new Vector2(radius - c, h), new Vector2(0, h)];
  const g = new LatheGeometry(prof, segments);
  g.rotateX(Math.PI / 2);
  return g;
}

/** Revolved profile [radius, axial] around X (axial along +X). For barrels, glands, rods, rollers. */
export function latheX(profile: P2[], segments = 40): BufferGeometry {
  const g = new LatheGeometry(profile.map(([r, a]) => new Vector2(Math.max(0, r), a)), segments);
  g.rotateZ(-Math.PI / 2);
  return g;
}

/** Revolved profile [radius, axial] around Z (axial along +Z). */
export function latheZ(profile: P2[], segments = 40): BufferGeometry {
  const g = new LatheGeometry(profile.map(([r, a]) => new Vector2(Math.max(0, r), a)), segments);
  g.rotateX(Math.PI / 2);
  return g;
}

export function rbox(w: number, h: number, d: number, r = 0.01, segments = 2): BufferGeometry {
  return new RoundedBoxGeometry(w, h, d, segments, Math.min(r, w / 2.01, h / 2.01, d / 2.01));
}

/** Hex bolt head with washer, axis along +Y (head sits on y = 0). */
export function hexBolt(size: number): BufferGeometry {
  const washer = new CylinderGeometry(size * 0.95, size * 0.95, size * 0.18, 20); washer.translate(0, size * 0.09, 0);
  const head = new CylinderGeometry(size * 0.75, size * 0.75, size * 0.6, 6); head.translate(0, size * 0.18 + size * 0.3, 0);
  const chamfer = new CylinderGeometry(size * 0.55, size * 0.74, size * 0.08, 6); chamfer.translate(0, size * 0.18 + size * 0.64, 0);
  return merge([washer, head, chamfer]);
}

/** A closed, capped tube along a smooth curve through points. */
export function pipe(points: Vector3[], radius: number, tubular = 48, radial = 10): BufferGeometry {
  const curve = new CatmullRomCurve3(points, false, 'centripetal');
  const tube = new TubeGeometry(curve, tubular, radius, radial, false);
  const capA = new CylinderGeometry(radius, radius, 0.002, radial); const capB = capA.clone();
  const place = (g: BufferGeometry, t: number) => {
    const p = curve.getPointAt(t), d = curve.getTangentAt(t);
    g.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d)); g.translate(p.x, p.y, p.z);
  };
  place(capA, 0); place(capB, 1);
  return merge([tube, capA, capB]);
}

/** Normalises attributes so heterogenous builders can be merged (position, normal, uv; non-indexed). */
export function normalise(g: BufferGeometry): BufferGeometry {
  let out = g.index ? g.toNonIndexed() : g;
  if (out !== g) g.dispose();
  for (const name of Object.keys(out.attributes)) if (!['position', 'normal', 'uv'].includes(name)) out.deleteAttribute(name);
  if (!out.attributes.normal) out.computeVertexNormals();
  if (!out.attributes.uv) out.setAttribute('uv', new Float32BufferAttribute(new Float32Array((out.attributes.position!.count) * 2), 2));
  out.morphAttributes = {};
  out.clearGroups();
  return out;
}

export function merge(geos: BufferGeometry[]): BufferGeometry {
  const norm = geos.map(normalise);
  const out = mergeGeometries(norm, false);
  for (const g of norm) g.dispose();
  if (!out) throw new Error('FOUNDRY_MERGE_FAILED');
  return out;
}

export const m4 = (pos: [number, number, number] = [0, 0, 0], rotZ = 0, rotY = 0, rotX = 0) => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rotZ)
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), rotY))
    .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), rotX));
  return new Matrix4().compose(new Vector3(...pos), q, new Vector3(1, 1, 1));
};

/** Collects one canonical part's display geometry and emits one merged mesh per material. */
export class PartBuilder {
  private readonly buckets = new Map<MaterialKey, BufferGeometry[]>();
  constructor(readonly partId: string) {}

  add(geometry: BufferGeometry, material: MaterialKey, matrix?: Matrix4): this {
    if (matrix) geometry.applyMatrix4(matrix);
    const list = this.buckets.get(material) ?? [];
    list.push(geometry);
    this.buckets.set(material, list);
    return this;
  }

  /** Mirror a geometry across z = 0 and add both copies (left/right symmetric parts). */
  addMirroredZ(geometry: BufferGeometry, material: MaterialKey, matrix?: Matrix4): this {
    if (matrix) geometry.applyMatrix4(matrix);
    const mirror = geometry.clone(); mirror.scale(1, 1, -1);
    // scaling by -1 flips winding; restore it by reversing triangle order
    flipWinding(mirror);
    return this.add(geometry, material).add(mirror, material);
  }

  build(lib: MaterialLibrary): Group {
    const group = new Group();
    group.name = `part:${this.partId}`;
    group.userData.partId = this.partId;
    for (const [key, geos] of this.buckets) {
      const mesh = new Mesh(merge(geos), lib.get(key));
      mesh.name = `${this.partId}:${key}`;
      mesh.userData.partId = this.partId;
      mesh.userData.materialKey = key;
      mesh.castShadow = key !== 'glass';
      mesh.receiveShadow = true;
      mesh.geometry.computeBoundingSphere();
      mesh.geometry.computeBoundingBox();
      if (key === 'glass') mesh.renderOrder = 2;
      group.add(mesh);
    }
    this.buckets.clear();
    return group;
  }
}

export function flipWinding(g: BufferGeometry): void {
  const ng = g.index ? g.toNonIndexed() : g;
  if (ng !== g) { g.copy(ng); ng.dispose(); }
  const pos = g.attributes.position!, nor = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i += 3) {
    for (const attr of [pos, nor, uv]) {
      if (!attr) continue;
      const s = attr.itemSize, a = attr.array as Float32Array;
      for (let k = 0; k < s; k++) { const t = a[(i + 1) * s + k]!; a[(i + 1) * s + k] = a[(i + 2) * s + k]!; a[(i + 2) * s + k] = t; }
    }
  }
  pos.needsUpdate = true;
}
