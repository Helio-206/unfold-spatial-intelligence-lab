/** COLMAP text model readers (cameras.txt, images.txt), the layout ETH3D and most SfM pipelines publish. Pure parsing; lens distortion is reported, not corrected. */
export type ColmapCamera = { id: number; model: string; width: number; height: number; params: number[] };
export type ColmapImage = { id: number; name: string; q: [number, number, number, number]; t: [number, number, number]; cameraId: number };
const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

export function parseColmapCameras(text: string): Map<number, ColmapCamera> {
  const out = new Map<number, ColmapCamera>();
  for (const l of lines(text)) { const p = l.split(/\s+/), id = Number(p[0]), width = Number(p[2]), height = Number(p[3]), params = p.slice(4).map(Number); if (!Number.isInteger(id) || !(width > 0) || !(height > 0) || params.some((v) => !Number.isFinite(v))) throw new Error('DATASET_COLMAP_CAMERAS'); out.set(id, { id, model: p[1]!, width, height, params }); }
  if (!out.size) throw new Error('DATASET_COLMAP_CAMERAS'); return out;
}
/** images.txt alternates a pose line and a 2D-points line; only the pose lines are read. */
export function parseColmapImages(text: string): ColmapImage[] {
  const all = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => !l.startsWith('#')), out: ColmapImage[] = []; let i = 0;
  while (i < all.length) { const l = all[i]!; if (!l) { i++; continue; } const p = l.split(/\s+/); if (p.length < 10) throw new Error('DATASET_COLMAP_IMAGES'); const n = p.slice(1, 8).map(Number); if (n.some((v) => !Number.isFinite(v))) throw new Error('DATASET_COLMAP_IMAGES'); out.push({ id: Number(p[0]), q: [n[0]!, n[1]!, n[2]!, n[3]!], t: [n[4]!, n[5]!, n[6]!], cameraId: Number(p[8]), name: p.slice(9).join(' ') }); i += 2; }
  if (!out.length) throw new Error('DATASET_COLMAP_IMAGES'); return out;
}
const R_OF = (q: readonly [number, number, number, number]) => { const n = Math.hypot(...q) || 1, [w, x, y, z] = q.map((v) => v / n) as [number, number, number, number]; return [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]; };
/** MVSNet-style extrinsic (4x4 world->camera) and intrinsic (3x3) for a pinhole-like COLMAP camera; `distorted` is true when the model has lens distortion that is NOT corrected. */
export function colmapToMvsNet(img: ColmapImage, cam: ColmapCamera): { extrinsic: number[]; intrinsic: number[]; distorted: boolean } {
  const R = R_OF(img.q), P = cam.params; let fx: number, fy: number, cx: number, cy: number, distorted = false;
  switch (cam.model) {
    case 'PINHOLE': [fx, fy, cx, cy] = [P[0]!, P[1]!, P[2]!, P[3]!]; break;
    case 'SIMPLE_PINHOLE': [fx, fy, cx, cy] = [P[0]!, P[0]!, P[1]!, P[2]!]; break;
    case 'SIMPLE_RADIAL': case 'RADIAL': [fx, fy, cx, cy] = [P[0]!, P[0]!, P[1]!, P[2]!]; distorted = P.slice(3).some((v) => Math.abs(v) > 1e-6); break;
    case 'OPENCV': case 'FULL_OPENCV': [fx, fy, cx, cy] = [P[0]!, P[1]!, P[2]!, P[3]!]; distorted = P.slice(4).some((v) => Math.abs(v) > 1e-6); break;
    default: throw new Error(`DATASET_COLMAP_MODEL ${cam.model}`);
  }
  return { extrinsic: [R[0]!, R[1]!, R[2]!, img.t[0], R[3]!, R[4]!, R[5]!, img.t[1], R[6]!, R[7]!, R[8]!, img.t[2], 0, 0, 0, 1], intrinsic: [fx, 0, cx, 0, fy, cy, 0, 0, 1], distorted };
}
