import { describe, expect, it, vi } from 'vitest';
import { Matrix4, Vector3 } from 'three';
import { applySpatialOperationV2, validateSpatialPlanV2, type SpatialOperationV2, type SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
import { PlanSpaceLayer } from '../src/living/spatial-space/layer';
import { IntelligenceController } from '../src/living/intelligence/controller';
import { IntelligenceStore } from '../src/living/intelligence/store';
import { SimulatedClient } from '../src/living/intelligence/agent-client';

const id = { position: [0, 0, 0], rotationRad: [0, 0, 0], scale: [1, 1, 1] };
const mat = { profile: 'metal', color: '#888888', roughness: 0.4, metalness: 0.7, clearcoat: 0 };
const part = (name: string, position: number[], parentId: string | null = null) => ({ id: name, label: name, parentId, transform: { ...id, position }, provenance: { geometry: 'inferred', transform: 'inferred', material: 'design_approximation', evidence: 'test' }, geometry: { type: 'shape', key: `${name}-shell`, operator: 'box', parameters: { dimensions: [1, 0.2, 1] }, transform: id, repeat: null, material: mat } });
const plan = (): SpatialPlanV2 => validateSpatialPlanV2({ contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: '1'.repeat(64) }, title: 'T', units: 'unitless', presentationProfile: 'neutral', components: [part('base', [0, 0, 0]), part('arm', [1, 0, 0]), part('tip', [2, 0, 0], 'arm')], relations: [], constraints: [], unknowns: [] });
const host = () => ({ changed: vi.fn(), redraw: vi.fn(), notify: vi.fn(), syncLost: vi.fn() });
const memStore = () => { const m = new Map<string, string>(); return new IntelligenceStore({ getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) }); };

describe('rigid poses on the real scene layer (presentation only, nested components move once)', () => {
  const rotZ = (angle: number, about: [number, number, number]) => new Matrix4().makeTranslation(...about).multiply(new Matrix4().makeRotationZ(angle)).multiply(new Matrix4().makeTranslation(-about[0], -about[1], -about[2])).elements;
  it('moves the posed component rigidly about the axis, a nested child follows exactly once, the plan/history are untouched, and clearing restores bit for bit', () => {
    const layer = new PlanSpaceLayer(plan(), host()), snapshot = JSON.stringify(layer.currentPlan), c0 = layer.componentWorldCentre('arm')!, t0 = layer.componentWorldCentre('tip')!, b0 = layer.componentWorldCentre('base')!;
    // the pose is expressed in PLAN coordinates; the presentation scale is uniform, so a chord ratio is scale free
    expect(layer.applyTransientPoses({ arm: [...rotZ(0.4, [0.5, 0, 0])], tip: [...rotZ(0.4, [0.5, 0, 0])] })).toBe(true);
    const c1 = layer.componentWorldCentre('arm')!, t1 = layer.componentWorldCentre('tip')!, d = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
    expect(d(c1, c0)).toBeGreaterThan(1e-3); expect(d(layer.componentWorldCentre('base')!, b0)).toBeLessThan(1e-9);
    // both rotate about the same axis through the same angle: chord = 2 r sin(theta/2) with r the distance to the axis (the tip is nested: its plan position composes with the arm, so it sits at x = 3: r = 2.5 against 0.5) -> ratio 5, scale free
    expect(d(t1, t0) / d(c1, c0)).toBeCloseTo(5, 4); expect(layer.hasRigidPoses).toBe(true); expect(JSON.stringify(layer.currentPlan)).toBe(snapshot); expect(layer.editCount).toBe(0);
    layer.clearRigidPoses(); for (const [k, v] of [['arm', c0], ['tip', t0], ['base', b0]] as const) expect(d(layer.componentWorldCentre(k)!, v)).toBeLessThan(1e-9); expect(layer.hasRigidPoses).toBe(false);
  });
  it('a rebuild never keeps a stale pose', () => { const layer = new PlanSpaceLayer(plan(), host()), c0 = layer.componentWorldCentre('arm')!; layer.applyTransientPoses({ arm: [...rotZ(1, [0, 0, 0])] }); layer.regenerate(); expect(layer.hasRigidPoses).toBe(false); expect(Math.hypot(...layer.componentWorldCentre('arm')!.map((v, i) => v - c0[i]!))).toBeLessThan(1e-9); });
});

