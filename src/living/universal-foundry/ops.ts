/**
 * Universal Foundry operators: reusable, object-agnostic geometry builders. All in metres, all deterministic (a seed or no randomness at all), all bounded
 * (segment counts scale with a `Lod`, implicit surfaces have a triangle budget).
 *
 * What the excavator Visual Foundry taught (src/living/visual-foundry/geometry.ts and excavator/*), generalised here and reused where it already was generic:
 *   - a profile is smoothed (Chaikin), wrapped (convex hull with circles) or offset into a band, then EXTRUDED with a small bevel, and the result gets CREASED
 *     normals so curved walls shade smoothly while real edges (> ~20 deg) stay crisp                       -> `extrudeProfile`, reuse of `extrudeZ/extrudeY`, `chaikin`, `hullWithCircles`
 *   - revolved profiles with chamfered ends for every round thing (bosses, rollers, wheels)                  -> `latheAxis`
 *   - hard-surface parts are made of thin plates proud of a body (doublers, flanges, panels with gaps)        -> `panel`, `plateWithOpenings`
 *   - fittings repeat along a pattern (bolts, washers, lugs) and are merged per material                      -> `boltCircle`, `boltRow`, `Bucket`
 *   - tubes and hoses run through a smooth curve with end fittings                                             -> `hose`
 * New here (the excavator never needed them): lofted sections with variable cross-section, nonuniform tapered solids, openings in walls, hinges, grilles,
 * pillowed soft forms, procedural deformation, midpoint subdivision with relaxation, smooth-union implicit surfaces with mesh extraction and a topology report.
 */
import {
  BufferGeometry, CatmullRomCurve3, CylinderGeometry, ExtrudeGeometry, Float32BufferAttribute, Group, Matrix4, Mesh, Path, Quaternion, Shape, TubeGeometry, Vector2, Vector3,
} from 'three';
import { mergeGeometries, toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { chaikin, convexHull, extrudeY, extrudeZ, hexBolt, hullWithCircles, latheX, latheZ, normalise, pipe, rbox, shapeFrom, type P2 } from '../visual-foundry/geometry';
import { surfaceNets } from '../../universal-spatial/fidelity/surface-nets';
import { smoothMin } from '../../universal-spatial/fidelity/sdf';
import type { MaterialSpec, UniversalMaterials } from './materials';

export { chaikin, convexHull, hullWithCircles, extrudeY, extrudeZ, rbox, shapeFrom, hexBolt, type P2 };

/** Level-of-detail scale: 1 = full, 0.5 = half the radial/sample counts, etc. Every builder takes the segment counts it needs through `lod.seg`. */
export type Lod = { scale: number; seg: (n: number, min?: number) => number };
export const makeLod = (scale: number): Lod => ({ scale, seg: (n, min = 6) => Math.max(min, Math.round(n * scale)) });
export const LOD_FULL = makeLod(1);

export const rng = (seed: number) => { let s = (seed >>> 0) || 1; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; };

/** Collects geometry per material and emits ONE merged mesh per material (few draw calls, stable part identity). */
export class Bucket {
  private readonly parts = new Map<string, { spec: MaterialSpec; geos: BufferGeometry[] }>();
  triangles = 0;
  add(geometry: BufferGeometry, material: MaterialSpec, matrix?: Matrix4): this {
    if (matrix) geometry.applyMatrix4(matrix);
    const key = `${material.kind}:${material.color ?? ''}:${material.variant ?? ''}`, entry = this.parts.get(key) ?? { spec: material, geos: [] };
    entry.geos.push(geometry); this.parts.set(key, entry); this.triangles += (geometry.index ? geometry.index.count : geometry.getAttribute('position').count) / 3; return this;
  }
  addMirrored(geometry: BufferGeometry, material: MaterialSpec, axis: 'x' | 'z' = 'z', matrix?: Matrix4): this {
    if (matrix) geometry.applyMatrix4(matrix);
    const mirror = geometry.clone(); mirror.scale(axis === 'x' ? -1 : 1, 1, axis === 'z' ? -1 : 1); flipWinding(mirror); return this.add(geometry, material).add(mirror, material);
  }
  build(lib: UniversalMaterials, name: string, userData: Record<string, unknown> = {}): Group {
    const group = new Group(); group.name = name;
    for (const { spec, geos } of this.parts.values()) {
      const mesh = new Mesh(merge(geos), lib.get(spec)); mesh.name = `${name}:${spec.kind}`; mesh.userData = { ...userData, materialKind: spec.kind };
      mesh.castShadow = spec.kind !== 'glass'; mesh.receiveShadow = true; mesh.geometry.computeBoundingSphere(); mesh.geometry.computeBoundingBox();
      if (spec.kind === 'glass') mesh.renderOrder = 2; group.add(mesh);
    }
    this.parts.clear(); return group;
  }
}

export function merge(geos: BufferGeometry[]): BufferGeometry {
  const norm = geos.map(normalise), out = mergeGeometries(norm, false); for (const g of norm) g.dispose();
  if (!out) throw new Error('UNIVERSAL_FOUNDRY_MERGE_FAILED'); return out;
}
export function flipWinding(g: BufferGeometry): void {
  const ng = g.index ? g.toNonIndexed() : g; if (ng !== g) { g.copy(ng); ng.dispose(); }
  const pos = g.attributes.position!, nor = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i += 3) for (const attr of [pos, nor, uv]) { if (!attr) continue; const s = attr.itemSize, a = attr.array as Float32Array; for (let k = 0; k < s; k++) { const t = a[(i + 1) * s + k]!; a[(i + 1) * s + k] = a[(i + 2) * s + k]!; a[(i + 2) * s + k] = t; } }
  pos.needsUpdate = true;
}
export const at = (x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, scale = 1) => new Matrix4().compose(new Vector3(x, y, z), new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), rz).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), ry)).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), rx)), new Vector3(scale, scale, scale));

