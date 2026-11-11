/**
 * Readers for the formats of public multi-view benchmarks (DTU in the MVSNet layout, ETH3D, any COLMAP text model), so the pinhole hull can be evaluated on real
 * photographs with reference geometry as soon as the data is available. Pure parsing + camera conversion; no network, no file system.
 */
import { Vector3 } from 'three';
import type { PinholeCamera } from './multiview';

/** MVSNet-style camera file: "extrinsic" (4x4 world->camera), "intrinsic" (3x3), optional depth range line. */
export function parseMvsNetCamera(text: string): { extrinsic: number[]; intrinsic: number[]; depthMin?: number; depthInterval?: number } {
  const lines = text.split(/\r?\n/).map((l) => l.trim()), ei = lines.indexOf('extrinsic'), ii = lines.indexOf('intrinsic');
  if (ei < 0 || ii < 0) throw new Error('DATASET_CAMERA_FORMAT');
  const nums = (from: number, n: number) => lines.slice(from, from + n).flatMap((l) => l.split(/\s+/).map(Number)), ext = nums(ei + 1, 4), int = nums(ii + 1, 3);
  if (ext.length !== 16 || int.length !== 9 || [...ext, ...int].some((v) => !Number.isFinite(v))) throw new Error('DATASET_CAMERA_FORMAT');
  const rest = lines.slice(ii + 4).join(' ').split(/\s+/).filter((t) => t !== '').map(Number).filter(Number.isFinite);
  return { extrinsic: ext, intrinsic: int, ...(rest.length >= 2 ? { depthMin: rest[0]!, depthInterval: rest[1]! } : {}) };
}
/** Converts a camera for a w x h image into one for a SQUARE image of side `res` (centred padding, then uniform scaling). */
export function toSquareCamera(c: { extrinsic: number[]; intrinsic: number[] }, w: number, h: number, res: number): PinholeCamera {
  const side = Math.max(w, h), k = res / side, padX = (side - w) / 2, padY = (side - h) / 2, e = c.extrinsic, K = c.intrinsic;
  return { fx: K[0]! * k, fy: K[4]! * k, cx: (K[2]! + padX) * k, cy: (K[5]! + padY) * k, R: [e[0]!, e[1]!, e[2]!, e[4]!, e[5]!, e[6]!, e[8]!, e[9]!, e[10]!], t: [e[3]!, e[7]!, e[11]!] };
}
/** Same for a binary/foreground mask or an image given as w*h samples: pads to a square and resamples (nearest) to res x res. */
export function toSquareMask(mask: Uint8Array, w: number, h: number, res: number): Uint8Array {
  const side = Math.max(w, h), padX = (side - w) / 2, padY = (side - h) / 2, out = new Uint8Array(res * res);
  for (let y = 0; y < res; y++) for (let x = 0; x < res; x++) { const sx = Math.floor(((x + 0.5) / res) * side - padX), sy = Math.floor(((y + 0.5) / res) * side - padY); if (sx >= 0 && sy >= 0 && sx < w && sy < h) out[y * res + x] = mask[sy * w + sx]!; }
  return out;
}
/** Axis-aligned centre and half extent that contain all camera centres' look-at region: the bounding cube of a point cloud with a margin. */
export function cubeOf(points: readonly Vector3[], margin = 1.08): { centre: Vector3; half: number } {
  const mn = new Vector3(Infinity, Infinity, Infinity), mx = new Vector3(-Infinity, -Infinity, -Infinity); for (const p of points) { mn.min(p); mx.max(p); }
  return { centre: mn.clone().add(mx).multiplyScalar(0.5), half: (Math.max(mx.x - mn.x, mx.y - mn.y, mx.z - mn.z) / 2) * margin };
}
/** PLY reader for point clouds (ASCII or binary little-endian, float/double x y z); other properties are skipped. */
export function parsePlyPoints(bytes: Uint8Array): Vector3[] {
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4096))), end = head.indexOf('end_header'); if (end < 0) throw new Error('DATASET_PLY_FORMAT');
  const header = head.slice(0, end).split(/\r?\n/), fmt = header.find((l) => l.startsWith('format'))?.split(/\s+/)[1], count = Number(header.find((l) => l.startsWith('element vertex'))?.split(/\s+/)[2]);
  const props: Array<{ name: string; type: string }> = []; let inVertex = false;
  for (const l of header) { if (l.startsWith('element')) inVertex = l.startsWith('element vertex'); else if (inVertex && l.startsWith('property')) { const p = l.split(/\s+/); props.push({ type: p[1]!, name: p[2]! }); } }
  const bodyStart = end + 'end_header'.length + (head[end + 10] === '\r' ? 2 : 1), out: Vector3[] = [];
  if (!(count > 0) || props.length === 0) throw new Error('DATASET_PLY_FORMAT');
  if (fmt === 'ascii') { const rows = new TextDecoder().decode(bytes.subarray(bodyStart)).split(/\r?\n/); const xi = props.findIndex((p) => p.name === 'x'), yi = props.findIndex((p) => p.name === 'y'), zi = props.findIndex((p) => p.name === 'z'); for (let i = 0; i < count && i < rows.length; i++) { const c = rows[i]!.trim().split(/\s+/).map(Number); out.push(new Vector3(c[xi]!, c[yi]!, c[zi]!)); } return out; }
  if (fmt !== 'binary_little_endian') throw new Error('DATASET_PLY_FORMAT');
  const size: Record<string, number> = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 }, offs: number[] = []; let stride = 0; for (const p of props) { offs.push(stride); stride += size[p.type] ?? (() => { throw new Error('DATASET_PLY_FORMAT'); })(); }
  const view = new DataView(bytes.buffer, bytes.byteOffset + bodyStart), read = (type: string, o: number) => (type === 'double' || type === 'float64' ? view.getFloat64(o, true) : view.getFloat32(o, true)), xi = props.findIndex((p) => p.name === 'x'), yi = props.findIndex((p) => p.name === 'y'), zi = props.findIndex((p) => p.name === 'z');
  for (let i = 0; i < count; i++) { const b = i * stride; if (b + stride > view.byteLength) break; out.push(new Vector3(read(props[xi]!.type, b + offs[xi]!), read(props[yi]!.type, b + offs[yi]!), read(props[zi]!.type, b + offs[zi]!))); }
  return out;
}
