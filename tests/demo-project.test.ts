import { describe, expect, it } from 'vitest';
import { createEmptyDemoProject, createFourBarDemoProject, parseManualFourBarParameters } from '../src/demo-project';

describe('demo project entry states', () => {
  it('starts empty without claiming mechanism evidence', () => {
    expect(createEmptyDemoProject()).toEqual({ status: 'empty' });
  });

  it('classifies the explicit example as hypothetical and manual input as user-provided', () => {
    expect(createFourBarDemoProject('example')).toMatchObject({ status: 'ready', evidenceStatus: 'hypothetical_user_design' });
    expect(createFourBarDemoProject('manual')).toMatchObject({ status: 'ready', evidenceStatus: 'user_provided' });
  });

  it('accepts only complete positive dimensions and an angle in range', () => {
    expect(parseManualFourBarParameters({ ground: '100', crank: '40', coupler: '120', rocker: '90', angle: '30' })).toEqual({
      status: 'valid', value: { lengths: { ground: 100, crank: 40, coupler: 120, rocker: 90 }, angleDegrees: 30 },
    });
    expect(parseManualFourBarParameters({ ground: '', crank: '40', coupler: '120', rocker: '90', angle: '0' })).toEqual({ status: 'invalid', field: 'ground' });
    expect(parseManualFourBarParameters({ ground: '100', crank: '-1', coupler: '120', rocker: '90', angle: '0' })).toEqual({ status: 'invalid', field: 'crank' });
    expect(parseManualFourBarParameters({ ground: '100', crank: '40', coupler: '120', rocker: '90', angle: '361' })).toEqual({ status: 'invalid', field: 'angle' });
  });
});
