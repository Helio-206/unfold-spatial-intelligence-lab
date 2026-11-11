import { describe, it, expect } from 'vitest';
import { Vector3 } from 'three';
import { cubeOf, parseMvsNetCamera, parsePlyPoints, toSquareCamera, toSquareMask } from '../src/universal-spatial/reconstruction/dataset-formats';
import { lookAtCamera, rasterisePinhole } from '../src/universal-spatial/reconstruction/multiview';

const camTxt = `extrinsic
1 0 0 0.5
0 1 0 -0.25
0 0 1 3
0 0 0 1

intrinsic
800 0 400
0 800 300
0 0 1

425 2.5`;
describe('formatos de conjuntos de dados públicos', () => {
  it('lê câmaras no formato MVSNet e recusa lixo', () => {
    const c = parseMvsNetCamera(camTxt); expect(c.extrinsic[3]).toBe(0.5); expect(c.intrinsic[0]).toBe(800); expect(c.depthMin).toBe(425); expect(c.depthInterval).toBe(2.5);
    expect(() => parseMvsNetCamera('hello')).toThrow(/DATASET_CAMERA/); expect(() => parseMvsNetCamera('extrinsic\n1 2\nintrinsic\n1')).toThrow(/DATASET_CAMERA/);
  });
  it('a conversão para imagem quadrada preserva a projecção de um ponto (rect. 800x600 -> 128²)', () => {
    const c = parseMvsNetCamera(camTxt), w = 800, h = 600, res = 128, sq = toSquareCamera(c, w, h, res), p = new Vector3(0.2, 0.1, 0.4);
    const X = p.x + 0.5, Y = p.y - 0.25, Z = p.z + 3, u = 800 * X / Z + 400, v = 800 * Y / Z + 300, k = res / 800, pad = (800 - 600) / 2;
    const Xs = sq.R[0]! * p.x + sq.R[1]! * p.y + sq.R[2]! * p.z + sq.t[0]!, Ys = sq.R[3]! * p.x + sq.R[4]! * p.y + sq.R[5]! * p.z + sq.t[1]!, Zs = sq.R[6]! * p.x + sq.R[7]! * p.y + sq.R[8]! * p.z + sq.t[2]!;
    expect(sq.fx * Xs / Zs + sq.cx).toBeCloseTo(u * k, 6); expect(sq.fy * Ys / Zs + sq.cy).toBeCloseTo((v + pad) * k, 6);
    const m = new Uint8Array(w * h); for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) m[(300 + dy) * w + 400 + dx] = 1; const sm = toSquareMask(m, w, h, res); expect(sm[Math.floor((300 + pad) * k) * res + Math.floor(400 * k)]).toBe(1);
  });
  it('lê PLY ASCII e binário little-endian e recusa formatos desconhecidos', () => {
    const asc = new TextEncoder().encode('ply\nformat ascii 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nend_header\n1 2 3\n4 5 6\n');
    expect(parsePlyPoints(asc).map((v) => v.toArray())).toEqual([[1, 2, 3], [4, 5, 6]]);
    const head = new TextEncoder().encode('ply\nformat binary_little_endian 1.0\nelement vertex 2\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nend_header\n'), body = new DataView(new ArrayBuffer(2 * 13));
    [[1, 2, 3], [4, 5, 6]].forEach((v, i) => { v.forEach((x, k) => body.setFloat32(i * 13 + k * 4, x, true)); body.setUint8(i * 13 + 12, 200); });
    const bin = new Uint8Array(head.length + 26); bin.set(head); bin.set(new Uint8Array(body.buffer), head.length); expect(parsePlyPoints(bin).map((v) => v.toArray())).toEqual([[1, 2, 3], [4, 5, 6]]);
    expect(() => parsePlyPoints(new TextEncoder().encode('ply\nformat binary_big_endian 1.0\nelement vertex 1\nproperty float x\nend_header\n'))).toThrow(/DATASET_PLY/);
  });
  it('cubeOf envolve a nuvem; câmara look-at e rasterização perspectiva são coerentes com a conversão', () => {
    const c = cubeOf([new Vector3(-1, 0, 0), new Vector3(1, 2, 1)]); expect(c.centre.toArray()).toEqual([0, 1, 0.5]); expect(c.half).toBeCloseTo(1.08);
    const cam = lookAtCamera(new Vector3(0, 0, 3), new Vector3(), 64, 50), m = rasterisePinhole([[new Vector3(-0.3, -0.3, 0), new Vector3(0.3, -0.3, 0), new Vector3(0, 0.3, 0)]], cam, 64); expect(m[32 * 64 + 32]).toBe(1);
  });
});