describe('structural proposals go through the layer\'s preview -> authorisation -> commit, with one undo', () => {
  const op = (kind: SpatialOperationV2['kind'], componentId: string, value: unknown): SpatialOperationV2 => ({ contract: 'unfold.spatial-operation.v2', operationId: `t-${kind}`, kind, componentId, nodeKey: null, value });
  it('previews without changing anything, needs the authorisation, applies as one step and undoes as one step', async () => {
    const layer = new PlanSpaceLayer(plan(), host()), before = JSON.stringify(layer.currentPlan);
    expect(layer.proposeStructural([op('remove-component', 'arm', { children: 'reparent' })], 'Remover arm', 'person', 'teste')).toBe(true); expect(layer.pendingEdit!.after).toMatch(/sai: arm/); expect(JSON.stringify(layer.currentPlan)).toBe(before);
    await layer.applyEdit(); expect(layer.currentPlan.components).toHaveLength(3); // not authorised: nothing happens
    (layer as unknown as { authorised: boolean }).authorised = true; await layer.applyEdit(); expect(layer.currentPlan.components.map((c) => c.id)).toEqual(['base', 'tip']); expect(layer.currentPlan.components.find((c) => c.id === 'tip')!.parentId).toBeNull();
    expect(layer.editCount).toBe(1); expect(await layer.undo()).toBe(true); expect(JSON.stringify(layer.currentPlan)).toBe(before);
  });
  it('an operation the Spatial Core refuses is never previewed', () => { const layer = new PlanSpaceLayer(plan(), host()); expect(layer.proposeStructural([op('remove-component', 'ghost', { children: 'remove' })], 'x', 'person', 'x')).toBe(false); expect(layer.pendingEdit).toBeNull(); });
});