// ---------------------------------------------------------------------------------------------------------------------------------- profiles and solids
/** Axis-aligned superellipse / rounded-rectangle ring, `n` points, exponent `p` (2 = ellipse, 4 = squircle, large = nearly a rectangle). */
export function ring(w: number, h: number, p: number, n: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); out.push([(w / 2) * Math.sign(c) * Math.abs(c) ** (2 / p), (h / 2) * Math.sign(s) * Math.abs(s) ** (2 / p)]); }
  return out;
}

export type Section = {
  /** position along the loft axis (+X) */ x: number;
  /** centre of the section in the YZ plane */ y?: number; z?: number;
  /** full height (Y) and width (Z) */ h: number; w: number;
  /** superellipse exponent: 2 ellipse .. 6 almost square (default 3) */ p?: number;
  /** flat bottom: clamp ring points below this fraction of the height to a plane (0..1, 0 = none) */ flatBottom?: number;
};
/**
 * Variable cross-section solid along +X: the body of a car, a bottle, a boat hull, a handle, a fuselage. Sections can differ in size, exponent and position; the
 * result is capped and given creased normals. Deterministic and cheap: sections.length * ringSegments vertices.
 */
export function loftSections(sections: Section[], ringSegments = 28, creaseDeg = 35): BufferGeometry {
  const pos: number[] = [], idx: number[] = [], n = Math.max(8, ringSegments);
  for (const s of sections) {
    const r = ring(s.w, s.h, s.p ?? 3, n);
    for (const [rz, ry] of r) { let y = ry; if (s.flatBottom && ry < -s.h / 2 * (1 - 2 * s.flatBottom)) y = -s.h / 2 * (1 - 2 * s.flatBottom) * 1; pos.push(s.x, (s.y ?? 0) + y, (s.z ?? 0) + rz); }
  }
  const m = sections.length;
  for (let i = 0; i < m - 1; i++) for (let k = 0; k < n; k++) { const a = i * n + k, b = i * n + ((k + 1) % n), c = (i + 1) * n + k, d = (i + 1) * n + ((k + 1) % n); idx.push(a, c, b, b, c, d); }
  const cap = (i: number, flip: boolean) => { const s = sections[i]!, ci = pos.length / 3; pos.push(s.x, s.y ?? 0, s.z ?? 0); for (let k = 0; k < n; k++) { const a = i * n + k, b = i * n + ((k + 1) % n); idx.push(...(flip ? [ci, b, a] : [ci, a, b])); } };
  cap(0, false); cap(m - 1, true);
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  // consistent outward orientation: flip all if the signed volume is negative
  const vol = signedVolume(g); if (vol < 0) { const ix = g.index!.array as Uint32Array | Uint16Array; for (let i = 0; i < ix.length; i += 3) { const t = ix[i + 1]!; ix[i + 1] = ix[i + 2]!; ix[i + 2] = t; } }
  g.computeVertexNormals(); const out = toCreasedNormals(g, (creaseDeg * Math.PI) / 180); g.dispose();
  // planar-ish UVs from XZ/XY so procedural bump maps have something to hold on to
  const p = out.getAttribute('position'), uv = new Float32Array(p.count * 2); for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) * 2; uv[i * 2 + 1] = (p.getY(i) + p.getZ(i)) * 2; } out.setAttribute('uv', new Float32BufferAttribute(uv, 2)); return out;
}

