import { describe, expect, it } from 'vitest';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../src/living/contracts/fixtures/excavator.assembly.v1';
import { WorkspaceEngineeringSession } from '../../src/living/workspace-design/engineering-session';

describe('workspace engineering session', () => {
  it('requires approval before an engine command changes the displayed session', () => {
    const engine = new WorkspaceEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
    const before = engine.frame();
    const preview = engine.preview('boom_cylinder', 0.65);
    expect(preview.ok).toBe(true);
    expect(engine.frame()).toEqual(before);
    if (!preview.ok) throw new Error(preview.message);
    expect(engine.approve(preview.token).ok).toBe(true);
    expect(engine.state().playing).toBe(true);
    engine.advance(100);
    const final = engine.frame();
    expect(final.status).toBe('ok');
    expect(final.actuators.find((a) => a.actuatorId === 'boom_cylinder')?.value).toBeCloseTo(0.65);
    expect(final.inputDigest).not.toEqual(before.inputDigest);
  });

  it('rejects invalid, unknown, stale and concurrent proposals without changing the current frame', () => {
    const engine = new WorkspaceEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
    const before = engine.frame();
    expect(engine.preview('missing', 0.65).ok).toBe(false);
    expect(engine.preview('boom_cylinder', NaN).ok).toBe(false);
    expect(engine.preview('boom_cylinder', 100).ok).toBe(false);
    expect(engine.frame()).toEqual(before);
    const p = engine.preview('boom_cylinder', 0.65);
    if (!p.ok) throw new Error(p.message);
    expect(engine.approve('invalid').ok).toBe(false);
    expect(engine.approve(p.token).ok).toBe(true);
    expect(engine.preview('stick_cylinder', 0.5).ok).toBe(false);
    engine.reset();
    expect(engine.approve(p.token).ok).toBe(false);
    expect(engine.frame()).toEqual(before);
  });

  it('pauses, seeks and resumes through deterministic engine frames', () => {
    const engine = new WorkspaceEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
    const p = engine.preview('boom_cylinder', 0.65);
    if (!p.ok) throw new Error(p.message);
    engine.approve(p.token);
    engine.advance(0.1);
    engine.pause();
    const paused = engine.frame();
    engine.advance(1);
    expect(engine.frame()).toEqual(paused);
    engine.seek(0);
    engine.resume();
    engine.advance(0.1);
    expect(engine.frame()).toEqual(paused);
  });

  it('rejects a proposal if the visible state changed after preview', () => {
    const engine = new WorkspaceEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
    const first = engine.preview('boom_cylinder', 0.65);
    if (!first.ok) throw new Error(first.message);
    engine.approve(first.token); engine.advance(100);
    const next = engine.preview('boom_cylinder', 0.6);
    if (!next.ok) throw new Error(next.message);
    engine.seek(0);
    const before = engine.frame();
    expect(engine.approve(next.token).ok).toBe(false);
    expect(engine.frame()).toEqual(before);
  });

  it('cancels an in-flight command and restores the preceding approved state', () => {
    const engine = new WorkspaceEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
    const before = engine.frame();
    const proposal = engine.preview('boom_cylinder', 0.65);
    if (!proposal.ok) throw new Error(proposal.message);
    engine.approve(proposal.token); engine.advance(0.1);
    expect(engine.frame().inputDigest).not.toEqual(before.inputDigest);
    engine.cancel();
    expect(engine.frame()).toEqual(before);
    expect(engine.state().playing).toBe(false);
  });

  it('fails closed on a collision and on an unknown actuator rate', () => {
    const collision = structuredClone(EXCAVATOR_ASSEMBLY_V1);
    collision.root.pose.translationM = [0, -1, 0];
    const blocked = new WorkspaceEngineeringSession(collision);
    expect(blocked.frame()).toMatchObject({ status: 'blocked', blocked: { code: 'COLLISION' } });
    expect(blocked.preview('boom_cylinder', 0.65)).toMatchObject({ ok: false, code: 'START_BLOCKED', blockedCode: 'COLLISION' });
    const noRate = structuredClone(EXCAVATOR_ASSEMBLY_V1);
    const actuator = noRate.actuators.find((item) => item.id === 'boom_cylinder')!;
    actuator.maxRate = null;
    const engine = new WorkspaceEngineeringSession(noRate);
    const before = engine.frame();
    expect(engine.preview('boom_cylinder', 0.65)).toMatchObject({ ok: false, code: 'COMMAND_NO_RATE' });
    expect(engine.frame()).toEqual(before);
  });

  it('rejects incompatible frame identities and incomplete pose coverage', () => {
    const engine = new WorkspaceEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
    const check = (engine as unknown as { check(frame: ReturnType<typeof engine.frame>): unknown }).check.bind(engine);
    const valid = engine.frame();
    const wrongDigest = structuredClone(valid); wrongDigest.assemblyDigest = '0'.repeat(64);
    expect(() => check(wrongDigest)).toThrow(/INCOMPATIBLE/);
    const wrongWorld = structuredClone(valid); wrongWorld.worldFrameId = 'other';
    expect(() => check(wrongWorld)).toThrow(/INCOMPATIBLE/);
    const missing = structuredClone(valid); missing.parts.pop();
    expect(() => check(missing)).toThrow(/PARTS_MISMATCH/);
    const wrongAssembly = structuredClone(valid); wrongAssembly.assemblyId = 'other';
    expect(() => check(wrongAssembly)).toThrow(/INCOMPATIBLE/);
  });

  it('owns a copy of the assembly and rejects playback operations after disposal', () => {
    const assembly = structuredClone(EXCAVATOR_ASSEMBLY_V1);
    const engine = new WorkspaceEngineeringSession(assembly);
    const before = engine.frame();
    assembly.root.frameId = 'changed-outside';
    expect(engine.frame()).toEqual(before);
    engine.dispose();
    expect(() => engine.frame()).toThrow(/CLOSED/);
    expect(() => engine.resume()).toThrow(/CLOSED/);
    expect(() => engine.seek(0)).toThrow(/CLOSED/);
    expect(() => engine.advance(0)).toThrow(/CLOSED/);
  });

  it('compares a proposed parameter without changing the approved assembly', () => {
    const engine = new WorkspaceEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
    const before = engine.frame();
    const comparison = engine.compareParameter({ kind: 'actuator_max_rate', actuatorId: 'boom_cylinder', value: 0.1, unit: 'm/s', provenance: { origin: 'human_entered', validation: 'unreviewed', recordedAt: '2026-11-03T00:00:00Z', actor: { kind: 'human', id: 'local-user' } } });
    expect(comparison.ok).toBe(true);
    if (!comparison.ok) throw new Error(comparison.message);
    expect(comparison.after.assemblyDigest).not.toBe(before.assemblyDigest);
    expect(engine.frame()).toEqual(before);
  });

  it('invalidates a rejected proposal before it can be approved', () => {
    const engine = new WorkspaceEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
    const before = engine.frame(); const proposal = engine.preview('boom_cylinder', 0.65);
    if (!proposal.ok) throw new Error(proposal.message);
    engine.reject(proposal.token);
    expect(engine.approve(proposal.token).ok).toBe(false);
    expect(engine.frame()).toEqual(before);
  });

  it('rejects a trajectory with an intermediate collision although its endpoints are clear', () => {
    const assembly = structuredClone(EXCAVATOR_ASSEMBLY_V1);
    const chassis = assembly.parts.find((part) => part.id === 'chassis')!;
    const obstacle = structuredClone(chassis.shapes[0]!);
    if (obstacle.kind !== 'box') throw new Error('Expected box');
    obstacle.id = 'test-obstacle'; obstacle.halfExtentsM = [0.05, 0.05, 0.05];
    obstacle.pose.translationM = [3.735874308224295, 3.631331117145025, -3.84660023204159];
    chassis.shapes.push(obstacle);
    const engine = new WorkspaceEngineeringSession(assembly); const before = engine.frame();
    expect(before.status).toBe('ok');
    expect(engine.preview('swing_drive', 1.6)).toMatchObject({ ok: false, code: 'TRAJECTORY_BLOCKED', blockedCode: 'COLLISION' });
    expect(engine.frame()).toEqual(before);
  });

  it('allows only the latest proposal and never runs simultaneous moves', () => {
    const engine = new WorkspaceEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
    const first = engine.preview('boom_cylinder', 0.65);
    const second = engine.preview('boom_cylinder', 0.6);
    if (!first.ok || !second.ok) throw new Error('Expected valid previews');
    expect(engine.approve(first.token)).toMatchObject({ ok: false, code: 'PROPOSAL_STALE' });
    expect(engine.approve(second.token).ok).toBe(true);
    expect(engine.preview('stick_cylinder', 0.5)).toMatchObject({ ok: false, code: 'SESSION_BUSY' });
  });

  it('closes superseded, rejected and completed session objects', () => {
    const engine = new WorkspaceEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
    const internals = engine as unknown as { session: { closed: boolean }; pending: { session: { closed: boolean } } | null };
    const original = internals.session;
    const first = engine.preview('boom_cylinder', 0.65); if (!first.ok) throw new Error(first.message);
    const discarded = internals.pending!.session;
    const second = engine.preview('boom_cylinder', 0.6); if (!second.ok) throw new Error(second.message);
    expect(discarded.closed).toBe(true);
    const rejected = internals.pending!.session;
    engine.reject(second.token); expect(rejected.closed).toBe(true);
    const third = engine.preview('boom_cylinder', 0.65); if (!third.ok) throw new Error(third.message);
    engine.approve(third.token); engine.advance(100);
    expect(original.closed).toBe(true);
  });
  it('treats repeated approve, reject, cancel, reset and dispose as safe no-ops', () => {
    const engine = new WorkspaceEngineeringSession(EXCAVATOR_ASSEMBLY_V1);
    const before = engine.frame();
    engine.cancel(); engine.reject('none'); engine.reset(); engine.reset();
    expect(engine.frame()).toEqual(before);
    const p = engine.preview('boom_cylinder', 0.65);
    if (!p.ok) throw new Error(p.message);
    expect(engine.approve(p.token).ok).toBe(true);
    expect(engine.approve(p.token)).toMatchObject({ ok: false, code: 'PROPOSAL_STALE' });
    engine.reject(p.token);
    engine.advance(0.1);
    engine.cancel(); engine.cancel();
    expect(engine.frame()).toEqual(before);
    expect(engine.state().playing).toBe(false);
    engine.dispose(); engine.dispose(); engine.reset();
    expect(() => engine.frame()).toThrow('ENGINE_SESSION_CLOSED');
    expect(engine.preview('boom_cylinder', 0.65)).toMatchObject({ ok: false, code: 'SESSION_CLOSED' });
    expect(engine.approve(p.token)).toMatchObject({ ok: false, code: 'PROPOSAL_STALE' });
  });
});