describe('IntelligenceController: the state behind the panel', () => {
  const make = (store = memStore()) => { const applied: Array<Record<string, number[]>> = [], cleared = vi.fn(), structural = vi.fn(() => true); let p = plan(); const c = new IntelligenceController({ plan: () => p, selectedId: () => 'arm', store, applyPoses: (x) => applied.push(x), clearPoses: cleared, proposeStructural: structural, onChange: () => undefined, now: () => 1000 }); return { c, applied, cleared, structural, store, setPlan: (n: SpatialPlanV2) => { p = n; } }; };
  it('a user joint replaces a hypothesis about the same pair, is "user", moves the child through the solver, and the pose is applied to the scene', () => {
    const { c, applied } = make(); c.proposeFromGeometry(); const n = c.mechanism!.joints.length; expect(n).toBeGreaterThan(0); expect(c.mechanism!.joints.every((j) => j.claim.origin === 'extracted' && !c.isConfirmed(j.id))).toBe(true);
    const id = c.addJoint({ kind: 'revolute', parent: 'base', child: 'arm', axis: [0, 0, 1], origin: [0.5, 0, 0], limits: { min: -1, max: 1 } }); expect(c.isConfirmed(id)).toBe(true); expect(c.mechanism!.joints.filter((j) => (j.parent === 'base' && j.child === 'arm') || (j.parent === 'arm' && j.child === 'base'))).toHaveLength(1);
    expect(c.mechanism!.events.some((e) => e.kind === 'rejected' && e.by === 'person')).toBe(true); const r = c.setJoint(id, 0.5); expect(r!.status).toBe('solved'); expect(applied.at(-1)!.arm).toBeDefined();
    expect(c.setJoint(id, 2)!.status).toBe('limit_violated'); c.reset(); expect(Object.keys(c.q)).toHaveLength(0);
  });
  it('persists by plan hash: a new controller on the same Space restores the mechanism and the experiments; another Space does not see them', () => {
    const a = make(); a.c.addJoint({ kind: 'revolute', parent: 'base', child: 'arm', axis: [0, 0, 1], origin: [0.5, 0, 0] }); const id = a.c.mechanism!.joints[0]!.id; a.c.run({ kind: 'sweep', joint: id, from: 0, to: 1, steps: 5 }, 'varrimento');
    const b = make(a.store); expect(b.c.mechanism!.joints).toHaveLength(1); expect(b.c.experiments).toHaveLength(1); expect(b.c.reproduce(b.c.experiments[0]!.id)).toEqual({ reproduced: true });
    const other = new IntelligenceController({ plan: () => validateSpatialPlanV2({ ...plan(), source: { kind: 'text', sha256: '2'.repeat(64) } }), selectedId: () => null, store: a.store, applyPoses: () => undefined, clearPoses: () => undefined, proposeStructural: () => true, onChange: () => undefined }); expect(other.mechanism).toBeNull();
  });
  it('a structural change of the Space prunes joints of removed components and says so; the rest of the mechanism survives', () => {
    const t = make(); t.c.addJoint({ kind: 'revolute', parent: 'base', child: 'arm', axis: [0, 0, 1], origin: [0.5, 0, 0] }); t.c.addJoint({ kind: 'revolute', parent: 'arm', child: 'tip', axis: [0, 0, 1], origin: [1.5, 0, 0] });
    t.setPlan(applySpatialOperationV2(plan(), op('remove-component', 'tip', { children: 'remove' }), { origin: 'user_provided', evidence: 'x' })); t.c.syncWithPlan(); expect(t.c.mechanism!.parts).toEqual(['base', 'arm']); expect(t.c.mechanism!.joints).toHaveLength(1); expect(t.c.notes.join(' ')).toMatch(/1 junta\(s\) removida/);
    function op(kind: SpatialOperationV2['kind'], componentId: string, value: unknown): SpatialOperationV2 { return { contract: 'unfold.spatial-operation.v2', operationId: 'o', kind, componentId, nodeKey: null, value }; }
  });
  it('accepting an AI joint proposal keeps its AI origin in the claim and records the acceptance as a separate person event; rejecting leaves the mechanism untouched', async () => {
    const t = make(); t.c.addJoint({ kind: 'revolute', parent: 'base', child: 'arm', axis: [0, 0, 1], origin: [0.5, 0, 0] });
    const fake = { source: 'muse-spark' as const, model: 'muse-x', calls: 0, complete: async (i: { step: number }) => (i.step === 0 ? { kind: 'tool_calls' as const, toolCalls: [{ tool: 'propose_joint', args: JSON.stringify({ kind: 'revolute', parent: 'arm', child: 'tip', origin: [1.5, 0, 0], axis: [0, 0, 1], rationale: 'parece uma articulação' }) }] } : { kind: 'answer' as const, statements: [{ text: 'Proponho uma junta.', category: 'ai' as const, refs: [] }], limitations: [] }) };
    const before = t.c.mechanism!.joints.length, turn = await t.c.ask('articula?', fake); expect(turn.proposals).toHaveLength(1); expect(t.c.mechanism!.joints).toHaveLength(before); // nothing yet
    t.c.rejectProposal('p1'); expect(t.c.mechanism!.joints).toHaveLength(before);
    const t2 = make(); t2.c.addJoint({ kind: 'revolute', parent: 'base', child: 'arm', axis: [0, 0, 1], origin: [0.5, 0, 0] }); await t2.c.ask('articula?', fake); expect(t2.c.acceptProposal('p1')).toBe(true);
    const j = t2.c.mechanism!.joints.find((x) => x.child === 'tip')!; expect(j.claim).toMatchObject({ origin: 'ai', model: 'muse-x', proposalId: 'p1' }); expect(t2.c.isConfirmed(j.id)).toBe(true); expect(t2.c.mechanism!.events.filter((e) => e.target === j.id).map((e) => `${e.kind}:${e.by}`)).toEqual(['proposed:ai', 'accepted:person']);
    void SimulatedClient; void Vector3;
  });
});
