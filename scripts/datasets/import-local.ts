// Ingests a scan from LOCAL FILES (the build environment cannot download the datasets: put the files here by hand) into the scan-directory layout read by scan-directory.ts.
//   COLMAP model (ETH3D, any SfM):  npx tsx scripts/datasets/import-local.ts --format colmap --cameras cameras.txt --images images.txt --masks <dir of PNG|PGM named like the images> --reference ref.ply --out <dir> --dataset ETH3D --scan kicker --licence "<copied from the source page>"
//   MVSNet cameras (DTU derived):   npx tsx scripts/datasets/import-local.ts --format mvsnet --cams <dir of *_cam.txt> --masks <dir of PNG|PGM, same order> --width 1600 --height 1200 --reference ref.ply --out <dir> ...
// Licence text is REQUIRED and copied verbatim into meta.json: nothing is imported without a stated licence. Lens distortion is reported in meta.json, never corrected.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { colmapToMvsNet, parseColmapCameras, parseColmapImages } from '../../src/universal-spatial/reconstruction/colmap-format';
import { decodePngMask } from './png-lite';
import { parsePgm } from './scan-directory';

export type ImportOptions = { format: 'colmap' | 'mvsnet'; out: string; reference: string; masks: string; licence: string; dataset: string; scan: string; cameras?: string; images?: string; cams?: string; width?: number; height?: number };
const readMask = (file: string) => (file.toLowerCase().endsWith('.png') ? decodePngMask(new Uint8Array(readFileSync(file))) : parsePgm(new Uint8Array(readFileSync(file))));
const writePgm = (file: string, m: { width: number; height: number; data: Uint8Array }) => writeFileSync(file, Buffer.concat([Buffer.from(`P5\n${m.width} ${m.height}\n255\n`), Buffer.from(m.data)]));
export function importLocalScan(o: ImportOptions): { views: number; width: number; height: number; distorted: boolean; skipped: string[] } {
  if (!o.licence?.trim()) throw new Error('DATASET_LICENCE_REQUIRED');
  if (!existsSync(o.reference)) throw new Error('DATASET_REFERENCE_MISSING');
  mkdirSync(join(o.out, 'cams'), { recursive: true }); mkdirSync(join(o.out, 'masks'), { recursive: true });
  const maskFiles = readdirSync(o.masks).filter((f) => /\.(png|pgm)$/i.test(f)).sort(), skipped: string[] = []; let width = o.width ?? 0, height = o.height ?? 0, distorted = false, n = 0;
  const put = (idx: number, ext: { extrinsic: number[]; intrinsic: number[]; distorted: boolean }, maskFile: string) => {
    const m = readMask(join(o.masks, maskFile)); if (!width) { width = m.width; height = m.height; } if (m.width !== width || m.height !== height) { skipped.push(`${maskFile}: tamanho ${m.width}x${m.height} ≠ ${width}x${height}`); return; }
    const name = String(idx).padStart(8, '0'), e = ext.extrinsic, k = ext.intrinsic; distorted ||= ext.distorted;
    writeFileSync(join(o.out, 'cams', `${name}_cam.txt`), `extrinsic\n${[0, 1, 2, 3].map((r) => e.slice(r * 4, r * 4 + 4).join(' ')).join('\n')}\n\nintrinsic\n${k.slice(0, 3).join(' ')}\n${k.slice(3, 6).join(' ')}\n${k.slice(6, 9).join(' ')}\n\n1 1\n`); writePgm(join(o.out, 'masks', `${name}.pgm`), m); n++;
  };
  if (o.format === 'colmap') {
    const cams = parseColmapCameras(readFileSync(o.cameras!, 'utf8')), imgs = parseColmapImages(readFileSync(o.images!, 'utf8')).sort((a, b) => a.name.localeCompare(b.name)), byStem = new Map(maskFiles.map((f) => [basename(f, extname(f)).replace(/\.(jpg|jpeg|png)$/i, ''), f]));
    imgs.forEach((im, i) => { const stem = basename(im.name, extname(im.name)), mf = byStem.get(stem) ?? byStem.get(im.name); if (!mf) { skipped.push(`${im.name}: sem máscara`); return; } const cam = cams.get(im.cameraId); if (!cam) { skipped.push(`${im.name}: câmara ${im.cameraId} desconhecida`); return; } if (!width) { width = cam.width; height = cam.height; } put(i, colmapToMvsNet(im, cam), mf); });
  } else {
    const camFiles = readdirSync(o.cams!).filter((f) => f.endsWith('_cam.txt')).sort(); if (camFiles.length !== maskFiles.length) throw new Error(`DATASET_COUNT_MISMATCH ${camFiles.length} câmaras / ${maskFiles.length} máscaras`);
    if (!o.width || !o.height) throw new Error('DATASET_SIZE_REQUIRED');
    camFiles.forEach((f, i) => { const t = readFileSync(join(o.cams!, f), 'utf8').split(/\r?\n/).map((l) => l.trim()), ei = t.indexOf('extrinsic'), ii = t.indexOf('intrinsic'); const nums = (a: number, c: number) => t.slice(a, a + c).flatMap((l) => l.split(/\s+/).map(Number)); put(i, { extrinsic: nums(ei + 1, 4), intrinsic: nums(ii + 1, 3), distorted: false }, maskFiles[i]!); });
  }
  if (!n) throw new Error('DATASET_NOTHING_IMPORTED');
  copyFileSync(o.reference, join(o.out, 'reference.ply'));
  writeFileSync(join(o.out, 'meta.json'), JSON.stringify({ width, height, units: 'unit of the reference file', scan: o.scan, dataset: o.dataset, licence: o.licence, importedViews: n, lensDistortionNotCorrected: distorted, skipped, note: 'Imported from local files by scripts/datasets/import-local.ts; split membership is in scripts/datasets/splits.json.' }, null, 2) + '\n');
  return { views: n, width, height, distorted, skipped };
}
if (process.argv[1] && /import-local\.ts$/.test(process.argv[1]) && process.argv.length > 3) {
  const a = (k: string) => (process.argv.includes(k) ? process.argv[process.argv.indexOf(k) + 1]! : undefined);
  const r = importLocalScan({ format: (a('--format') ?? 'colmap') as 'colmap' | 'mvsnet', out: resolve(a('--out')!), reference: resolve(a('--reference')!), masks: resolve(a('--masks')!), licence: a('--licence') ?? '', dataset: a('--dataset') ?? 'unknown', scan: a('--scan') ?? 'unknown', ...(a('--cameras') ? { cameras: resolve(a('--cameras')!) } : {}), ...(a('--images') ? { images: resolve(a('--images')!) } : {}), ...(a('--cams') ? { cams: resolve(a('--cams')!) } : {}), ...(a('--width') ? { width: Number(a('--width')) } : {}), ...(a('--height') ? { height: Number(a('--height')) } : {}) });
  console.log(JSON.stringify(r, null, 2));
}
