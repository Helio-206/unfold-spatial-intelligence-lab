import { Box3, CatmullRomCurve3, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { GeometryNodeV2, MaterialV2, RepeatPatternV2 } from '../contracts-v2';
import { boxEdgeRadius } from '../geometry-compiler-v2';
import type { Field } from './surface-nets';

/**
 * Signed distance fields for the V2 operators that have a closed-form or accurate distance. They are built from THE PLAN'S OWN PARAMETERS, with the same
 * transforms, repeats and conventions as `geometry-compiler-v2` (Three's axes: cylinders and cones along Y, torus in XY), so a continuous surface is the
 * same shape as the V2 one, only joined and smoothed. `extrude`, `revolve` and `loft` have no cheap exact field here: a component that uses them stays on V2.
 */
export const IMPLICIT_OPERATORS = ['box', 'rounded_box', 'sphere', 'ellipsoid', 'cylinder', 'cone', 'torus', 'tube'] as const;
export type ImplicitOperator = (typeof IMPLICIT_OPERATORS)[number];
export type ImplicitShape = { key: string; operator: ImplicitOperator; material: MaterialV2; box: Box3; /** radius of the thinnest feature, in component units */ featureRadius: number; field: Field };
export type ImplicitFailure = { code: 'OPERATOR_NOT_IMPLICIT' | 'TOO_MANY_INSTANCES'; detail: string };

/** Polynomial smooth minimum: equals `min` when the two distances differ by at least `k`, and fillets the crossing otherwise. */
export const smoothMin = (a: number, b: number, k: number): number => { if (k <= 0) return Math.min(a, b); const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
export const unionField = (fields: Field[], k: number): Field => (x, y, z) => { let d = Infinity; for (const f of fields) d = smoothMin(d, f(x, y, z), k); return d; };

/**
 * Same result as `unionField`, much cheaper: a shape whose bounding box is farther than the best distance so far plus the blend radius cannot change the
 * result, so it is not evaluated. Exact for shapes with uniform scale; under non-uniform scale a field underestimates distance, so a far shape's
 * influence could in theory be missed (only at distances beyond `k`, never near a surface).
 */
export const unionFieldCulled = (shapes: Pick<ImplicitShape, 'field' | 'box'>[], k: number): Field => (x, y, z) => {
  let d = Infinity;
  for (const s of shapes) {
    const b = s.box, dx = Math.max(b.min.x - x, 0, x - b.max.x), dy = Math.max(b.min.y - y, 0, y - b.max.y), dz = Math.max(b.min.z - z, 0, z - b.max.z);
    if (d !== Infinity && Math.hypot(dx, dy, dz) > d + k) continue;
    d = smoothMin(d, s.field(x, y, z), k);
  }
  return d;
};

const sdBox = (x: number, y: number, z: number, hx: number, hy: number, hz: number) => { const qx = Math.abs(x) - hx, qy = Math.abs(y) - hy, qz = Math.abs(z) - hz; return Math.hypot(Math.max(qx, 0), Math.max(qy, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qy, qz), 0); };
const sdCappedCone = (x: number, y: number, z: number, h: number, r1: number, r2: number) => {
  const qx = Math.hypot(x, z), qy = y, k2x = r2 - r1, k2y = 2 * h, cax = qx - Math.min(qx, qy < 0 ? r1 : r2), cay = Math.abs(qy) - h;
  const t = Math.min(1, Math.max(0, ((r2 - qx) * k2x + (h - qy) * k2y) / (k2x * k2x + k2y * k2y))), cbx = qx - r2 + k2x * t, cby = qy - h + k2y * t;
  const s = cbx < 0 && cay < 0 ? -1 : 1; return s * Math.sqrt(Math.min(cax * cax + cay * cay, cbx * cbx + cby * cby));
};
const sdSegment = (x: number, y: number, z: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
  const pax = x - ax, pay = y - ay, paz = z - az, bax = bx - ax, bay = by - ay, baz = bz - az, t = Math.min(1, Math.max(0, (pax * bax + pay * bay + paz * baz) / (bax * bax + bay * bay + baz * baz || 1)));
  return Math.hypot(pax - bax * t, pay - bay * t, paz - baz * t);
};

function repeatMatrices(repeat: RepeatPatternV2 | null): Matrix4[] {
  if (!repeat) return [new Matrix4()];
  const axis = repeat.axis === 'x' ? 0 : repeat.axis === 'y' ? 1 : 2, out: Matrix4[] = [];
  for (let i = 0; i < repeat.count; i++) {
    const position = new Vector3(), quaternion = new Quaternion();
    if (repeat.kind === 'linear') position.setComponent(axis, (i - (repeat.count - 1) / 2) * repeat.spacingOrRadius);
    else { const angle = (i * Math.PI * 2) / repeat.count, u = (axis + 1) % 3, v = (axis + 2) % 3; position.setComponent(u, Math.cos(angle) * repeat.spacingOrRadius); position.setComponent(v, Math.sin(angle) * repeat.spacingOrRadius); quaternion.setFromAxisAngle(new Vector3().setComponent(axis, 1), angle); }
    out.push(new Matrix4().compose(position, quaternion, new Vector3(1, 1, 1)));
  }
  return out;
}
const nodeMatrix = (t: GeometryNodeV2['transform']) => new Matrix4().compose(new Vector3(...t.position), new Quaternion().setFromEuler(new Euler(...t.rotationRad)), new Vector3(...t.scale));

/** Field of one primitive, in ITS local space, plus its local box and thinnest feature radius. */
function primitive(node: Extract<GeometryNodeV2, { type: 'shape' }>): { local: Field; box: Box3; feature: number } {
  const p = node.parameters as Record<string, unknown>;
  switch (node.operator as ImplicitOperator) {
    case 'box': { const d = p.dimensions as number[], r = boxEdgeRadius(d), hx = d[0]! / 2 - r, hy = d[1]! / 2 - r, hz = d[2]! / 2 - r; return { local: (x, y, z) => sdBox(x, y, z, hx, hy, hz) - r, box: new Box3(new Vector3(-d[0]! / 2, -d[1]! / 2, -d[2]! / 2), new Vector3(d[0]! / 2, d[1]! / 2, d[2]! / 2)), feature: Math.min(...d) / 2 }; }
    case 'rounded_box': { const d = p.dimensions as number[], r = Math.min(Number(p.bevelM), Math.min(...d) / 2), hx = d[0]! / 2 - r, hy = d[1]! / 2 - r, hz = d[2]! / 2 - r; return { local: (x, y, z) => sdBox(x, y, z, hx, hy, hz) - r, box: new Box3(new Vector3(-d[0]! / 2, -d[1]! / 2, -d[2]! / 2), new Vector3(d[0]! / 2, d[1]! / 2, d[2]! / 2)), feature: Math.min(...d) / 2 }; }
    case 'sphere': { const r = Number(p.radius); return { local: (x, y, z) => Math.hypot(x, y, z) - r, box: new Box3(new Vector3(-r, -r, -r), new Vector3(r, r, r)), feature: r }; }
    case 'ellipsoid': { const [rx, ry, rz] = p.radii as number[]; return { local: (x, y, z) => { const k0 = Math.hypot(x / rx!, y / ry!, z / rz!), k1 = Math.hypot(x / (rx! * rx!), y / (ry! * ry!), z / (rz! * rz!)); return k1 === 0 ? -Math.min(rx!, ry!, rz!) : (k0 * (k0 - 1)) / k1; }, box: new Box3(new Vector3(-rx!, -ry!, -rz!), new Vector3(rx!, ry!, rz!)), feature: Math.min(rx!, ry!, rz!) }; }
    case 'cylinder': { const rt = Number(p.radiusTop), rb = Number(p.radiusBottom), h = Number(p.height) / 2, rm = Math.max(rt, rb); return { local: (x, y, z) => sdCappedCone(x, y, z, h, rb, rt), box: new Box3(new Vector3(-rm, -h, -rm), new Vector3(rm, h, rm)), feature: Math.min(rm, h) }; }
    case 'cone': { const r = Number(p.radius), h = Number(p.height) / 2; return { local: (x, y, z) => sdCappedCone(x, y, z, h, r, 0), box: new Box3(new Vector3(-r, -h, -r), new Vector3(r, h, r)), feature: Math.min(r, h) / 2 }; }
    case 'torus': { const R = Number(p.majorRadius), r = Number(p.tubeRadius); return { local: (x, y, z) => Math.hypot(Math.hypot(x, y) - R, z) - r, box: new Box3(new Vector3(-R - r, -R - r, -r), new Vector3(R + r, R + r, r)), feature: r }; }
    case 'tube': {
      const pts = (p.points as number[][]).map((q) => new Vector3(...(q as [number, number, number]))), r = Number(p.radius);
      const samples = new CatmullRomCurve3(pts, false, 'centripetal').getPoints(Math.max(8, pts.length * 12)), n = samples.length - 1, flat = new Float64Array(samples.length * 3); samples.forEach((s, i) => flat.set([s.x, s.y, s.z], i * 3));
      const box = new Box3().setFromPoints(samples).expandByScalar(r);
      return { local: (x, y, z) => { let d = Infinity; for (let i = 0; i < n; i++) { const s = sdSegment(x, y, z, flat[i * 3]!, flat[i * 3 + 1]!, flat[i * 3 + 2]!, flat[i * 3 + 3]!, flat[i * 3 + 4]!, flat[i * 3 + 5]!); if (s < d) d = s; } return d - r; }, box, feature: r };
    }
  }
}

/** Every shape of a component's geometry tree as a field in COMPONENT space (repeats expanded, transforms applied). Fails with a code, never partially. */
export function implicitShapesOf(geometry: GeometryNodeV2, maxInstances = 192): ImplicitShape[] | ImplicitFailure {
  const out: ImplicitShape[] = []; let failure: ImplicitFailure | null = null;
  const walk = (node: GeometryNodeV2, parent: Matrix4) => {
    if (failure) return;
    for (const r of repeatMatrices(node.repeat)) {
      const m = parent.clone().multiply(nodeMatrix(node.transform)).multiply(r);
      if (node.type === 'group') { for (const child of node.children) walk(child, m); continue; }
      if (!(IMPLICIT_OPERATORS as readonly string[]).includes(node.operator)) { failure = { code: 'OPERATOR_NOT_IMPLICIT', detail: node.operator }; return; }
      if (out.length >= maxInstances) { failure = { code: 'TOO_MANY_INSTANCES', detail: `${out.length}` }; return; }
      const { local, box, feature } = primitive(node), inverse = m.clone().invert(), e = inverse.elements;
      const sx = new Vector3().setFromMatrixColumn(m, 0).length(), sy = new Vector3().setFromMatrixColumn(m, 1).length(), sz = new Vector3().setFromMatrixColumn(m, 2).length(), scale = Math.min(sx, sy, sz);
      out.push({ key: node.key, operator: node.operator as ImplicitOperator, material: node.material, box: box.clone().applyMatrix4(m), featureRadius: feature * scale,
        field: (x, y, z) => local(e[0]! * x + e[4]! * y + e[8]! * z + e[12]!, e[1]! * x + e[5]! * y + e[9]! * z + e[13]!, e[2]! * x + e[6]! * y + e[10]! * z + e[14]!) * scale });
    }
  };
  walk(geometry, new Matrix4());
  return failure ?? out;
}
