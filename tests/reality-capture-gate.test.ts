import { describe, it, expect } from 'vitest';
import { assessGate } from '../src/living/reality/capture-gate';
import type { IntakeResult, ViewReport } from '../src/living/reality/intake';

const view = (over: Partial<ViewReport> = {}): ViewReport => ({ name: 'v', maskSource: 'confirmed', reliable: true, reasons: [], bbox: { x0: 0, y0: 0, x1: 10, y1: 10 }, foregroundRatio: 0.2, ...over });
const ok = (views: ViewReport[], issues: Array<{ code: string }> = []): IntakeResult => ({ evidence: {} as never, refusals: [], views, capture: { issues: issues.map((i) => ({ ...i, severity: 'warning', viewIndexes: [], message: i.code, advice: `fix ${i.code}` })), coverage: { views: views.length, azimuthMaxGapDeg: 45, elevationMinDeg: 20, elevationMaxDeg: 20 } } as never });
const eight = (o: Partial<ViewReport> = {}) => Array.from({ length: 8 }, () => view(o));

describe('capture gate: what is missing, said concretely, before anything is built', () => {
  it('a complete, confirmed capture with a declared elevation passes (the uncalibrated camera is information, not a block)', () => {
    const g = assessGate({ result: ok(eight()), mode: 'orbit', elevationDeclared: true }); expect(g.level).toBe('ok'); expect(g.items.map((i) => i.code)).toEqual(['CAMERA_UNCALIBRATED']);
  });
  it('unconfirmed learned outlines, a missing elevation and few assumed-pose views each stop the silent path and name the fix', () => {
    const g = assessGate({ result: ok(Array.from({ length: 5 }, () => view({ maskSource: 'automatic', maskMethod: 'salient-network+graphcut · concordância 70%' }))), mode: 'turntable', elevationDeclared: false });
    expect(g.level).toBe('low-confidence'); const codes = g.items.map((i) => i.code); expect(codes).toEqual(expect.arrayContaining(['OUTLINES_UNCONFIRMED', 'ELEVATION_UNKNOWN', 'FEW_VIEWS_ASSUMED_POSES']));
    for (const i of g.items.filter((x) => x.severity === 'low-confidence')) { expect(i.what.length).toBeGreaterThan(10); expect(i.how.length).toBeGreaterThan(10); }
  });
  it('clean-background automatic outlines do not count as unconfirmed; capture-quality issues (gap, blur, no top view) are carried with their own advice', () => {
    const g = assessGate({ result: ok(eight({ maskSource: 'automatic', maskMethod: 'classical-colour' }), [{ code: 'ANGULAR_GAP' }, { code: 'NO_ELEVATION_VARIETY' }, { code: 'BLURRY' }]), mode: 'orbit', elevationDeclared: true });
    expect(g.level).toBe('low-confidence'); expect(g.items.some((i) => i.code === 'OUTLINES_UNCONFIRMED')).toBe(false); expect(g.items.find((i) => i.code === 'ANGULAR_GAP')!.how).toBe('fix ANGULAR_GAP');
  });
  it('a cut-off object or a refusal blocks; an unanalysed set blocks', () => {
    expect(assessGate({ result: ok(eight(), [{ code: 'OBJECT_CUT_OFF' }]), mode: 'orbit', elevationDeclared: true }).level).toBe('blocked');
    expect(assessGate({ result: { evidence: null, refusals: [{ code: 'MASK_UNRELIABLE', detail: 'x' }], views: [] } as never, mode: 'orbit', elevationDeclared: true }).level).toBe('blocked');
    expect(assessGate({ result: null, mode: 'orbit', elevationDeclared: true }).level).toBe('blocked');
  });
});
