// Evaluates a multi-view scan stored in the plain layout below (what DTU/ETH3D downloads are converted into by scripts/datasets/README.md):
//   <dir>/cams/00000000_cam.txt ...   MVSNet camera files (extrinsic world->camera, intrinsic), one per view
//   <dir>/masks/00000000.pgm ...      8-bit PGM (P5), white = object, same size as the original image
//   <dir>/reference.ply               reference point cloud (ASCII or binary little-endian)
//   <dir>/meta.json                   { "width": W, "height": H, "units": "mm", "scan": "scan24", "dataset": "DTU", "licence": "..." }
// Run: npx tsx scripts/datasets/scan-directory.ts <dir> [--res 160] [--cells 96] [--out result.json]
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { evaluatePinholeScan, type ScanScore } from '../../src/universal-spatial/reconstruction/dataset-eval';
import { parseMvsNetCamera, parsePlyPoints, toSquareCamera, toSquareMask } from '../../src/universal-spatial/reconstruction/dataset-formats';

export function parsePgm(bytes: Uint8Array): { width: number; height: number; data: Uint8Array } {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 64)), m = /^P5\s+(?:#[^\n]*\n\s*)*(\d+)\s+(\d+)\s+(\d+)\s/.exec(head);
  if (!m) throw new Error('DATASET_PGM_FORMAT'); const width = Number(m[1]), height = Number(m[2]), start = m[0].length;
  if (bytes.length - start < width * height) throw new Error('DATASET_PGM_FORMAT'); return { width, height, data: bytes.subarray(start, start + width * height) };
}
export type ScanMeta = { width: number; height: number; units?: string; scan?: string; dataset?: string; licence?: string };
export function runScanDirectory(dir: string, options: { res?: number; cells?: number } = {}): ScanScore & { meta: ScanMeta; frozenSplit?: string } {
  const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8')) as ScanMeta, res = options.res ?? 160;
  if (!(meta.width > 0 && meta.height > 0)) throw new Error('DATASET_META');
  const camFiles = readdirSync(join(dir, 'cams')).filter((f) => f.endsWith('_cam.txt')).sort();
  const cameras = camFiles.map((f) => toSquareCamera(parseMvsNetCamera(readFileSync(join(dir, 'cams', f), 'utf8')), meta.width, meta.height, res));
  const masks = camFiles.map((f) => { const m = join(dir, 'masks', f.replace('_cam.txt', '.pgm')); if (!existsSync(m)) throw new Error(`DATASET_MASK_MISSING ${m}`); const p = parsePgm(readFileSync(m)); if (p.width !== meta.width || p.height !== meta.height) throw new Error('DATASET_MASK_SIZE'); return toSquareMask(Uint8Array.from(p.data, (v) => (v > 127 ? 1 : 0)), p.width, p.height, res); });
  const reference = parsePlyPoints(new Uint8Array(readFileSync(join(dir, 'reference.ply'))));
  return { ...evaluatePinholeScan({ cameras, masks, res, reference, ...(options.cells ? { cells: options.cells } : {}) }), meta };
}
if (process.argv[1] && /scan-directory\.ts$/.test(process.argv[1]) && process.argv[2]) {
  const arg = (n: string) => (process.argv.includes(n) ? process.argv[process.argv.indexOf(n) + 1]! : null), dir = resolve(process.argv[2]!);
  const r = runScanDirectory(dir, { ...(arg('--res') ? { res: Number(arg('--res')) } : {}), ...(arg('--cells') ? { cells: Number(arg('--cells')) } : {}) }); console.log(JSON.stringify(r, null, 2));
  const out = arg('--out'); if (out) { mkdirSync(resolve(out, '..'), { recursive: true }); writeFileSync(resolve(out), JSON.stringify(r, null, 2) + '\n'); }
}
