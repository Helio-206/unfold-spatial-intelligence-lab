import { describe, expect, it } from 'vitest';
import { validateSpatialPlanV2, type SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { analyseFunction, proposeMechanism } from '../src/living/intelligence/inference';
import { solveMechanism, applyPose } from '../src/living/intelligence/kinematics';
import { basisOf, isConfirmed, validateMechanism, withEvent } from '../src/living/intelligence/mechanism';
import { componentGeometry } from '../src/living/intelligence/plan-geometry';

const I = { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] } as const, mat = { profile: 'metal', color: '#777777', roughness: 0.4, metalness: 0.7, clearcoat: 0 } as const;
const box = (key: string, d: [number, number, number]) => ({ type: 'shape', key, operator: 'box', parameters: { dimensions: d }, transform: I, repeat: null, material: mat }) as const;
const cyl = (key: string, r: number, h: number, rot: [number, number, number] = [0, 0, 0]) => ({ type: 'shape', key, operator: 'cylinder', parameters: { radiusTop: r, radiusBottom: r, height: h, radialSegments: 16 }, transform: { ...I, rotationRad: rot }, repeat: null, material: mat }) as const;
const comp = (id: string, pos: [number, number, number], geometry: unknown) => ({ id, label: id, parentId: null, geometry, transform: { ...I, position: pos }, provenance: { geometry: 'inferred', transform: 'inferred', material: 'inferred', evidence: 'fixture' } });
// a hinged lid: base (2x0.2x1), lid (2x0.1x1) above it, a pin along x between them at the back edge
const hinge = (): SpatialPlanV2 => validateSpatialPlanV2({ contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: 'c'.repeat(64) }, title: 'Hinge', units: 'm', presentationProfile: 'neutral',
  components: [comp('base', [0, 0, 0], box('base-shell', [2, 0.2, 1])), comp('lid', [0, 0.2, 0], box('lid-shell', [2, 0.1, 1])), comp('pin', [0, 0.1, -0.5], cyl('pin-shell', 0.05, 2.2, [0, 0, Math.PI / 2])), comp('loose', [5, 5, 5], box('loose-shell', [0.2, 0.2, 0.2]))],
  relations: [], constraints: [], unknowns: [] });

describe('functional hypotheses read from geometry', () => {
  it('computes component boxes and the axis of a cylinder from the plan itself', () => {
    const g = componentGeometry(hinge(), 'pin')!; expect(g.box!.half[0]).toBeCloseTo(1.1, 6); expect(g.box!.half[1]).toBeCloseTo(0.05, 6); const ax = g.clues[0]!.axis!; expect(Math.abs(ax[0])).toBeCloseTo(1, 6);
  });
  it('a pin between two parts becomes ONE hinge hypothesis between them, about the pin axis; the pin rides with the larger part; origin is "extracted", never confirmed', () => {
    const r = proposeMechanism(hinge(), { ground: 'base' }), revolute = r.mechanism.joints.filter((j) => j.kind === 'revolute');
    expect(revolute).toHaveLength(1); expect(new Set([revolute[0]!.parent, revolute[0]!.child])).toEqual(new Set(['base', 'lid'])); expect(Math.abs(revolute[0]!.axis[0])).toBeCloseTo(1, 6); expect(revolute[0]!.claim.origin).toBe('extracted'); expect(revolute[0]!.claim.evidence).toMatch(/não prova/);
    expect(r.mechanism.joints.every((j) => !isConfirmed(r.mechanism, j.id))).toBe(true); expect(basisOf(r.mechanism)).toBe('hypothesis'); expect(r.notes.join(' ')).toMatch(/Sem indício de ligação.*loose/);
    expect(r.descriptors.pin).toMatch(/cilíndrica/);
  });
  it('the lid really opens about that hypothesised axis (kinematics on the extracted mechanism), and results say they rest on a hypothesis until confirmed', () => {
    const r = proposeMechanism(hinge(), { ground: 'base' }), hinged = r.mechanism.joints.find((j) => j.kind === 'revolute')!, m = validateMechanism({ ...r.mechanism, joints: r.mechanism.joints.map((j) => (j.id === hinged.id ? { ...j, origin: [0, 0.1, -0.5] as [number, number, number] } : j)) });
    const out = solveMechanism(m, { inputs: { [hinged.id]: Math.PI / 2 } }), lidFar = applyPose(out.poses.lid!, [0, 0.25, 0.5]); expect(out.status).toBe('solved'); expect(out.basis).toBe('hypothesis');
    expect(Math.abs(lidFar[0])).toBeLessThan(1e-9); // the free edge swings about the pin: x unchanged
    const accepted = withEvent(m, { kind: 'accepted', target: hinged.id, by: 'person' }); expect(isConfirmed(accepted, hinged.id)).toBe(true); expect(solveMechanism(accepted, { inputs: { [hinged.id]: 0.3 } }).basis).toBe('mixed'); // the fixed hypotheses are still unconfirmed
  });
  it('function analysis: fixed vs movable parts, dependencies, and a driving set that leaves no freedom', () => {
    const r = proposeMechanism(hinge(), { ground: 'base' }), f = analyseFunction(r.mechanism);
    expect(f.movableParts).toContain('lid'); expect(f.fixedParts).toContain('pin'); expect(f.unlinkedParts).toEqual(['loose']); expect(f.mobility).toBe(1); expect(f.actuatorSets[0]).toHaveLength(1);
    expect(f.dependencies.find((d) => d.joint.includes('lid'))!.moves).toContain('lid');
  });
  it('a declared coaxial constraint is a hinge clue with the declared axis; without any clue nothing is invented', () => {
    const p = validateSpatialPlanV2({ ...hinge(), constraints: [{ id: 'c1', kind: 'coaxial', componentIds: ['base', 'lid'], axis: 'z', tolerance: 0.01 }], components: hinge().components.filter((c) => c.id !== 'pin') });
    const j = proposeMechanism(p, { ground: 'base' }).mechanism.joints.find((x) => x.kind === 'revolute')!; expect(j.axis).toEqual([0, 0, 1]); expect(j.claim.evidence).toMatch(/coaxial/);
    const lone = validateSpatialPlanV2({ ...hinge(), components: [hinge().components[3]!, hinge().components[0]!] }); expect(proposeMechanism(lone).mechanism.joints).toEqual([]);
  });
});
