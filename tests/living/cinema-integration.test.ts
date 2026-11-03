import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EXCAVATOR_ASSEMBLY_V1 as ASSEMBLY } from '../../src/living/contracts/fixtures/excavator.assembly.v1';
import referencePose from '../../src/living/contracts/fixtures/excavator.reference-pose.json';
import { validateMotionFrame, type MotionFrame } from '../../src/living/contracts';
import { SCENARIO_STEPS, buildExcavatorScenario } from '../../src/living/engineering/scenario';
import { commandMove, createEngineeringSession, sampleEngineeringMotion, sessionDurationS } from '../../src/living/engineering';
import { foundryVisualProvider } from '../../src/living/cinema/foundry-provider';
import { createEngineSessionSource, engineScenarioSession } from '../../src/living/cinema/engine-pose-source';
import { MotionFramePlayer, ReferencePoseSource, referencePartsFrom } from '../../src/living/cinema/pose-source';
import { machineBounds } from '../../src/living/cinema/visual-provider';

const ids = ASSEMBLY.parts.map((p) => p.id);
const quatDelta = (a: THREE.Quaternion, q: number[]) => 1 - Math.abs(a.x * q[0]! + a.y * q[1]! + a.z * q[2]! + a.w * q[3]!);

describe('engine session as a pose source', () => {
  const { session, durationS } = engineScenarioSession();
  const source = createEngineSessionSource(session, durationS);
  it('is the scenario of PR #12: its duration is the session duration, and every step was accepted', () => {
    expect(durationS).toBeCloseTo(sessionDurationS(session), 12); expect(durationS).toBeGreaterThan(1.5);
    const direct = SCENARIO_STEPS.reduce((s, [, targets]) => { const r = commandMove(s, { targets }); if (!r.ok) throw new Error(r.code); return r.session; }, createEngineeringSession(ASSEMBLY));
    expect(sessionDurationS(direct)).toBeCloseTo(durationS, 9);
  });
  it('samples the engine at exactly the requested time: the sample IS the engine frame (no blending, no resampling)', () => {
    for (const t of [0, 1.3, durationS / 2, durationS]) {
      const s = source.sample(t); const f = sampleEngineeringMotion(session, t);
      expect(s.frame).toEqual(f); expect(s.parts).toEqual(f.parts.map((p) => ({ partId: p.partId, translationM: p.translationM, rotation: p.rotation })));
      expect(s.interpolated).toBe(false); expect(s.inputDigest).toBe(f.inputDigest); expect(s.measurements).toEqual(f.measurements); expect(s.derivedFrom).toBeNull();
      expect(validateMotionFrame(s.frame).ok).toBe(true);
    }
  });
  it('is deterministic and really moves the machine over the scenario', () => {
    expect(JSON.stringify(source.sample(2.2))).toBe(JSON.stringify(source.sample(2.2)));
    const bucket = (t: number) => source.sample(t).parts.find((p) => p.partId === 'bucket')!.translationM;
    expect(Math.hypot(...bucket(0).map((v, i) => v - bucket(durationS)[i]!))).toBeGreaterThan(0.3);
  });
  it('clamps time to the session instead of extrapolating', () => { expect(source.sample(-5).timestampS).toBeCloseTo(source.sample(0).timestampS, 12); expect(source.sample(1e6).timestampS).toBeCloseTo(source.sample(durationS).timestampS, 12); });
});

describe('MotionFramePlayer without interpolation (the Foundry rule: the stage does not blend engine frames)', () => {
  const frames = buildExcavatorScenario().frames.map((f) => f.frame).filter((f) => f.status === 'ok' && f.timestampS > 0.2 && f.timestampS < 0.6);
  it('shows the frame at or before t, as the engine produced it, never a blend', () => {
    const p = new MotionFramePlayer(frames, { assemblyId: ASSEMBLY.id, partIds: ids, interpolation: 'none' });
    expect(frames.length).toBeGreaterThanOrEqual(2); const a = frames[0]!; const b = frames[1]!;
    const s = p.sample((a.timestampS + b.timestampS) / 2);
    expect(s.interpolated).toBe(false); expect(s.frame).toEqual(a); expect(s.inputDigest).toBe(a.inputDigest);
    expect(p.sample(b.timestampS).frame).toEqual(b);
  });
});

