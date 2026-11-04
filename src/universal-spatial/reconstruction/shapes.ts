import { Box3, Mesh, Vector3, type Object3D } from 'three';
import { applySpatialOperationV2, type GeometryNodeV2, type SpatialOperationV2, type SpatialPlanV2 } from '../contracts-v2';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../geometry-compiler-v2';
import type { EvidenceView } from './engine';
import { maskIoU, rasterise, type Tri } from './silhouette';

/**
 * Primitive alternatives: when a part is drawn with a primitive that does not match what the evidence shows (a box where the silhouette is round), propose another
 * parametric primitive from the SAME operator set, with parameters taken from the part's own extent, and keep it only if the silhouettes agree better on the views
 * given AND no worse on views left out. The proposal is one typed `set-geometry` on the existing shape node (same key, same component, same transform, same material):
 * reversible, previewed, authorised. It never adds a component and never invents detail; it changes how an existing part is described. The candidate table is returned
 * whether or not anything is proposed, so the investigation is visible.
 */
export type Operator = 'box' | 'cylinder' | 'ellipsoid' | 'cone';
export type ShapeCandidate = { operator: Operator; axis: 'x' | 'y' | 'z' | null; node: GeometryNodeV2; fitIou: number; heldOutIou: number | null; triangles: number };
export type ShapeFinding = { componentId: string; nodeKey: string; current: string; currentFitIou: number; currentHeldOutIou: number | null; candidates: ShapeCandidate[]; proposal: { operation: SpatialOperationV2; to: Operator; axis: ShapeCandidate['axis']; evidence: string } | null; reason: string };
export type ShapeOptions = { components?: string[]; minImprovement?: number };
type Shape = Extract<GeometryNodeV2, { type: 'shape' }>;
const SWAPPABLE = new Set(['box', 'rounded_box', 'cylinder', 'ellipsoid', 'sphere', 'cone']);

const scene = (plan: SpatialPlanV2) => { const c = compileSpatialPlanV2(plan); c.root.updateMatrixWorld(true); const tris = new Map<string, Tri[]>(), worlds = new Map<string, import('three').Matrix4>(); c.root.traverse((o: Object3D) => { if (o.userData.spatialComponentRoot) worlds.set(o.userData.spatialEntityId as string, o.matrixWorld.clone()); if (!(o instanceof Mesh) || typeof o.userData.spatialEntityId !== 'string') return; const id = o.userData.spatialEntityId as string, pos = o.geometry.getAttribute('position'), idx = o.geometry.index, n = idx ? idx.count : pos.count, l = tris.get(id) ?? []; const v = (i: number) => new Vector3().fromBufferAttribute(pos, idx ? idx.getX(i) : i).applyMatrix4(o.matrixWorld); for (let i = 0; i + 2 < n; i += 3) l.push([v(i), v(i + 1), v(i + 2)]); tris.set(id, l); }); disposeCompiledSpatialPlan(c.root); return { tris, worlds }; };
const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Candidate shape nodes for a part whose extent in the component's own frame is `size` centred at `centre`. */
function candidatesFor(current: Shape, centre: Vector3, size: Vector3): Array<{ operator: Operator; axis: ShapeCandidate['axis']; node: Shape }> {
  const at = (rot: [number, number, number]) => ({ position: centre.toArray().map(r6) as [number, number, number], rotationRad: rot, scale: [1, 1, 1] as [number, number, number] }), base = { type: 'shape' as const, key: current.key, repeat: current.repeat, material: current.material };
  const out: Array<{ operator: Operator; axis: ShapeCandidate['axis']; node: Shape }> = [];
  out.push({ operator: 'box', axis: null, node: { ...base, operator: 'box', parameters: { dimensions: size.toArray().map(r6) }, transform: at([0, 0, 0]) } });
  out.push({ operator: 'ellipsoid', axis: null, node: { ...base, operator: 'ellipsoid', parameters: { radii: size.toArray().map((v) => r6(v / 2)), widthSegments: 24, heightSegments: 16 }, transform: at([0, 0, 0]) } });
  const cyl = (axis: 'x' | 'y' | 'z', radius: number, height: number, rot: [number, number, number]) => out.push({ operator: 'cylinder', axis, node: { ...base, operator: 'cylinder', parameters: { radiusTop: r6(radius), radiusBottom: r6(radius), height: r6(height), radialSegments: 24 }, transform: at(rot) } });
  cyl('y', (size.x + size.z) / 4, size.y, [0, 0, 0]); cyl('x', (size.y + size.z) / 4, size.x, [0, 0, Math.PI / 2]); cyl('z', (size.x + size.y) / 4, size.z, [Math.PI / 2, 0, 0]);
  out.push({ operator: 'cone', axis: 'y', node: { ...base, operator: 'cone', parameters: { radius: r6((size.x + size.z) / 4), height: r6(size.y), radialSegments: 24 }, transform: at([0, 0, 0]) } });
  return out;
}

