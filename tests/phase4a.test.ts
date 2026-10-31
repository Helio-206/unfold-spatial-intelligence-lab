import { describe, expect, it } from 'vitest';
import { PHASE4A_LENGTHS, solvePhase4A } from '../src/phase4a-kinematics';
import { solveFourBar } from '../src/kinematics';

function distance(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('PHASE 4A kinematic proof data', () => {
  it('uses solver coordinates whose four endpoints satisfy the documented lengths', () => {
    const result = solvePhase4A(0);
    expect(result.status).toBe('solved');
    if (!result.coordinates || !result.residuals) return;
    const { fixedPivotA, fixedPivotB, crankCouplerJoint, couplerRockerJoint } = result.coordinates;
    expect(distance(fixedPivotA, fixedPivotB)).toBeCloseTo(PHASE4A_LENGTHS.ground, 10);
    expect(distance(fixedPivotA, crankCouplerJoint)).toBeCloseTo(PHASE4A_LENGTHS.crank, 10);
    expect(distance(crankCouplerJoint, couplerRockerJoint)).toBeCloseTo(PHASE4A_LENGTHS.coupler, 10);
    expect(distance(couplerRockerJoint, fixedPivotB)).toBeCloseTo(PHASE4A_LENGTHS.rocker, 10);
    expect(result.residuals.maxLengthErrorMm).toBeLessThan(1e-9);
  });

  it('updates the geometry from the input angle and closes the cycle', () => {
    const atZero = solvePhase4A(0);
    const atNinety = solvePhase4A(90);
    expect(atZero.coordinates?.crankCouplerJoint).not.toEqual(atNinety.coordinates?.crankCouplerJoint);
    expect(atNinety.coordinates?.crankCouplerJoint.x).toBeCloseTo(0, 10);
    expect(atNinety.coordinates?.crankCouplerJoint.y).toBeCloseTo(40, 10);
    expect(atNinety.residuals?.closureResidualMm).toBeLessThan(1e-9);
  });

  it('keeps the fixed pivots invariant over a full rotation and supports both branches', () => {
    const atZero = solvePhase4A(0, 'plus');
    const atFullTurn = solvePhase4A(360, 'plus');
    const minus = solvePhase4A(90, 'minus');
    expect(atZero.coordinates?.fixedPivotA).toEqual(atFullTurn.coordinates?.fixedPivotA);
    expect(atZero.coordinates?.fixedPivotB).toEqual(atFullTurn.coordinates?.fixedPivotB);
    expect(minus.status).toBe('solved');
    expect(minus.coordinates?.couplerRockerJoint.y).toBeLessThan(0);
  });

  it('returns no coordinates for an impossible configuration', () => {
    const impossible = solveFourBar({ lengths: { ...PHASE4A_LENGTHS, crank: 80 }, inputAngleRad: 0, branch: 'plus' });
    expect(impossible.status).toBe('impossible');
    expect(impossible.coordinates).toBeUndefined();
    expect(impossible.residuals).toBeUndefined();
  });
});