export function signedVolume(g: BufferGeometry): number {
  const p = g.getAttribute('position'), ix = g.index; let v = 0; const a = new Vector3(), b = new Vector3(), c = new Vector3();
  const tri = (i: number, j: number, k: number) => { a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, j); c.fromBufferAttribute(p, k); v += a.dot(new Vector3().crossVectors(b, c)) / 6; };
  if (ix) for (let i = 0; i < ix.count; i += 3) tri(ix.getX(i), ix.getX(i + 1), ix.getX(i + 2)); else for (let i = 0; i < p.count; i += 3) tri(i, i + 1, i + 2);
  return v;
}

/** A closed profile (outline in XY) extruded along Z with a bevel and creased normals; centred in z. Wrapper over the reusable `extrudeZ`. */
export const extrudeProfile = (outline: P2[], depth: number, bevel = 0.01, holes: Path[] = [], curveSegments = 10) => extrudeZ(shapeFrom(outline, holes), depth, 0, bevel, curveSegments);

/** Rounded rectangle outline (XY, centred) with corner radius r and `arc` samples per corner. */
export function roundedRect(w: number, h: number, r: number, arc = 5): P2[] {
  const rr = Math.min(r, w / 2 - 1e-4, h / 2 - 1e-4), out: P2[] = [], corner = (cx: number, cy: number, a0: number) => { for (let i = 0; i <= arc; i++) { const a = a0 + (i / arc) * (Math.PI / 2); out.push([cx + rr * Math.cos(a), cy + rr * Math.sin(a)]); } };
  corner(w / 2 - rr, h / 2 - rr, 0); corner(-w / 2 + rr, h / 2 - rr, Math.PI / 2); corner(-w / 2 + rr, -h / 2 + rr, Math.PI); corner(w / 2 - rr, -h / 2 + rr, Math.PI * 1.5); return out;
}

/** A flat plate (XY, thickness along Z) with rectangular openings: a wall with windows and a door, a bezel, a hatch frame, a grille frame. */
export type Opening = { x: number; y: number; w: number; h: number; r?: number };
export function plateWithOpenings(w: number, h: number, t: number, openings: Opening[] = [], bevel = 0.004): BufferGeometry {
  const holes = openings.map((o) => { const p = new Path(); roundedRect(o.w, o.h, o.r ?? 0, 3).forEach(([x, y], i) => (i === 0 ? p.moveTo(x + o.x, y + o.y) : p.lineTo(x + o.x, y + o.y))); p.closePath(); return p; });
  return extrudeProfile([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], t, bevel, holes);
}
/** Raised or recessed panel (a rounded plate proud of a surface). */
export const panel = (w: number, h: number, t: number, r = 0.01) => extrudeProfile(roundedRect(w, h, r), t, Math.min(0.003, t * 0.3));

/** Nonuniform tapered solid: a box whose top and bottom faces differ in size and offset (a stool seat, a bucket, a wedge, a monitor back). */
export function taperedBox(bottom: [number, number], top: [number, number], height: number, offset: [number, number] = [0, 0]): BufferGeometry {
  // sections run along +X in loftSections (height = Y, width = Z); rotating +90 degrees about Z sends +X to +Y and Y to -X
  const g = loftSections([{ x: 0, h: bottom[0], w: bottom[1], p: 8 }, { x: height, y: -offset[0], z: offset[1], h: top[0], w: top[1], p: 8 }], 32, 50);
  g.rotateZ(Math.PI / 2); g.translate(0, -height / 2, 0); return g;
}

