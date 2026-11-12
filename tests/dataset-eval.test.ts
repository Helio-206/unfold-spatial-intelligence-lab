import { describe, it, expect } from 'vitest';
import { BoxGeometry, SphereGeometry, Vector3 } from 'three';
import { evaluatePinholeScan } from '../src/universal-spatial/reconstruction/dataset-eval';
import { lookAtCamera, rasterisePinhole } from '../src/universal-spatial/reconstruction/multiview';
import { samplePoints } from '../src/universal-spatial/reconstruction/multiview-metrics';
import { trisOf } from './helpers/reality-fixtures';

/** A synthetic "scan" in the same shape as a DTU/ETH3D one (pinhole cameras on a dome, foreground masks, a reference cloud): proves the evaluation path before real data exists. */
describe('pinhole scan evaluation (DTU/ETH3D-shaped input)', () => {
  const tris = [...trisOf(new BoxGeometry(1.0, 0.6, 0.5)), ...trisOf(new SphereGeometry(0.3, 20, 14), new Vector3(0.45, 0.35, 0))], res = 128;
  const cams = Array.from({ length: 14 }, (_, i) => { const az = (i * 360) / 14, el = i % 2 ? 40 : 15, a = (az * Math.PI) / 180, e = (el * Math.PI) / 180, d = 3.2; return lookAtCamera(new Vector3(Math.sin(a) * Math.cos(e) * d, Math.sin(e) * d, Math.cos(a) * Math.cos(e) * d), new Vector3(0, 0, 0), res, 35); });
  const masks = cams.map((c) => rasterisePinhole(tris, c, res)), reference = samplePoints(tris, 8000, 5);
  it('recovers the reference surface with a small Chamfer and high held-out agreement, and states that it is not the official metric', () => {
    const s = evaluatePinholeScan({ cameras: cams, masks, res, reference, cells: 80 });
    expect(s.views).toBe(14); expect(s.relativeToReferenceDiagonalPct.chamfer).toBeLessThan(4); expect(s.heldOutIoUMean!).toBeGreaterThan(0.9); expect(s.note).toMatch(/NÃO é a métrica oficial/);
  });
  it('a wrong mask set is visible in the score (the evaluation is not blind to quality): swapping two views raises the Chamfer', () => {
    const good = evaluatePinholeScan({ cameras: cams, masks, res, reference, cells: 80 }), bad = evaluatePinholeScan({ cameras: cams, masks: masks.map((m, i) => (i === 3 ? masks[9]! : i === 9 ? masks[3]! : m)), res, reference, cells: 80 });
    expect(bad.relativeToReferenceDiagonalPct.chamfer).toBeGreaterThan(good.relativeToReferenceDiagonalPct.chamfer + 0.3);
  });
  it('refuses inputs that cannot be evaluated', () => {
    expect(() => evaluatePinholeScan({ cameras: cams.slice(0, 2), masks: masks.slice(0, 2), res, reference })).toThrow('DATASET_SCAN_INPUT');
  });
});

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runScanDirectory, parsePgm } from '../scripts/datasets/scan-directory';

