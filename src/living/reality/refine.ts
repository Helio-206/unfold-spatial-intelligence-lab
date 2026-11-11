import { hullSilhouette, maskIoUFast } from '../../universal-spatial/reconstruction/multiview';
import { buildModel, viewsOf, type PartMesh, type RealityModel } from './model';
import type { RealityEvidence } from './evidence';

/**
 * Integrates a new perspective into an existing reconstruction WITHOUT breaking what a person already did with it. The new evidence can only carve the
 * solid (a view never adds volume), so the result is compared with the previous solid; parts are matched to the previous ones by voxel overlap and keep
 * their ids and their origin, so every transform edit in the plan stays valid. Parts the evidence no longer supports are reported (not silently deleted
 * from the plan); parts that appear are reported as proposals (not added to the plan).
 */
export type RefinementDiff = {
  addedViewIds: string[];
  /** 1 - IoU(new silhouette, silhouette predicted by the previous solid): ~0 means the view told us nothing new */
  informationGain: Array<{ viewId: string; gain: number }>;
  voxelsBefore: number; voxelsAfter: number; removedFraction: number;
  heldOutBefore: number | null; heldOutAfter: number | null;
  matched: Array<{ id: string; overlap: number }>;
  droppedPartIds: string[];
  newPartIds: string[];
  verdict: 'informative' | 'redundant';
};
export type Refinement = { model: RealityModel; diff: RefinementDiff };

const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;

export function refineModel(prev: RealityModel, nextEvidence: RealityEvidence): Refinement {
  const g = prev.solid.grid, next = buildModel(nextEvidence, { cells: g.cells[0] });
  // matching by voxel overlap (same frame, same grid)
  const prevIds = prev.parts.map((p) => p.id);
  const overlap = new Map<string, number>();
  for (let i = 0; i < prev.solid.labels.length; i++) { const a = prev.solid.labels[i]!, b = next.solid.labels[i]!; if (a && b) overlap.set(`${a}|${b}`, (overlap.get(`${a}|${b}`) ?? 0) + 1); }
  const sizeOf = (labels: Uint16Array, l: number) => { let n = 0; for (let i = 0; i < labels.length; i++) if (labels[i] === l) n++; return n; };
  const pairs = [...overlap.entries()].map(([k, v]) => { const [a, b] = k.split('|').map(Number) as [number, number]; return { a, b, v }; }).sort((x, y) => y.v - x.v || x.a - y.a || x.b - y.b);
  const usedA = new Set<number>(), usedB = new Set<number>(), map = new Map<number, number>(); // new label -> old label
  for (const { a, b, v } of pairs) {
    if (usedA.has(a) || usedB.has(b)) continue;
    if (v < 0.3 * Math.min(sizeOf(prev.solid.labels, a), sizeOf(next.solid.labels, b))) continue;
    usedA.add(a); usedB.add(b); map.set(b, a);
  }
  const labelOfId = (id: string) => Number(id.replace('part-', ''));
  const prevByLabel = new Map(prev.parts.map((p) => [labelOfId(p.id), p])), taken = new Set(prevIds);
  let nextFresh = Math.max(0, ...prevIds.map(labelOfId)) + 1;
  const parts: PartMesh[] = [], matched: RefinementDiff['matched'] = [], newPartIds: string[] = [], rename = new Map<string, string>();
  for (const part of next.parts) {
    const oldLabel = map.get(labelOfId(part.id)), old = oldLabel !== undefined ? prevByLabel.get(oldLabel) : undefined;
    if (old) {
      // express the refined shell in the previous part's frame so the plan's transform for it stays correct
      const d = [part.origin[0] - old.origin[0], part.origin[1] - old.origin[1], part.origin[2] - old.origin[2]], positions = new Float32Array(part.positions.length);
      for (let i = 0; i < part.positions.length; i += 3) { positions[i] = part.positions[i]! + d[0]!; positions[i + 1] = part.positions[i + 1]! + d[1]!; positions[i + 2] = part.positions[i + 2]! + d[2]!; }
      parts.push({ ...part, id: old.id, origin: old.origin, positions }); rename.set(part.id, old.id); matched.push({ id: old.id, overlap: overlap.get(`${oldLabel}|${labelOfId(part.id)}`)! });
    } else {
      let id = `part-${nextFresh++}`; while (taken.has(id)) id = `part-${nextFresh++}`; taken.add(id);
      parts.push({ ...part, id }); rename.set(part.id, id); newPartIds.push(id);
    }
  }
  const model: RealityModel = { ...next, parts, adjacency: next.adjacency.map(([a, b]) => [rename.get(a) ?? a, rename.get(b) ?? b] as [string, string]) };
  const prevViews = new Set(prev.evidence.views.map((v) => v.id)), added = nextEvidence.views.filter((v) => !prevViews.has(v.id)), nextViews = viewsOf(nextEvidence);
  // the splat of a voxel solid is slightly larger than the silhouettes that carved it; that floor (measured on the views already in) is subtracted so a repeated view reads ~0
  const prevViews2 = viewsOf(prev.evidence), gap = (sv: { mask: Uint8Array; azimuthDeg: number; elevationDeg: number; res: number }) => 1 - maskIoUFast(sv.mask, hullSilhouette(g, prev.solid.occupancy, sv, prev.frame));
  const floor = mean(prevViews2.map(gap));
  const gains = added.map((v) => { const sv = nextViews.find((x) => x.id === v.id)!; return { viewId: v.id, gain: Math.max(0, gap(sv) - floor) }; });
  const count = (o: Uint8Array) => { let n = 0; for (const v of o) n += v; return n; };
  const before = count(prev.solid.occupancy), after = count(next.solid.occupancy);
  const heldBefore = prev.heldOutIoU ? mean(prev.heldOutIoU.map((x) => x.iou)) : null, heldAfter = next.heldOutIoU ? mean(next.heldOutIoU.map((x) => x.iou)) : null;
  const removedFraction = before ? Math.max(0, before - after) / before : 0;
  return {
    model,
    diff: {
      addedViewIds: added.map((v) => v.id), informationGain: gains, voxelsBefore: before, voxelsAfter: after, removedFraction, heldOutBefore: heldBefore, heldOutAfter: heldAfter,
      matched, droppedPartIds: prevIds.filter((id) => !matched.some((m) => m.id === id)), newPartIds,
      verdict: removedFraction < 0.002 && gains.every((x) => x.gain < 0.01) ? 'redundant' : 'informative',
    },
  };
}
