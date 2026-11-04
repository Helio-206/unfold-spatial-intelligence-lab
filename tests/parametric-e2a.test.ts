import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { applySpatialOperationV2, validateSpatialPlanV2, type MaterialV2 } from '../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../src/universal-spatial/geometry-compiler-v2';
import { measureJointClosure, proposeGeometry, taperedBeam, troughShell } from '../src/universal-spatial/parametric-e2a';

const material: MaterialV2 = { profile: 'industrial', color: '#aaaabb', roughness: 0.5, metalness: 0.2, clearcoat: 0 };
const sections = [{ z: 0, width: 0.5, height: 0.6 }, { z: 2, width: 0.3, height: 0.4 }, { z: 4, width: 0.2, height: 0.2 }];
const plan = () => validateSpatialPlanV2(JSON.parse(readFileSync('reports/universal-spatial-v2/evidence/live-image-plan.json', 'utf8')).plan);

describe('isolated parametric geometry', () => {
  it('generates a deterministic variable-section V2 loft and validates a non-mutating inferred proposal', () => {
    const p = plan(), before = JSON.stringify(p), c = p.components.find(c => c.id === 'boom')!;
    const beam = taperedBeam(c.geometry.key, sections, material);
    expect(beam).toEqual(taperedBeam(c.geometry.key, sections, material));
    const proposal = proposeGeometry(p, c.id, beam, 'Synthetic parameters; no source dimensions measured.');
    expect(JSON.stringify(p)).toBe(before);
    const next = applySpatialOperationV2(p, proposal.operation, proposal.provenance);
    expect(next.components.find(x => x.id === c.id)?.provenance.geometry).toBe('inferred');
    expect(next.source).toEqual(p.source);
    const compiled = compileSpatialPlanV2(next); disposeCompiledSpatialPlan(compiled.root);
  });
  it('generates a bounded concave open trough from existing extrude', () => {
    const shell = troughShell('shell', 2, 1, 1, 0.1, material);
    expect(shell.type === 'shape' && shell.operator).toBe('extrude');
    expect(() => troughShell('shell', 1, 1, 1, 0.5, material)).toThrow();
  });
  it('rejects degenerate, unordered, excessive and nonfinite sections', () => {
    expect(() => taperedBeam('beam', [sections[1]!, sections[0]!], material)).toThrow();
    expect(() => taperedBeam('beam', [{ z: 0, width: 0, height: 1 }, sections[1]!], material)).toThrow();
    expect(() => taperedBeam('beam', Array.from({ length: 33 }, (_, z) => ({ z, width: 1, height: 1 })), material)).toThrow();
    expect(() => taperedBeam('beam', [{ z: NaN, width: 1, height: 1 }, sections[1]!], material)).toThrow();
  });
  it('measures closure in rigid parent-relative frames and reports a perturbation without correcting it', () => {
    const bodies = [ { id: 'boom', parentId: null, position: [0, 0, 0] as [number,number,number], rotationRad: [0, 0, Math.PI / 2] as [number,number,number] }, { id: 'stick', parentId: 'boom', position: [2, 0, 0] as [number,number,number], rotationRad: [0, 0, 0] as [number,number,number] } ];
    const joints = [{ id: 'pivot', a: 'boom', b: 'stick', anchorA: [2, 0, 0] as [number,number,number], anchorB: [0, 0, 0] as [number,number,number] }];
    expect(measureJointClosure(bodies, joints)[0]!.residual).toBeCloseTo(0, 12);
    bodies[1]!.position[0] += 0.25;
    expect(measureJointClosure(bodies, joints)[0]!.residual).toBeCloseTo(0.25, 12);
    expect(bodies[1]!.position[0]).toBe(2.25);
  });
  it('rejects cyclic frames and unknown joints', () => {
    const b = [{ id: 'a', parentId: 'b', position: [0, 0, 0] as [number,number,number], rotationRad: [0, 0, 0] as [number,number,number] }, { id: 'b', parentId: 'a', position: [0, 0, 0] as [number,number,number], rotationRad: [0, 0, 0] as [number,number,number] }];
    expect(() => measureJointClosure(b, [])).toThrow('INVALID_HIERARCHY');
    expect(() => measureJointClosure([], [{ id: 'j', a: 'a', b: 'b', anchorA: [0,0,0], anchorB: [0,0,0] }])).toThrow('INVALID_HIERARCHY');
  });
});