describe('scan directory loader (the layout real DTU/ETH3D downloads are converted into)', () => {
  const W = 200, H = 150;
  it('reads cameras, PGM masks and a PLY reference from disk and scores them; a missing or wrong-sized mask is refused', () => {
    const tris = [...trisOf(new BoxGeometry(1.0, 0.6, 0.5))], dir = mkdtempSync(join(tmpdir(), 'scan-')); mkdirSync(join(dir, 'cams')); mkdirSync(join(dir, 'masks'));
    // cameras for a W x H image: build in square space then express as a W x H pinhole by cropping the square into the rectangle
    const res = 160, ref = samplePoints(tris, 4000, 9);
    for (let i = 0; i < 12; i++) {
      const a = (i * 2 * Math.PI) / 12, e = ((i % 2 ? 35 : 10) * Math.PI) / 180, pos = new Vector3(Math.sin(a) * Math.cos(e) * 3, Math.sin(e) * 3, Math.cos(a) * Math.cos(e) * 3), cam = lookAtCamera(pos, new Vector3(), res, 35), f = cam.fx * (W / res);
      // image W x H centred principal point; same focal scale as the square render => rasterise at W x H by projecting with these intrinsics
      const mask = new Uint8Array(W * H), R = cam.R, t = cam.t;
      for (const tri of tris) { const P = tri.map((v) => { const X = R[0]! * v.x + R[1]! * v.y + R[2]! * v.z + t[0]!, Y = R[3]! * v.x + R[4]! * v.y + R[5]! * v.z + t[1]!, Z = R[6]! * v.x + R[7]! * v.y + R[8]! * v.z + t[2]!; return [f * X / Z + W / 2, f * Y / Z + H / 2]; }); const x0 = Math.floor(Math.min(...P.map((p) => p[0]!))), x1 = Math.ceil(Math.max(...P.map((p) => p[0]!))), y0 = Math.floor(Math.min(...P.map((p) => p[1]!))), y1 = Math.ceil(Math.max(...P.map((p) => p[1]!)));
        const [A, B, C] = P as [number[], number[], number[]], den = (B[1]! - C[1]!) * (A[0]! - C[0]!) + (C[0]! - B[0]!) * (A[1]! - C[1]!);
        for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) { const l1 = ((B[1]! - C[1]!) * (x + 0.5 - C[0]!) + (C[0]! - B[0]!) * (y + 0.5 - C[1]!)) / den, l2 = ((C[1]! - A[1]!) * (x + 0.5 - C[0]!) + (A[0]! - C[0]!) * (y + 0.5 - C[1]!)) / den; if (l1 >= 0 && l2 >= 0 && 1 - l1 - l2 >= 0) mask[y * W + x] = 255; } }
      const name = String(i).padStart(8, '0'), ext = [...R.slice(0, 3), t[0]!, ...R.slice(3, 6), t[1]!, ...R.slice(6, 9), t[2]!, 0, 0, 0, 1];
      writeFileSync(join(dir, 'cams', `${name}_cam.txt`), `extrinsic\n${[0, 1, 2, 3].map((r) => ext.slice(r * 4, r * 4 + 4).join(' ')).join('\n')}\n\nintrinsic\n${f} 0 ${W / 2}\n0 ${f} ${H / 2}\n0 0 1\n\n1 1\n`);
      writeFileSync(join(dir, 'masks', `${name}.pgm`), Buffer.concat([Buffer.from(`P5\n${W} ${H}\n255\n`), Buffer.from(mask)]));
    }
    writeFileSync(join(dir, 'reference.ply'), `ply\nformat ascii 1.0\nelement vertex ${ref.length}\nproperty float x\nproperty float y\nproperty float z\nend_header\n${ref.map((p) => `${p.x} ${p.y} ${p.z}`).join('\n')}\n`);
    writeFileSync(join(dir, 'meta.json'), JSON.stringify({ width: W, height: H, units: 'unit', scan: 'synthetic', dataset: 'synthetic' }));
    const s = runScanDirectory(dir, { res: 128, cells: 72 }); expect(s.views).toBe(12); expect(s.relativeToReferenceDiagonalPct.chamfer).toBeLessThan(5); expect(s.meta.dataset).toBe('synthetic');
    writeFileSync(join(dir, 'masks', '00000003.pgm'), Buffer.concat([Buffer.from('P5\n10 10\n255\n'), Buffer.alloc(100)])); expect(() => runScanDirectory(dir)).toThrow('DATASET_MASK_SIZE');
  });
  it('parses PGM headers with comments and rejects truncated data', () => {
    expect(parsePgm(Buffer.concat([Buffer.from('P5\n# c\n2 2\n255\n'), Buffer.from([0, 255, 255, 0])]))).toMatchObject({ width: 2, height: 2 });
    expect(() => parsePgm(Buffer.concat([Buffer.from('P5\n2 2\n255\n'), Buffer.from([0, 255])]))).toThrow('DATASET_PGM_FORMAT');
  });
});