describe('Visual Foundry adapter (MachineVisualProvider)', () => {
  const visuals = foundryVisualProvider().load(ASSEMBLY) as ReturnType<ReturnType<typeof foundryVisualProvider>['load']> & { source: string; parts: Map<string, THREE.Object3D>; root: THREE.Group; applyPose(s: unknown): { applied: number; unknown: string[]; refused: string | null }; dispose(): void };
  const { session, durationS } = engineScenarioSession(); const source = createEngineSessionSource(session, durationS);
  const world = (id: string) => { visuals.root.updateWorldMatrix(true, true); const o = visuals.parts.get(id)!; return { p: o.getWorldPosition(new THREE.Vector3()), q: o.getWorldQuaternion(new THREE.Quaternion()) }; };

  it('is the Visual Foundry model, one object per canonical part, tagged as such', () => {
    expect(visuals.source).toBe('visual-foundry'); expect([...visuals.parts.keys()].sort()).toEqual([...ids].sort());
    let meshes = 0; visuals.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes += 1; }); expect(meshes).toBeGreaterThan(ids.length);
  });
  it('applies a validated ok frame through the provider: every part lands exactly on the engine pose', () => {
    const s = source.sample(durationS * 0.6); const r = visuals.applyPose(s);
    expect(r.refused).toBeNull(); expect(r.unknown).toEqual([]);
    for (const p of s.parts) { const w = world(p.partId); expect(w.p.distanceTo(new THREE.Vector3(...p.translationM))).toBeLessThan(1e-9); expect(quatDelta(w.q, p.rotation)).toBeLessThan(1e-9); }
  });
  it('the machine articulates: different times give different part poses', () => {
    visuals.applyPose(source.sample(0)); const a = world('bucket').p.clone(); visuals.applyPose(source.sample(durationS)); const b = world('bucket').p.clone();
    expect(a.distanceTo(b)).toBeGreaterThan(0.3);
  });
  it('the reference sample uses the provider reference pose', () => {
    visuals.applyPose(new ReferencePoseSource(ASSEMBLY.id, referencePartsFrom(referencePose)).sample());
    for (const p of referencePartsFrom(referencePose)) expect(world(p.partId).p.distanceTo(new THREE.Vector3(...p.translationM))).toBeLessThan(1e-9);
  });
  it('a blocked frame is shown as the engine says (poseBasis reference), and the adapter reports that nothing was invented', () => {
    const blocked = buildExcavatorScenario().frames.map((f) => f.frame).find((f) => f.status === 'blocked') as MotionFrame;
    const p = new MotionFramePlayer([blocked], { assemblyId: ASSEMBLY.id, partIds: ids, interpolation: 'none' }); const r = visuals.applyPose(p.sample(blocked.timestampS));
    expect(r.refused).toBeNull();
    for (const part of blocked.parts) expect(world(part.partId).p.distanceTo(new THREE.Vector3(...part.translationM))).toBeLessThan(1e-9);
  });
  it('bounds are those of the real model (a machine, not a proxy box)', () => { const b = machineBounds(visuals); expect(b.getSize(new THREE.Vector3()).x).toBeGreaterThan(6); });
  it('disposes without throwing and twice', () => { visuals.dispose(); expect(() => visuals.dispose()).not.toThrow(); });
});

// ---------------------------------------------------------------------------------------------------------------------
// Integration with the merged engine and Foundry: the exported 15-frame sequence, identity checks, hoses during blends, boundaries, disposal
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { assemblyDigest } from '../../src/living/engineering';
import { createMotionSources, exportedScenario } from '../../src/living/cinema/motion-sources';
import { StaticFrameSource, MotionFrameRejected, originOf } from '../../src/living/cinema/pose-source';
import { EngineFrameRejected } from '../../src/living/cinema/engine-pose-source';

