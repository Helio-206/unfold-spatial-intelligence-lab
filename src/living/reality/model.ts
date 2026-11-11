import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute, Vector3 } from 'three';
import { surfaceNets } from '../../universal-spatial/fidelity/surface-nets';
import { occupancyField } from '../../universal-spatial/reconstruction/silhouette';
import { leaveOneOutIoU, orbitDirection, reconstructHull, type Frame, type HullStats, type SilhouetteView } from '../../universal-spatial/reconstruction/multiview';
import { segmentParts, type PartOptions } from '../../universal-spatial/reconstruction/parts';
import { decodeColour, decodeMask, validateRealityEvidence, type RealityEvidence } from './evidence';

/**
 * The reconstruction a Space shows: a deterministic function of the stored evidence. Parts are closed shells in the local frame of their centroid, so
 * a transform edit on a component moves its shell and the plan (which holds the centroid as the component position) stays the editable truth.
 * Vertex colours come from the views that SEE the vertex; a vertex seen by no view is `observed = 0` and drawn as a hypothesis.
 */
export type PartMesh = {
  id: string; origin: [number, number, number]; size: [number, number, number]; voxels: number;
  positions: Float32Array; normals: Float32Array; indices: Uint32Array; colours: Float32Array; observed: Uint8Array;
  observedFraction: number;
};
export type RealityModel = {
  evidence: RealityEvidence;
  frame: Frame;
  parts: PartMesh[];
  adjacency: Array<[string, string]>;
  hull: HullStats;
  discardedVoxels: number;
  /** IoU of each view's silhouette with the hull of the OTHER views (null when fewer than 3 views) */
  heldOutIoU: Array<{ viewId: string; iou: number }> | null;
  /** object-level: fraction of vertices seen by at least one view */
  observedFraction: number;
  diagonal: number;
};

/** Convention shared with the benchmark and the intake: the orthographic window half-extent is 0.54 x the object's bounding-box diagonal. */
export const FRAME_HALF_PER_DIAGONAL = 0.54;
export const UNOBSERVED_COLOUR: [number, number, number] = [0.42, 0.48, 0.56];

export function viewsOf(evidence: RealityEvidence): SilhouetteView[] {
  return evidence.views.map((v) => ({ id: v.id, res: evidence.res, mask: decodeMask(v.maskRle, evidence.res * evidence.res), azimuthDeg: v.azimuthDeg, elevationDeg: v.elevationDeg, azimuthSource: v.azimuthSource }));
}

