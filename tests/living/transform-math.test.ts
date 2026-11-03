import { describe, expect, it } from 'vitest';
import { applyRigid, composeRigid, normalizeQuat, quatAngle, quatFromAxisAngle, quatMultiply, rigidFromPose, rigidInverse, rotateVector, type Rigid } from '../../src/living/engineering/transform-math';

const close = (a: readonly number[], b: readonly number[], eps = 1e-12) => { expect(a.length).toBe(b.length); a.forEach((v, i) => expect(Math.abs(v - b[i]!)).toBeLessThan(eps)); };
const I: Rigid = { t: [0, 0, 0], q: [0, 0, 0, 1] };

// Matriz de rotação independente (para comprovar a composição de quaterniões).
const matFromQuat = ([x, y, z, w]: number[]) => [
  [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
  [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
  [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
];
const matMul = (a: number[][], b: number[][]) => a.map((row, i) => b[0]!.map((_, j) => row.reduce((s, _v, k) => s + a[i]![k]! * b[k]![j]!, 0)));

describe('rotação de vetores (regra da mão direita, +X frente, +Y cima, +Z direita)', () => {
  it('+90° em torno de Z leva +X a +Y', () => {
    close(rotateVector(quatFromAxisAngle([0, 0, 1], Math.PI / 2), [1, 0, 0]), [0, 1, 0]);
  });
  it('+90° em torno de Y leva +Z a +X (rotação de Y positiva é direita)', () => {
    close(rotateVector(quatFromAxisAngle([0, 1, 0], Math.PI / 2), [0, 0, 1]), [1, 0, 0]);
  });
  it('+90° em torno de X leva +Y a +Z', () => {
    close(rotateVector(quatFromAxisAngle([1, 0, 0], Math.PI / 2), [0, 1, 0]), [0, 0, 1]);
  });
  it('um quaternião de ângulo 0 não roda nada, e o eixo não precisa de estar normalizado', () => {
    close(rotateVector(quatFromAxisAngle([0, 0, 5], 0), [1, 2, 3]), [1, 2, 3]);
    close(quatFromAxisAngle([0, 0, 5], Math.PI / 2), quatFromAxisAngle([0, 0, 1], Math.PI / 2));
  });
});

describe('composição de quaterniões', () => {
  it('o produto de quaterniões coincide com o produto das matrizes de rotação correspondentes', () => {
    const a = quatFromAxisAngle([1, 2, 0.5], 0.7);
    const b = quatFromAxisAngle([0.2, -1, 3], -1.3);
    close(matFromQuat(quatMultiply(a, b)).flat(), matMul(matFromQuat(a), matFromQuat(b)).flat(), 1e-12);
  });
  it('composeRigid aplica o segundo transformado primeiro', () => {
    const parent: Rigid = { t: [1, 2, 3], q: quatFromAxisAngle([0, 1, 0], Math.PI / 2) };
    const child: Rigid = { t: [0, 0, 1], q: quatFromAxisAngle([0, 0, 1], Math.PI / 2) };
    const world = composeRigid(parent, child);
    // Ponto (1,0,0) no filho → no pai: Rz(90°)(1,0,0) + (0,0,1) = (0,1,1); no mundo: Ry(90°)(0,1,1) + (1,2,3) = (2,3,3).
    close(applyRigid(world, [1, 0, 0]), [2, 3, 3]);
    close(applyRigid(world, [1, 0, 0]), applyRigid(parent, applyRigid(child, [1, 0, 0])));
  });
  it('a identidade é neutra e o inverso desfaz a transformação', () => {
    const r: Rigid = { t: [0.3, -2, 5], q: quatFromAxisAngle([1, 1, 0], 0.9) };
    close(composeRigid(I, r).t, r.t); close(composeRigid(r, I).t, r.t);
    const back = composeRigid(rigidInverse(r), r);
    close(back.t, [0, 0, 0], 1e-12); expect(quatAngle(back.q, I.q)).toBeLessThan(1e-12);
  });
  it('normalizeQuat devolve um quaternião unitário; zero é recusado', () => {
    close(normalizeQuat([0, 0, 0, 2]), [0, 0, 0, 1]);
    expect(() => normalizeQuat([0, 0, 0, 0])).toThrow(/ENGINE_DEGENERATE_QUATERNION/);
  });
  it('quatAngle mede o ângulo entre rotações, e q e −q são a mesma rotação', () => {
    expect(quatAngle(quatFromAxisAngle([0, 0, 1], 0.3), quatFromAxisAngle([0, 0, 1], 0.1))).toBeCloseTo(0.2, 12);
    expect(quatAngle([0, 0, 0, 1], [0, 0, 0, -1])).toBeLessThan(1e-12);
  });
  it('quatAngle é exacto perto de zero: duas rotações a 1e-10 rad uma da outra medem 1e-10 rad (não ruído de raiz de ε)', () => {
    const base = quatFromAxisAngle([0, 1, 0], 0.4);
    const nearby = quatFromAxisAngle([0, 1, 0], 0.4 + 1e-10);
    expect(quatAngle(base, nearby)).toBeGreaterThan(0.9e-10);
    expect(quatAngle(base, nearby)).toBeLessThan(1.1e-10);
    expect(quatAngle(base, base)).toBe(0);
  });
  it('rigidFromPose converte a pose da contrato sem mudar os valores', () => {
    const r = rigidFromPose({ translationM: [1, 2, 3], rotation: [0, 0, 0, 1] });
    expect(r).toEqual({ t: [1, 2, 3], q: [0, 0, 0, 1] });
  });
});