/** Axis-parameterised lathe: profile [radius, axial] revolved around X, Y or Z (the excavator's latheX/latheZ, plus Y for vertical round things). */
export function latheAxis(profile: P2[], axis: 'x' | 'y' | 'z', segments = 40): BufferGeometry {
  if (axis === 'x') return latheX(profile, segments); if (axis === 'z') return latheZ(profile, segments);
  const g = latheZ(profile, segments); g.rotateX(-Math.PI / 2); return g;
}

/** Soft pillowed slab: a rounded box whose faces bulge outward by `puff` (cushions, a leather seat, a soft-touch pad). */
export function pillow(w: number, h: number, d: number, puff = 0.02, round = 0.04, seg = 8): BufferGeometry {
  const g = rbox(w, h, d, round, seg), p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const x = p.getX(i) / (w / 2), y = p.getY(i) / (h / 2), z = p.getZ(i) / (d / 2), fx = 1 - x * x, fy = 1 - y * y, fz = 1 - z * z; p.setXYZ(i, p.getX(i) + Math.sign(x) * puff * fy * fz * Math.abs(x) ** 3, p.getY(i) + Math.sign(y) * puff * fx * fz * Math.abs(y) ** 3, p.getZ(i) + Math.sign(z) * puff * fx * fy * Math.abs(z) ** 3); }
  g.computeVertexNormals(); return g;
}

// ---------------------------------------------------------------------------------------------------------------------------------- fittings
export const boltCircle = (count: number, radius: number, size: number, axis: 'x' | 'y' | 'z' = 'z'): BufferGeometry[] => Array.from({ length: count }, (_, i) => { const a = (i / count) * Math.PI * 2, g = hexBolt(size); if (axis === 'z') { g.rotateX(Math.PI / 2); g.translate(Math.cos(a) * radius, Math.sin(a) * radius, 0); } else if (axis === 'y') g.translate(Math.cos(a) * radius, 0, Math.sin(a) * radius); else { g.rotateZ(-Math.PI / 2); g.translate(0, Math.cos(a) * radius, Math.sin(a) * radius); } return g; });
export const boltRow = (count: number, spacing: number, size: number, axis: 'x' | 'y' | 'z' = 'z'): BufferGeometry[] => Array.from({ length: count }, (_, i) => { const g = hexBolt(size), o = (i - (count - 1) / 2) * spacing; if (axis === 'z') { g.rotateX(Math.PI / 2); g.translate(o, 0, 0); } else g.translate(o, 0, 0); return g; });

export function hinge(length: number, radius: number, leaf = radius * 3.2): BufferGeometry {
  const barrel = new CylinderGeometry(radius, radius, length, 14), l1 = rbox(leaf, length * 0.96, radius * 0.5, radius * 0.2, 1).translate(-leaf / 2 - radius * 0.2, 0, radius * 0.4), l2 = rbox(leaf, length * 0.96, radius * 0.5, radius * 0.2, 1).translate(leaf / 2 + radius * 0.2, 0, radius * 0.4);
  const pin = new CylinderGeometry(radius * 0.45, radius * 0.45, length * 1.04, 10); return merge([barrel, l1, l2, pin]);
}
export function grille(w: number, h: number, slats: number, depth = 0.01, orientation: 'horizontal' | 'vertical' = 'horizontal'): BufferGeometry[] {
  const out: BufferGeometry[] = [], t = (orientation === 'horizontal' ? h : w) / (slats * 2 + 1);
  for (let i = 0; i < slats; i++) { const o = (i - (slats - 1) / 2) * t * 2; out.push(orientation === 'horizontal' ? rbox(w, t, depth, t * 0.3, 1).translate(0, o, 0) : rbox(t, h, depth, t * 0.3, 1).translate(o, 0, 0)); }
  return out;
}
/** A hose or cable through points, with end collars. */
export function hose(points: Vector3[], radius: number, tubular = 40, radial = 10): BufferGeometry {
  const body = pipe(points, radius, tubular, radial), curve = new CatmullRomCurve3(points, false, 'centripetal'), collars: BufferGeometry[] = [body];
  for (const t of [0.02, 0.98]) { const c = new CylinderGeometry(radius * 1.35, radius * 1.35, radius * 2.2, radial + 2), p = curve.getPointAt(t), d = curve.getTangentAt(t); c.applyQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), d)); c.translate(p.x, p.y, p.z); collars.push(c); }
  return merge(collars);
}
export { pipe };
export function tubeAlong(points: Vector3[], radius: number, tubular = 32, radial = 10): BufferGeometry { return new TubeGeometry(new CatmullRomCurve3(points, false, 'centripetal'), tubular, radius, radial, false); }