export function buildModel(input: RealityEvidence, options: { parts?: PartOptions } = {}): RealityModel {
  const evidence = validateRealityEvidence(input);
  const frame: Frame = { centre: new Vector3(...evidence.frame.centre), half: evidence.frame.half };
  const views = viewsOf(evidence);
  const hull = reconstructHull(views, { frame, cells: evidence.cells });
  const grid = hull.grid, [nx, ny] = grid.cells;
  const segmented = segmentParts(hull.occupancy, grid, options.parts);
  const dirs = views.map((v) => orbitDirection(v.azimuthDeg, v.elevationDeg));
  const colours = evidence.views.map((v) => (v.colour ? decodeColour(v.colour, evidence.colourRes) : null));
  const s = evidence.res / (2 * frame.half);
  const bases = dirs.map((d) => {
    const worldUp = Math.abs(d.y) > 0.98 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0);
    const right = new Vector3().crossVectors(worldUp, d).normalize(), up = new Vector3().crossVectors(d, right).normalize();
    return { d, right, up };
  });
  const occupied = (x: number, y: number, z: number): boolean => {
    const i = Math.floor((x - grid.min.x) / grid.size), j = Math.floor((y - grid.min.y) / grid.size), k = Math.floor((z - grid.min.z) / grid.size);
    return i >= 0 && j >= 0 && k >= 0 && i < nx && j < ny && k < grid.cells[2] && hull.occupancy[i + nx * (j + ny * k)] === 1;
  };
  const visible = (p: Vector3, n: Vector3, v: number): boolean => {
    const d = dirs[v]!; if (n.dot(d) < 0.15) return false;
    const step = grid.size * 0.7;
    for (let t = grid.size * 2; t < frame.half * 2.2; t += step) if (occupied(p.x + d.x * t, p.y + d.y * t, p.z + d.z * t)) return false;
    return true;
  };

  const parts: PartMesh[] = [];
  let seen = 0, total = 0;
  for (const part of segmented.parts) {
    const partOcc = new Uint8Array(hull.occupancy.length);
    for (let i = 0; i < partOcc.length; i++) if (segmented.labels[i] === part.label) partOcc[i] = 1;
    const field = occupancyField(grid, partOcc, 1);
    const g = surfaceNets({ min: grid.min, cells: grid.cells, size: grid.size, field, maxTriangles: 120_000 });
    const pos = g.getAttribute('position'), nor = g.getAttribute('normal'), idx = g.index;
    if (!pos || !idx || !pos.count) continue;
    const origin = part.centroid, count = pos.count;
    const positions = new Float32Array(count * 3), normals = new Float32Array(count * 3), colourOut = new Float32Array(count * 3), observed = new Uint8Array(count);
    const p = new Vector3(), n = new Vector3();
    for (let i = 0; i < count; i++) {
      p.set(pos.getX(i), pos.getY(i), pos.getZ(i)); n.set(nor.getX(i), nor.getY(i), nor.getZ(i)).normalize();
      positions[i * 3] = p.x - origin.x; positions[i * 3 + 1] = p.y - origin.y; positions[i * 3 + 2] = p.z - origin.z;
      normals[i * 3] = n.x; normals[i * 3 + 1] = n.y; normals[i * 3 + 2] = n.z;
      let wsum = 0, r = 0, gg = 0, b = 0, any = false;
      for (let v = 0; v < views.length; v++) {
        if (!visible(p, n, v)) continue;
        any = true;
        const rgb = colours[v]; if (!rgb) continue;
        const base = bases[v]!, dx = p.x - frame.centre.x, dy = p.y - frame.centre.y, dz = p.z - frame.centre.z;
        const u = (dx * base.right.x + dy * base.right.y + dz * base.right.z + frame.half) * s, w = (dx * base.up.x + dy * base.up.y + dz * base.up.z + frame.half) * s;
        const cu = Math.min(evidence.colourRes - 1, Math.max(0, Math.floor((u / evidence.res) * evidence.colourRes))), cw = Math.min(evidence.colourRes - 1, Math.max(0, Math.floor((w / evidence.res) * evidence.colourRes)));
        const q = (cw * evidence.colourRes + cu) * 3, weight = Math.pow(Math.max(0, n.dot(dirs[v]!)), 4);
        r += rgb[q]! * weight; gg += rgb[q + 1]! * weight; b += rgb[q + 2]! * weight; wsum += weight;
      }
      observed[i] = any ? 1 : 0; total++; if (any) seen++;
      if (wsum > 0) { colourOut[i * 3] = r / wsum / 255; colourOut[i * 3 + 1] = gg / wsum / 255; colourOut[i * 3 + 2] = b / wsum / 255; }
      else if (any) { colourOut[i * 3] = 0.72; colourOut[i * 3 + 1] = 0.72; colourOut[i * 3 + 2] = 0.72; } // seen in a mask-only view: shape observed, appearance unknown
      else { colourOut[i * 3] = UNOBSERVED_COLOUR[0]; colourOut[i * 3 + 1] = UNOBSERVED_COLOUR[1]; colourOut[i * 3 + 2] = UNOBSERVED_COLOUR[2]; }
    }
    let seenHere = 0; for (const o of observed) seenHere += o;
    parts.push({
      id: part.id, origin: [origin.x, origin.y, origin.z], size: [part.max.x - part.min.x, part.max.y - part.min.y, part.max.z - part.min.z], voxels: part.voxels,
      positions, normals, indices: Uint32Array.from(idx.array as ArrayLike<number>), colours: colourOut, observed, observedFraction: count ? seenHere / count : 0,
    });
  }
  const loo = leaveOneOutIoU(views, { frame, cells: Math.min(evidence.cells, 64) });
  return {
    evidence, frame, parts, adjacency: segmented.adjacency, hull: hull.stats, discardedVoxels: segmented.discardedVoxels,
    heldOutIoU: loo.length ? loo.map((value, i) => ({ viewId: views[i]!.id, iou: value })) : null,
    observedFraction: total ? seen / total : 0,
    diagonal: frame.half / FRAME_HALF_PER_DIAGONAL,
  };
}

export function partGeometry(part: PartMesh): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(part.positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(part.normals, 3));
  g.setAttribute('color', new Float32BufferAttribute(part.colours, 3));
  g.setAttribute('observed', new Float32BufferAttribute(Float32Array.from(part.observed), 1));
  g.setIndex(new Uint32BufferAttribute(part.indices, 1));
  g.computeBoundingSphere();
  return g;
}
