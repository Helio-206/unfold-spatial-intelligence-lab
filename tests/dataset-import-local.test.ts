import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { BoxGeometry, SphereGeometry, Vector3 } from 'three';
import { lookAtCamera, rasterisePinhole } from '../src/universal-spatial/reconstruction/multiview';
import { samplePoints } from '../src/universal-spatial/reconstruction/multiview-metrics';
import { parseColmapCameras, parseColmapImages, colmapToMvsNet } from '../src/universal-spatial/reconstruction/colmap-format';
import { importLocalScan } from '../scripts/datasets/import-local';
import { decodePngMask } from '../scripts/datasets/png-lite';
import { runScanDirectory } from '../scripts/datasets/scan-directory';
import { trisOf } from './helpers/reality-fixtures';

const png = (w: number, h: number, grey: Uint8Array, filter = 0): Buffer => {
  const crc = (b: Buffer) => { let c, t = 0xffffffff; for (const x of b) { c = (t ^ x) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t = (t >>> 8) ^ c; } return (t ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, body: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(body.length); const td = Buffer.concat([Buffer.from(type), body]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const rows: Buffer[] = []; for (let y = 0; y < h; y++) { const row = Buffer.from(grey.subarray(y * w, (y + 1) * w)); if (filter === 1) { for (let x = w - 1; x > 0; x--) row[x] = (row[x]! - row[x - 1]!) & 255; } rows.push(Buffer.concat([Buffer.from([filter]), row])); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
};
const quat = (R: number[]): [number, number, number, number] => { const t = R[0]! + R[4]! + R[8]!; if (t > 0) { const s = Math.sqrt(t + 1) * 2; return [s / 4, (R[7]! - R[5]!) / s, (R[2]! - R[6]!) / s, (R[3]! - R[1]!) / s]; } if (R[0]! > R[4]! && R[0]! > R[8]!) { const s = Math.sqrt(1 + R[0]! - R[4]! - R[8]!) * 2; return [(R[7]! - R[5]!) / s, s / 4, (R[1]! + R[3]!) / s, (R[2]! + R[6]!) / s]; } if (R[4]! > R[8]!) { const s = Math.sqrt(1 + R[4]! - R[0]! - R[8]!) * 2; return [(R[2]! - R[6]!) / s, (R[1]! + R[3]!) / s, s / 4, (R[5]! + R[7]!) / s]; } const s = Math.sqrt(1 + R[8]! - R[0]! - R[4]!) * 2; return [(R[3]! - R[1]!) / s, (R[2]! + R[6]!) / s, (R[5]! + R[7]!) / s, s / 4]; };

describe('local-file ingestion of an external scan (COLMAP text model + PNG masks + PLY reference)', () => {
  const tris = [...trisOf(new BoxGeometry(1.0, 0.6, 0.5)), ...trisOf(new SphereGeometry(0.3, 20, 14), new Vector3(0.45, 0.35, 0))], res = 160;
  const make = (opencv = false) => {
    const base = mkdtempSync(join(tmpdir(), 'local-')), masksDir = join(base, 'masks_in'); mkdirSync(masksDir);
    let images = '# images\n'; const ref = samplePoints(tris, 4000, 3);
    for (let i = 0; i < 12; i++) { const a = (i * 2 * Math.PI) / 12, e = ((i % 2 ? 35 : 10) * Math.PI) / 180, cam = lookAtCamera(new Vector3(Math.sin(a) * Math.cos(e) * 3, Math.sin(e) * 3, Math.cos(a) * Math.cos(e) * 3), new Vector3(), res, 35), m = rasterisePinhole(tris, cam, res), q = quat(cam.R as number[]);
      images += `${i + 1} ${q.join(' ')} ${cam.t.join(' ')} 1 img_${String(i).padStart(3, '0')}.jpg\n0 0 -1\n`; writeFileSync(join(masksDir, `img_${String(i).padStart(3, '0')}.png`), png(res, res, m.map((v) => (v ? 255 : 0)), i % 2));
    }
    const f = lookAtCamera(new Vector3(0, 0, 3), new Vector3(), res, 35).fx;
    writeFileSync(join(base, 'cameras.txt'), opencv ? `1 OPENCV ${res} ${res} ${f} ${f} ${res / 2} ${res / 2} -0.1 0.02 0 0\n` : `1 PINHOLE ${res} ${res} ${f} ${f} ${res / 2} ${res / 2}\n`); writeFileSync(join(base, 'images.txt'), images);
    writeFileSync(join(base, 'ref.ply'), `ply\nformat ascii 1.0\nelement vertex ${ref.length}\nproperty float x\nproperty float y\nproperty float z\nend_header\n${ref.map((p) => `${p.x} ${p.y} ${p.z}`).join('\n')}\n`);
    return { base, masksDir };
  };
  const opts = (b: { base: string; masksDir: string }, out: string, extra = {}) => ({ format: 'colmap' as const, out, reference: join(b.base, 'ref.ply'), masks: b.masksDir, cameras: join(b.base, 'cameras.txt'), images: join(b.base, 'images.txt'), licence: 'synthetic test data, no licence needed', dataset: 'synthetic', scan: 's', ...extra });
  it('imports COLMAP cameras and PNG masks (with PNG row filters) and the imported scan scores like the original', () => {
    const b = make(), out = join(b.base, 'out'), r = importLocalScan(opts(b, out)); expect(r.views).toBe(12); expect(r.distorted).toBe(false);
    const s = runScanDirectory(out, { res: 128, cells: 72 }); expect(s.views).toBe(12); expect(s.relativeToReferenceDiagonalPct.chamfer).toBeLessThan(5); expect(s.meta.dataset).toBe('synthetic');
  });
  it('refuses to import without a stated licence or reference, reports lens distortion instead of hiding it, and reports images without masks', () => {
    const b = make(true); expect(() => importLocalScan(opts(b, join(b.base, 'o1'), { licence: '  ' }))).toThrow('DATASET_LICENCE_REQUIRED'); expect(() => importLocalScan(opts(b, join(b.base, 'o2'), { reference: join(b.base, 'nope.ply') }))).toThrow('DATASET_REFERENCE_MISSING');
    const r = importLocalScan(opts(b, join(b.base, 'o3'))); expect(r.distorted).toBe(true);
    const cleaner = make(); writeFileSync(join(cleaner.base, 'images.txt'), '# images\n13 1 0 0 0 0 0 3 1 extra_without_mask.jpg\n0 0 -1\n' + (require('node:fs').readFileSync(join(cleaner.base, 'images.txt'), 'utf8') as string).replace('# images\n', ''));
    expect(importLocalScan(opts(cleaner, join(cleaner.base, 'o4'))).skipped.join(' ')).toMatch(/extra_without_mask.jpg: sem máscara/);
  });
  it('COLMAP parsers and the PNG reader reject malformed input', () => {
    expect(() => parseColmapCameras('# nothing')).toThrow('DATASET_COLMAP_CAMERAS'); expect(() => parseColmapImages('1 2 3')).toThrow('DATASET_COLMAP_IMAGES'); expect(() => decodePngMask(new Uint8Array([1, 2, 3]))).toThrow('DATASET_PNG_FORMAT');
    expect(() => colmapToMvsNet({ id: 1, name: 'x', q: [1, 0, 0, 0], t: [0, 0, 0], cameraId: 1 }, { id: 1, model: 'FISHEYE', width: 1, height: 1, params: [1] })).toThrow('DATASET_COLMAP_MODEL');
  });
});
