import { BufferGeometry, Float32BufferAttribute, Uint32BufferAttribute, Vector3 } from 'three';
import { surfaceNets } from '../../universal-spatial/fidelity/surface-nets';
import { type Grid } from '../../universal-spatial/reconstruction/silhouette';
import { hullField, leaveOneOutIoU, orbitDirection, reconstructHull, signedDistance2D, type Frame, type HullStats, type SilhouetteView } from '../../universal-spatial/reconstruction/multiview';
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
  /** the solid and its part labels, kept so a refinement can be compared with and matched to this one */
  solid: { grid: Grid; occupancy: Uint8Array; labels: Uint16Array };
  discardedVoxels: number;
  /** IoU of each view's silhouette with the hull of the OTHER views (null when fewer than 3 views) */
  heldOutIoU: Array<{ viewId: string; iou: number }> | null;
  /** object-level: fraction of vertices seen by at least one view */
  observedFraction: number;
  diagonal: number;
  /** the grid was reduced to stay within the triangle budget (declared, never silent) */
  degraded: { fromCells: number; toCells: number; triangles: number } | null;
};
export const MODEL_TRIANGLE_BUDGET = 160_000;

/** Convention shared with the benchmark and the intake: the orthographic window half-extent is 0.54 x the object's bounding-box diagonal. */
export const FRAME_HALF_PER_DIAGONAL = 0.54;
export const UNOBSERVED_COLOUR: [number, number, number] = [0.42, 0.48, 0.56];

export function viewsOf(evidence: RealityEvidence): SilhouetteView[] {
  return evidence.views.map((v) => ({ id: v.id, res: evidence.res, mask: decodeMask(v.maskRle, evidence.res * evidence.res), azimuthDeg: v.azimuthDeg, elevationDeg: v.elevationDeg, azimuthSource: v.azimuthSource }));
}

export function buildModel(input: RealityEvidence, options: { parts?: PartOptions; /** force a grid (a refinement must use the grid of the solid it is compared with) */ cells?: number; maxTriangles?: number } = {}): RealityModel {
  const model = buildModelAt(validateRealityEvidence(input), options.cells ?? undefined, options);
  const budget = options.maxTriangles ?? MODEL_TRIANGLE_BUDGET, total = model.parts.reduce((n, p) => n + p.indices.length / 3, 0);
  if (options.cells !== undefined || total <= budget) return model;
  // progressive degradation: a coarser grid with the same evidence, declared on the model
  let cells = model.evidence.cells, best = model;
  for (let guard = 0; guard < 3; guard++) {
    cells = Math.max(32, Math.floor(cells * Math.sqrt(budget / Math.max(1, best.parts.reduce((n, p) => n + p.indices.length / 3, 0))) * 0.92));
    best = buildModelAt(model.evidence, cells, options);
    const t = best.parts.reduce((n, p) => n + p.indices.length / 3, 0);
    if (t <= budget || cells <= 32) { best.degraded = { fromCells: model.evidence.cells, toCells: cells, triangles: t }; return best; }
  }
  best.degraded = { fromCells: model.evidence.cells, toCells: cells, triangles: best.parts.reduce((n, p) => n + p.indices.length / 3, 0) }; return best;
}