// ---------------------------------------------------------------------------------------------------------------------------------- deformation and subdivision
export type Axis = 'x' | 'y' | 'z';
/** Procedural deformation of positions by a function of (x, y, z); normals are recomputed. */
export function deform(g: BufferGeometry, f: (p: Vector3) => Vector3): BufferGeometry {
  const pos = g.getAttribute('position'), v = new Vector3(); for (let i = 0; i < pos.count; i++) { v.fromBufferAttribute(pos, i); const o = f(v.clone()); pos.setXYZ(i, o.x, o.y, o.z); }
  g.computeVertexNormals(); return g;
}
export const bend = (g: BufferGeometry, axis: Axis, curvature: number) => deform(g, (p) => { if (!curvature) return p; const other: Axis = axis === 'x' ? 'y' : 'x', a = p[axis] * curvature, q = p.clone(), o = p[other]; q[axis] = Math.sin(a) / curvature - o * Math.sin(a); q[other] = (1 - Math.cos(a)) / curvature + o * Math.cos(a); return q; });
export const taper = (g: BufferGeometry, axis: Axis, from: number, to: number) => { g.computeBoundingBox(); const bb = g.boundingBox!, lo = bb.min[axis], hi = bb.max[axis]; return deform(g, (p) => { const t = (p[axis] - lo) / (hi - lo || 1), s = from + (to - from) * t, q = p.clone(); for (const k of ['x', 'y', 'z'] as Axis[]) if (k !== axis) q[k] *= s; return q; }); };
export const twist = (g: BufferGeometry, axis: Axis, total: number) => { g.computeBoundingBox(); const bb = g.boundingBox!, lo = bb.min[axis], hi = bb.max[axis]; return deform(g, (p) => { const a = ((p[axis] - lo) / (hi - lo || 1)) * total, c = Math.cos(a), s = Math.sin(a), q = p.clone(), [u, w] = axis === 'y' ? (['x', 'z'] as const) : axis === 'x' ? (['y', 'z'] as const) : (['x', 'y'] as const); q[u] = p[u] * c - p[w] * s; q[w] = p[u] * s + p[w] * c; return q; }); };

