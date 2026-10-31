import { describe, expect, it } from 'vitest';
import { calculateResiduals, classifyGrashof, solveFourBar, type FourBarCoordinates, type FourBarLengths } from '../src/kinematics';

const referenceLengths: FourBarLengths = { ground: 100, crank: 40, coupler: 120, rocker: 90 };

function independentlyMeasure(coordinates: FourBarCoordinates, lengths: FourBarLengths) {
  const hypot = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(b.x - a.x, b.y - a.y);
  const ground = hypot(coordinates.fixedPivotA, coordinates.fixedPivotB);
  const crank = hypot(coordinates.fixedPivotA, coordinates.crankCouplerJoint);
  const coupler = hypot(coordinates.crankCouplerJoint, coordinates.couplerRockerJoint);
  const rocker = hypot(coordinates.couplerRockerJoint, coordinates.fixedPivotB);
  const loopX = coordinates.crankCouplerJoint.x + (coordinates.couplerRockerJoint.x - coordinates.crankCouplerJoint.x) + (coordinates.fixedPivotB.x - coordinates.couplerRockerJoint.x) - coordinates.fixedPivotB.x;
  const loopY = coordinates.crankCouplerJoint.y + (coordinates.couplerRockerJoint.y - coordinates.crankCouplerJoint.y) + (coordinates.fixedPivotB.y - coordinates.couplerRockerJoint.y);
  return { ground, crank, coupler, rocker, loopResidual: Math.hypot(loopX, loopY), maxLengthError: Math.max(Math.abs(ground - lengths.ground), Math.abs(crank - lengths.crank), Math.abs(coupler - lengths.coupler), Math.abs(rocker - lengths.rocker)) };
}

describe('deterministic planar four-bar kinematics', () => {
  it('solves documented coordinates at zero input angle on both branches', () => {
    const plus = solveFourBar({ lengths: referenceLengths, inputAngleRad: 0, branch: 'plus' });
    const minus = solveFourBar({ lengths: referenceLengths, inputAngleRad: 0, branch: 'minus' });
    expect(plus.status).toBe('solved');
    expect(minus.status).toBe('solved');
    expect(plus.coordinates?.crankCouplerJoint).toEqual({ x: 40, y: 0 });
    expect(plus.coordinates?.couplerRockerJoint.x).toBeCloseTo(122.5, 10);
    expect(plus.coordinates?.couplerRockerJoint.y).toBeCloseTo(Math.sqrt(7593.75), 10);
    expect(minus.coordinates?.couplerRockerJoint.y).toBeCloseTo(-Math.sqrt(7593.75), 10);
    expect(plus.residuals?.maxLengthErrorMm).toBeLessThan(1e-9);
    expect(plus.residuals?.closureResidualMm).toBeLessThan(1e-12);
  });

  it('checks closure independently from the solver residual report', () => {
    const result = solveFourBar({ lengths: referenceLengths, inputAngleRad: Math.PI / 3, branch: 'plus' });
    expect(result.coordinates).toBeDefined();
    const independent = independentlyMeasure(result.coordinates!, referenceLengths);
    expect(independent.maxLengthError).toBeLessThan(1e-9);
    expect(independent.loopResidual).toBeLessThan(1e-12);
    expect(calculateResiduals(result.coordinates!, referenceLengths).closureResidualMm).toBeLessThan(1e-12);
  });

  it('keeps each assembly branch continuous through a complete rotation', () => {
    for (const branch of ['plus', 'minus'] as const) {
      let previous = solveFourBar({ lengths: referenceLengths, inputAngleRad: 0, branch });
      expect(previous.status).toBe('solved');
      for (let step = 1; step <= 360; step += 1) {
        const current = solveFourBar({ lengths: referenceLengths, inputAngleRad: step * 2 * Math.PI / 360, branch });
        expect(current.status).toBe('solved');
        const movement = Math.hypot(
          current.coordinates!.couplerRockerJoint.x - previous.coordinates!.couplerRockerJoint.x,
          current.coordinates!.couplerRockerJoint.y - previous.coordinates!.couplerRockerJoint.y,
        );
        expect(movement).toBeLessThan(3);
        previous = current;
      }
      expect(previous.coordinates!.couplerRockerJoint.x).toBeCloseTo(solveFourBar({ lengths: referenceLengths, inputAngleRad: 0, branch }).coordinates!.couplerRockerJoint.x, 8);
      expect(previous.coordinates!.couplerRockerJoint.y).toBeCloseTo(solveFourBar({ lengths: referenceLengths, inputAngleRad: 0, branch }).coordinates!.couplerRockerJoint.y, 8);
    }
  });

  it('classifies Grashof behaviour with the fixed bar', () => {
    const analysis = classifyGrashof(referenceLengths);
    expect(analysis.classification).toBe('grashof');
    expect(analysis.fixedBarBehavior).toBe('crank-rocker');
    expect(analysis.shortestBar).toBe('crank');
    expect(analysis.longestBar).toBe('coupler');
  });

  it('rejects invalid lengths and never returns fictitious coordinates', () => {
    expect(() => solveFourBar({ lengths: { ...referenceLengths, crank: 0 }, inputAngleRad: 0, branch: 'plus' })).toThrow('Comprimento inválido');
    expect(() => solveFourBar({ lengths: { ...referenceLengths, rocker: Number.NaN }, inputAngleRad: 0, branch: 'plus' })).toThrow('Comprimento inválido');

    const impossible = solveFourBar({ lengths: { ...referenceLengths, crank: 80 }, inputAngleRad: 0, branch: 'plus' });
    expect(impossible.status).toBe('impossible');
    expect(impossible.coordinates).toBeUndefined();
    expect(impossible.residuals).toBeUndefined();
  });

  it('detects a singular tangent and a degenerate coincident-circle case', () => {
    const singular = solveFourBar({ lengths: { ground: 100, crank: 30, coupler: 120, rocker: 50 }, inputAngleRad: 0, branch: 'plus' });
    expect(singular.status).toBe('singular');
    expect(singular.coordinates).toBeDefined();
    expect(singular.residuals?.maxLengthErrorMm).toBeLessThan(1e-9);

    const degenerate = solveFourBar({ lengths: { ground: 40, crank: 40, coupler: 90, rocker: 90 }, inputAngleRad: 0, branch: 'plus' });
    expect(degenerate.status).toBe('degenerate');
    expect(degenerate.coordinates).toBeUndefined();
  });

  it('recalculates after changing the crank from 40 mm to 80 mm', () => {
    const original = solveFourBar({ lengths: referenceLengths, inputAngleRad: 0, branch: 'plus' });
    const changedImpossible = solveFourBar({ lengths: { ...referenceLengths, crank: 80 }, inputAngleRad: 0, branch: 'plus' });
    const changedSolved = solveFourBar({ lengths: { ...referenceLengths, crank: 80 }, inputAngleRad: Math.PI / 2, branch: 'plus' });
    expect(original.status).toBe('solved');
    expect(changedImpossible.status).toBe('impossible');
    expect(changedSolved.status).toBe('solved');
    expect(changedSolved.coordinates!.crankCouplerJoint.x).toBeCloseTo(0, 12);
    expect(changedSolved.coordinates!.crankCouplerJoint.y).toBeCloseTo(80, 12);
    expect(changedSolved.residuals!.maxLengthErrorMm).toBeLessThan(1e-9);
    expect(changedSolved.grashof.classification).toBe('non-grashof');
  });
});