export function proposeShapeAlternatives(plan: SpatialPlanV2, evidence: EvidenceView[], options: ShapeOptions = {}): ShapeFinding[] {
  const views = evidence.filter((e) => e.calibrated), hold = views.length >= 4 ? Math.max(1, Math.floor(views.length / 4)) : 0, keep = views.length - hold, minGain = options.minImprovement ?? 0.01;
  const base = scene(plan), iou = (tris: Tri[], from: number, to: number) => { let s = 0; for (let i = from; i < to; i++) s += maskIoU(rasterise(tris, views[i]!.view), views[i]!.mask); return s / Math.max(1, to - from); };
  const findings: ShapeFinding[] = [];
  for (const comp of plan.components) {
    if (options.components && !options.components.includes(comp.id)) continue;
    const g = comp.geometry; if (g.type !== 'shape' || !SWAPPABLE.has(g.operator) || g.repeat !== null) continue;
    const mine = base.tris.get(comp.id); if (!mine?.length) continue;
    const others = [...base.tris].filter(([id]) => id !== comp.id).flatMap(([, t]) => t), invWorld = base.worlds.get(comp.id)!.clone().invert(), lb = new Box3();
    for (const t of mine) for (const p of t) lb.expandByPoint(p.clone().applyMatrix4(invWorld));
    const size = lb.getSize(new Vector3()), centre = lb.getCenter(new Vector3()); if (Math.min(size.x, size.y, size.z) < 1e-9) continue;
    const score = (tris: Tri[]) => ({ fit: iou([...others, ...tris], 0, keep || views.length), held: hold ? iou([...others, ...tris], keep, views.length) : null });
    const cur = score(mine), table: ShapeCandidate[] = [];
    for (const cand of candidatesFor(g, centre, size)) {
      const op: SpatialOperationV2 = { contract: 'unfold.spatial-operation.v2', operationId: `shape-${comp.id}-${cand.operator}${cand.axis ?? ''}`.slice(0, 80), kind: 'set-geometry', componentId: comp.id, nodeKey: g.key, value: cand.node };
      let next: SpatialPlanV2; try { next = applySpatialOperationV2(plan, op, { origin: 'inferred', evidence: 'candidate' }); } catch { continue; }
      const t = scene(next).tris.get(comp.id) ?? [], s = score(t); table.push({ operator: cand.operator, axis: cand.axis, node: cand.node, fitIou: s.fit, heldOutIou: s.held, triangles: t.length });
    }
    const sameKind = (c: ShapeCandidate) => c.operator === g.operator || (g.operator === 'rounded_box' && c.operator === 'box') || (g.operator === 'sphere' && c.operator === 'ellipsoid');
    const best = table.filter((c) => !sameKind(c)).sort((a, b) => b.fitIou - a.fitIou)[0];
    let proposal: ShapeFinding['proposal'] = null, reason = 'no alternative primitive explains the evidence better';
    if (best && best.fitIou >= cur.fit + minGain && (cur.held === null || best.heldOutIou! >= cur.held - 1e-6)) {
      const operation: SpatialOperationV2 = { contract: 'unfold.spatial-operation.v2', operationId: `shape-${comp.id}-${best.operator}${best.axis ?? ''}`.slice(0, 80), kind: 'set-geometry', componentId: comp.id, nodeKey: g.key, value: best.node };
      proposal = { operation, to: best.operator, axis: best.axis, evidence: `Primitive alternative: ${g.operator} -> ${best.operator}${best.axis ? ` (axis ${best.axis})` : ''}, parameters from the part's own extent; silhouette agreement ${cur.fit.toFixed(3)} -> ${best.fitIou.toFixed(3)} on ${keep || views.length} view(s)${cur.held !== null ? `, left-out views ${cur.held.toFixed(3)} -> ${best.heldOutIou!.toFixed(3)}` : ''}. Same node, same transform and material, no component added. Basis: inferred.` };
      reason = 'proposed';
    } else if (best && best.fitIou >= cur.fit + minGain) reason = 'better on the given views but worse on the views left out: not proposed';
    findings.push({ componentId: comp.id, nodeKey: g.key, current: g.operator, currentFitIou: cur.fit, currentHeldOutIou: cur.held, candidates: table, proposal, reason });
  }
  return findings;
}