/** Midpoint subdivision with relaxation (each level quadruples the triangles; limited to 3 levels). Smooths hard-surface transitions on a coarse loft. */
export function subdivide(source: BufferGeometry, levels = 1, relax = 0.25): BufferGeometry {
  let g = mergeVertices(source); for (let l = 0; l < Math.min(3, levels); l++) {
    const p = g.getAttribute('position'), ix = g.index!, pos: number[] = Array.from(p.array as Float32Array), idx: number[] = [], cache = new Map<number, number>(), n = p.count;
    const mid = (a: number, b: number) => { const key = a < b ? a * 0x1000000 + b : b * 0x1000000 + a, hit = cache.get(key); if (hit !== undefined) return hit; const i = pos.length / 3; pos.push((pos[a * 3]! + pos[b * 3]!) / 2, (pos[a * 3 + 1]! + pos[b * 3 + 1]!) / 2, (pos[a * 3 + 2]! + pos[b * 3 + 2]!) / 2); cache.set(key, i); return i; };
    for (let i = 0; i < ix.count; i += 3) { const a = ix.getX(i), b = ix.getX(i + 1), c = ix.getX(i + 2), ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); idx.push(a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca); }
    // relaxation: pull original vertices toward the mean of their neighbours (Laplacian, bounded)
    const sum = new Float32Array(n * 3), cnt = new Uint16Array(n); for (let i = 0; i < idx.length; i += 3) for (let k = 0; k < 3; k++) { const a = idx[i + k]!, b = idx[i + (k + 1) % 3]!; if (a < n && b < n) { for (let j = 0; j < 3; j++) sum[a * 3 + j]! += pos[b * 3 + j]!; cnt[a]!++; } }
    for (let v = 0; v < n; v++) if (cnt[v]) for (let j = 0; j < 3; j++) pos[v * 3 + j] = pos[v * 3 + j]! * (1 - relax) + (sum[v * 3 + j]! / cnt[v]!) * relax;
    const out = new BufferGeometry(); out.setAttribute('position', new Float32BufferAttribute(pos, 3)); out.setIndex(idx); g.dispose(); g = out;
  }
  g.computeVertexNormals(); return g;
}
/** Welds coincident vertices (position only) so subdivision and topology checks see shared edges. */
export function mergeVertices(source: BufferGeometry, tolerance = 1e-5): BufferGeometry {
  const p = source.getAttribute('position'), map = new Map<string, number>(), pos: number[] = [], remap: number[] = [], inv = 1 / tolerance;
  for (let i = 0; i < p.count; i++) { const k = `${Math.round(p.getX(i) * inv)},${Math.round(p.getY(i) * inv)},${Math.round(p.getZ(i) * inv)}`; let j = map.get(k); if (j === undefined) { j = pos.length / 3; map.set(k, j); pos.push(p.getX(i), p.getY(i), p.getZ(i)); } remap.push(j); }
  const idx: number[] = []; const ix = source.index; const n = ix ? ix.count : p.count;
  for (let i = 0; i < n; i += 3) { const a = remap[ix ? ix.getX(i) : i]!, b = remap[ix ? ix.getX(i + 1) : i + 1]!, c = remap[ix ? ix.getX(i + 2) : i + 2]!; if (a !== b && b !== c && a !== c) idx.push(a, b, c); }
  const g = new BufferGeometry(); g.setAttribute('position', new Float32BufferAttribute(pos, 3)); g.setIndex(idx); return g;
}

// ---------------------------------------------------------------------------------------------------------------------------------- implicit surfaces
export type BlobShape = { type: 'sphere'; c: [number, number, number]; r: number } | { type: 'capsule'; a: [number, number, number]; b: [number, number, number]; r: number; r2?: number } | { type: 'ellipsoid'; c: [number, number, number]; radii: [number, number, number] };
export type BlobSpec = { shapes: BlobShape[]; /** smooth-union radius */ k: number; seed?: number; /** organic surface noise amplitude as a fraction of k */ noise?: number; maxTriangles?: number; maxCells?: number };
const capsuleDistance = (p: Vector3, a: Vector3, b: Vector3, r: number, r2: number) => { const pa = p.clone().sub(a), ba = b.clone().sub(a), t = Math.max(0, Math.min(1, pa.dot(ba) / (ba.lengthSq() || 1))); return pa.sub(ba.multiplyScalar(t)).length() - (r + (r2 - r) * t); };
/**
 * Smooth union of spheres, capsules and ellipsoids, extracted with surface nets (closed, topology reported). The cell size is chosen from `maxCells` and the result
 * is rejected, not truncated, when it exceeds `maxTriangles`. `noise` adds seeded organic undulation. Deterministic.
 */