describe('the exported 15-frame sequence of the engine', () => {
  const payload = exportedScenario(); const frames = payload.frames.map((f) => f.frame);
  it('has 15 frames, all valid, all for this assembly, 13 ok and 2 blocked, and the digest is that of the effective assembly', () => {
    expect(frames).toHaveLength(15); expect(frames.every((f) => validateMotionFrame(f).ok)).toBe(true);
    expect(new Set(frames.map((f) => f.assemblyDigest))).toEqual(new Set([assemblyDigest(ASSEMBLY)]));
    expect(frames.filter((f) => f.status === 'ok')).toHaveLength(13); expect(frames.filter((f) => f.status === 'blocked')).toHaveLength(2);
    expect(frames.every((f) => f.worldFrameId === ASSEMBLY.root.frameId)).toBe(true);
  });
  it('every frame is classified as produced by the engine (not a fixture)', () => { expect(frames.every((f) => originOf(f) === 'engine')).toBe(true); });
  const sources = createMotionSources(ASSEMBLY);
  it('the sequence source blends only between ok frames of the same origin and says so; frames shown as produced keep their digest and measurements', () => {
    const p = sources.sequence(); const mid = p.sample(0.4); const exact = p.sample(frames.filter((f) => f.status === 'ok')[3]!.timestampS);
    expect(mid.interpolated).toBe(true); expect(mid.measurements).toEqual([]); expect(mid.inputDigest).toBeNull(); expect(mid.derivedFrom).not.toBeNull(); expect(mid.origin).toBe('engine');
    expect(exact.interpolated).toBe(false); expect(exact.inputDigest).toMatch(/^[a-f0-9]{64}$/); expect(exact.frame).not.toBeNull();
    for (const t of [0, 0.1, 0.5, 1, 2.06]) expect(p.sample(t).parts.map((x) => x.partId).sort()).toEqual([...ids].sort());
  });
  it('the blocked examples are shown one by one with the engine reason, the reference pose basis and their own digest (never blended)', () => {
    for (const key of ['blocked-curso', 'blocked-colisao'] as const) {
      const s = sources[key]().sample(0); expect(s.status).toBe('blocked'); expect(s.poseBasis).toBe('reference'); expect(s.blocked?.code).toMatch(/^[A-Z_]+$/); expect(s.blocked?.message.length).toBeGreaterThan(5); expect(s.interpolated).toBe(false); expect(s.inputDigest).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(sources['blocked-curso']().sample(0).blocked?.code).not.toBe(sources['blocked-colisao']().sample(0).blocked?.code);
  });
  it('refuses frames of another effective assembly, another world frame, missing parts, or a different assembly id', () => {
    const f = structuredClone(frames[1]!);
    expect(() => new StaticFrameSource({ ...f, assemblyDigest: 'f'.repeat(64) }, { assemblyDigest: assemblyDigest(ASSEMBLY) })).toThrow(MotionFrameRejected);
    expect(() => new StaticFrameSource({ ...f, worldFrameId: 'x' }, { worldFrameId: 'world' })).toThrow(MotionFrameRejected);
    expect(() => new StaticFrameSource({ ...f, parts: f.parts.slice(1) }, { partIds: ids })).toThrow(/em falta/);
    expect(() => new StaticFrameSource({ ...f, assemblyId: 'outra' }, { assemblyId: ASSEMBLY.id })).toThrow(MotionFrameRejected);
    expect(() => new MotionFramePlayer(frames.filter((x) => x.status === 'ok'), { assemblyDigest: 'a'.repeat(64) })).toThrow(/assemblyDigest/);
  });
  it('an engine session of another assembly is refused frame by frame', () => {
    const { session, durationS } = engineScenarioSession(); const other = { ...ASSEMBLY, id: 'outra-montagem' } as typeof ASSEMBLY;
    expect(() => createEngineSessionSource(session, durationS, other).sample(0)).toThrow(EngineFrameRejected);
  });
  it('a frame labelled as fixture is not classified as engine output, and is never blended with engine frames', () => {
    const fx = structuredClone(frames[2]!); fx.warnings = [{ code: 'FIXTURE_NOT_ENGINE', severity: 'info', message: 'fixture', subjectIds: [] }];
    expect(originOf(fx)).toBe('fixture'); expect(originOf({ ...fx, warnings: [], solver: { ...fx.solver, id: 'outro-solver' } })).toBe('unverified');
    const p = new MotionFramePlayer([frames[2]!, { ...fx, timestampS: 1 }], { assemblyId: ASSEMBLY.id });
    expect(p.sample(0.5).interpolated).toBe(false);
  });
});

describe('Foundry hoses follow every pose that is shown, including blended ones', () => {
  it('re-routes the flexible hoses when a blended (non-engine) pose is applied', () => {
    const v = foundryVisualProvider().load(ASSEMBLY) as ReturnType<ReturnType<typeof foundryVisualProvider>['load']> & { root: THREE.Group; applyPose(s: unknown): { refused: string | null }; dispose(): void };
    const hose = () => { let g: THREE.BufferGeometry | undefined; v.root.traverse((o) => { if (o.userData.displayOnly && (o as THREE.Mesh).isMesh && !g) g = (o as THREE.Mesh).geometry; }); return g!; };
    const p = createMotionSources(ASSEMBLY).sequence(); v.applyPose(p.sample(0.05)); const before = hose().boundingSphere!.center.clone(); const geoBefore = hose();
    const s = p.sample(0.9); expect(s.interpolated).toBe(true); const r = v.applyPose(s);
    expect(r.refused).toBeNull(); expect(hose()).not.toBe(geoBefore); expect(hose().boundingSphere!.center.distanceTo(before)).toBeGreaterThan(1e-3);
    v.dispose();
  });
  it('the provider releases each geometry once, however many times it is disposed', () => {
    const v = foundryVisualProvider().load(ASSEMBLY) as { root: THREE.Group; dispose(): void }; const counts = new Map<THREE.BufferGeometry, number>();
    v.root.traverse((o) => { const g = (o as THREE.Mesh).geometry; if (g && !counts.has(g)) { counts.set(g, 0); g.addEventListener('dispose', () => counts.set(g, counts.get(g)! + 1)); } });
    v.dispose(); v.dispose(); expect(counts.size).toBeGreaterThan(20); for (const n of counts.values()) expect(n).toBeLessThanOrEqual(1);
  });
});

describe('boundaries between Cinema, Foundry and workspace', () => {
  const imports = (dir: string): Array<{ file: string; spec: string }> => {
    const out: Array<{ file: string; spec: string }> = [];
    const walk = (d: string) => { for (const e of readdirSync(d)) { const p = join(d, e); if (statSync(p).isDirectory()) walk(p); else if (/\.(ts|css)$/.test(e)) for (const m of readFileSync(p, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) out.push({ file: p, spec: m[1]! }); } };
    walk(dir); return out;
  };
  it('the cinema does not import the workspace (no second selection system, no duplicated pose owner)', () => { expect(imports('src/living/cinema').filter((i) => /workspace-design/.test(i.spec))).toEqual([]); });
  it('neither the Foundry nor the workspace import the cinema', () => { expect([...imports('src/living/visual-foundry'), ...imports('src/living/workspace-design')].filter((i) => /cinema/.test(i.spec))).toEqual([]); });
  it('the cinema reaches the Foundry only through its provider and registry (plus the shared premium-look profile; no renderer/studio/workspace files)', () => {
    const f = imports('src/living/cinema').filter((i) => /visual-foundry/.test(i.spec)); expect(f.every((i) => /visual-foundry\/(provider|poses|premium-look)$/.test(i.spec))).toBe(true); // premium-look: the shared, reusable look profile (materials + studio data), not renderer/studio/workspace code
  });
  it('the engine does not import the cinema or the Foundry', () => { expect(imports('src/living/engineering').filter((i) => /cinema|visual-foundry|workspace/.test(i.spec))).toEqual([]); });
});