function buildModelAt(evidence: RealityEvidence, cellsOverride: number | undefined, options: { parts?: PartOptions }): RealityModel {
  const frame: Frame = { centre: new Vector3(...evidence.frame.centre), half: evidence.frame.half };
  const views = viewsOf(evidence);
  const hull = reconstructHull(views, { frame, cells: cellsOverride ?? evidence.cells });
  const grid = hull.grid, [nx, ny] = grid.cells;
  const segmented = segmentParts(hull.occupancy, grid, options.parts);
  const dirs = views.map((v) => orbitDirection(v.azimuthDeg, v.elevationDeg));
  const colours = evidence.views.map((v) => (v.colour ? decodeColour(v.colour, evidence.colourRes) : null));
  const s = evidence.res / (2 * frame.half), exact = hullField(views, frame);
  // A hull is larger than the object, so a surface point can project onto the BACKGROUND of a view. Colour is only taken where the point lands well
  // inside that view's silhouette (>= COLOUR_MARGIN_PX from its edge); otherwise that view does not speak for the point's appearance.
  const sdf = views.map((v) => signedDistance2D(v.mask, evidence.res));
  const COLOUR_MARGIN_PX = 2.5;
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

  // exact hull values on the lattice, computed once and shared by every part's surface extraction (off-lattice samples, used for normals, fall back to the function)
  const lx = nx + 1, ly = ny + 1, lz = grid.cells[2] + 1, lattice = new Float32Array(lx * ly * lz);
  for (let k = 0; k < lz; k++) for (let j = 0; j < ly; j++) for (let i = 0; i < lx; i++) lattice[i + lx * (j + ly * k)] = exact(grid.min.x + i * grid.size, grid.min.y + j * grid.size, grid.min.z + k * grid.size);
  const exactAt = (x: number, y: number, z: number): number => {
    const fi = (x - grid.min.x) / grid.size, fj = (y - grid.min.y) / grid.size, fk = (z - grid.min.z) / grid.size, i = Math.round(fi), j = Math.round(fj), k = Math.round(fk);
    if (Math.abs(fi - i) < 1e-6 && Math.abs(fj - j) < 1e-6 && Math.abs(fk - k) < 1e-6 && i >= 0 && j >= 0 && k >= 0 && i < lx && j < ly && k < lz) return lattice[i + lx * (j + ly * k)]!;
    return exact(x, y, z);
  };
  const parts: PartMesh[] = [];
  let seen = 0, total = 0;
  for (const part of segmented.parts) {
    // Closed shell of one part: the exact hull field outside, and the interface with the neighbouring parts inside. The interface comes from the LABELS of the
    // voxels around each lattice point (share of this part among the labelled voxels that touch it), so it exists only where this part really meets another one;
    // a blurred "other parts" mask would leave a thin skin of hull around every other part. Only the part's own box (plus a margin) is sampled.
    const m = 2, i0 = Math.max(0, Math.floor((part.min.x - grid.min.x) / grid.size) - m), j0 = Math.max(0, Math.floor((part.min.y - grid.min.y) / grid.size) - m), k0 = Math.max(0, Math.floor((part.min.z - grid.min.z) / grid.size) - m);
    const i1 = Math.min(nx, Math.ceil((part.max.x - grid.min.x) / grid.size) + m), j1 = Math.min(ny, Math.ceil((part.max.y - grid.min.y) / grid.size) + m), k1 = Math.min(grid.cells[2], Math.ceil((part.max.z - grid.min.z) / grid.size) + m);
    const interfaceScale = 2 * grid.size * s, sx = i1 - i0 + 1, sy = j1 - j0 + 1, sz = k1 - k0 + 1, iface = new Float32Array(sx * sy * sz), nz = grid.cells[2];
    for (let k = 0; k < sz; k++) for (let j = 0; j < sy; j++) for (let i = 0; i < sx; i++) {
      let own = 0, other = 0;
      for (let dk = -1; dk <= 0; dk++) for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) {
        const vi = i0 + i + di, vj = j0 + j + dj, vk = k0 + k + dk; if (vi < 0 || vj < 0 || vk < 0 || vi >= nx || vj >= ny || vk >= nz) continue;
        const l = segmented.labels[vi + nx * (vj + ny * vk)]!; if (!l) continue; if (l === part.label) own++; else other++;
      }
      iface[i + sx * (j + sy * k)] = (own + other ? 0.5 - own / (own + other) : -0.5) * interfaceScale;
    }
    const interfaceAt = (x: number, y: number, z: number): number => {
      const fx = Math.min(sx - 1, Math.max(0, (x - grid.min.x) / grid.size - i0)), fy = Math.min(sy - 1, Math.max(0, (y - grid.min.y) / grid.size - j0)), fz = Math.min(sz - 1, Math.max(0, (z - grid.min.z) / grid.size - k0));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz), x1 = Math.min(sx - 1, x0 + 1), y1 = Math.min(sy - 1, y0 + 1), z1 = Math.min(sz - 1, z0 + 1), tx = fx - x0, ty = fy - y0, tz = fz - z0;
      const at = (a: number, b: number, c: number) => iface[a + sx * (b + sy * c)]!, lerp = (p: number, q: number, t: number) => p + (q - p) * t;
      return lerp(lerp(lerp(at(x0, y0, z0), at(x1, y0, z0), tx), lerp(at(x0, y1, z0), at(x1, y1, z0), tx), ty), lerp(lerp(at(x0, y0, z1), at(x1, y0, z1), tx), lerp(at(x0, y1, z1), at(x1, y1, z1), tx), ty), tz);
    };
    const field = (x: number, y: number, z: number) => Math.max(exactAt(x, y, z), interfaceAt(x, y, z));
    const g = surfaceNets({ min: new Vector3(grid.min.x + i0 * grid.size, grid.min.y + j0 * grid.size, grid.min.z + k0 * grid.size), cells: [i1 - i0, j1 - j0, k1 - k0], size: grid.size, field, maxTriangles: 120_000 });
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
        const mu = Math.min(evidence.res - 1, Math.max(0, Math.floor(u))), mw = Math.min(evidence.res - 1, Math.max(0, Math.floor(w)));
        if (sdf[v]![mw * evidence.res + mu]! > -COLOUR_MARGIN_PX) continue;
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
  const loo = leaveOneOutIoU(views, { frame, cells: Math.min(cellsOverride ?? evidence.cells, 64) });
  return {
    evidence, frame, parts, adjacency: segmented.adjacency, hull: hull.stats, solid: { grid: hull.grid, occupancy: hull.occupancy, labels: segmented.labels }, discardedVoxels: segmented.discardedVoxels,
    heldOutIoU: loo.length ? loo.map((value, i) => ({ viewId: views[i]!.id, iou: value })) : null,
    observedFraction: total ? seen / total : 0,
    diagonal: frame.half / FRAME_HALF_PER_DIAGONAL, degraded: null,
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