export function blobField(spec: BlobSpec): { geometry: BufferGeometry; report: TopologyReport; cell: number } {
  const shapes = spec.shapes, box = { min: new Vector3(Infinity, Infinity, Infinity), max: new Vector3(-Infinity, -Infinity, -Infinity) }, grow = (v: number[], r: number) => { for (let i = 0; i < 3; i++) { box.min.setComponent(i, Math.min(box.min.getComponent(i), v[i]! - r)); box.max.setComponent(i, Math.max(box.max.getComponent(i), v[i]! + r)); } };
  for (const s of shapes) { if (s.type === 'sphere') grow(s.c, s.r); else if (s.type === 'ellipsoid') grow(s.c, Math.max(...s.radii)); else { grow(s.a, Math.max(s.r, s.r2 ?? s.r)); grow(s.b, Math.max(s.r, s.r2 ?? s.r)); } }
  const pad = spec.k * 1.5 + 0.02, size = box.max.clone().sub(box.min).addScalar(2 * pad), cells = spec.maxCells ?? 64, cell = Math.max(size.x, size.y, size.z) / cells;
  const rnd = rng(spec.seed ?? 1), ph = Array.from({ length: 9 }, () => rnd() * Math.PI * 2), amp = (spec.noise ?? 0) * spec.k, tmp = new Vector3();
  const shapeDist = shapes.map((s) => s.type === 'sphere' ? (p: Vector3) => p.distanceTo(tmp.set(...s.c)) - s.r : s.type === 'ellipsoid' ? (p: Vector3) => { const q = p.clone().sub(new Vector3(...s.c)); q.set(q.x / s.radii[0], q.y / s.radii[1], q.z / s.radii[2]); return (q.length() - 1) * Math.min(...s.radii); } : (p: Vector3) => capsuleDistance(p, new Vector3(...s.a), new Vector3(...s.b), s.r, s.r2 ?? s.r));
  const point = new Vector3();
  const field = (x: number, y: number, z: number) => { point.set(x, y, z); let d = Infinity; for (const f of shapeDist) d = smoothMin(d, f(point), spec.k); if (amp) d += amp * (Math.sin(x * 9 + ph[0]!) * Math.sin(y * 8 + ph[1]!) * 0.5 + Math.sin(z * 11 + ph[2]!) * Math.sin(x * 7 + ph[3]!) * 0.35 + Math.sin((x + y + z) * 5 + ph[4]!) * 0.15); return d; };
  const dims = [0, 1, 2].map((a) => Math.max(2, Math.ceil((size.getComponent(a) + 2 * cell) / cell))) as [number, number, number];
  const g = surfaceNets({ min: box.min.clone().subScalar(pad + cell), cells: dims, size: cell, field, maxTriangles: spec.maxTriangles ?? 60000 });
  return { geometry: g, report: topologyReport(g), cell };
}

// ---------------------------------------------------------------------------------------------------------------------------------- topology
export type TopologyReport = { triangles: number; vertices: number; boundaryEdges: number; nonManifoldEdges: number; degenerate: number; closed: boolean; volume: number; area: number };
/** Edge-use census. `closed` = every edge is shared by exactly two triangles. */
export function topologyReport(source: BufferGeometry): TopologyReport {
  const g = mergeVertices(source), ix = g.index!, p = g.getAttribute('position'), edges = new Map<number, number>(); let degenerate = 0, area = 0; const a = new Vector3(), b = new Vector3(), c = new Vector3();
  for (let i = 0; i < ix.count; i += 3) { const t = [ix.getX(i), ix.getX(i + 1), ix.getX(i + 2)] as const; for (let k = 0; k < 3; k++) { const u = t[k]!, v = t[(k + 1) % 3]!, key = u < v ? u * 0x1000000 + v : v * 0x1000000 + u; edges.set(key, (edges.get(key) ?? 0) + 1); } a.fromBufferAttribute(p, t[0]); b.fromBufferAttribute(p, t[1]); c.fromBufferAttribute(p, t[2]); const ar = new Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).length() / 2; area += ar; if (ar < 1e-12) degenerate++; }
  let boundary = 0, nonManifold = 0; for (const n of edges.values()) { if (n === 1) boundary++; else if (n > 2) nonManifold++; }
  const report = { triangles: ix.count / 3, vertices: p.count, boundaryEdges: boundary, nonManifoldEdges: nonManifold, degenerate, closed: boundary === 0 && nonManifold === 0, volume: Math.abs(signedVolume(g)), area }; g.dispose(); return report;
}

export const v3 = (x: number, y: number, z: number) => new Vector3(x, y, z);
export const v2 = (x: number, y: number) => new Vector2(x, y);
export { extrudeProfile as extrude, ExtrudeGeometry, Shape };
