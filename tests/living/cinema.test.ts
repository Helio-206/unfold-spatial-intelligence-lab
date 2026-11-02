import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../src/living/contracts/fixtures/excavator.assembly.v1';
import referencePose from '../../src/living/contracts/fixtures/excavator.reference-pose.json';
import { validateMotionFrame, type MotionFrame } from '../../src/living/contracts';
import { applyPose, machineBounds, proxyVisualProvider } from '../../src/living/cinema/visual-provider';
import { createStudioMaterials } from '../../src/living/cinema/studio-materials';
import { MotionFramePlayer, MotionFrameRejected, ReferencePoseSource, referencePartsFrom } from '../../src/living/cinema/pose-source';
import { blendPoseOrbital, buildShots, CameraDirector, framingOf, planCut, planTour, poseAt, sampleShot, SHOT_IDS, type CameraPose } from '../../src/living/cinema/choreography';
import { CINEMA_TIERS, pickTier, stepDown } from '../../src/living/cinema/quality';
import { STUDIO_PANELS } from '../../src/living/cinema/studio-environment';

const hex = (c: string) => c.repeat(64).slice(0, 64);
function frame(t: number, over: Partial<MotionFrame> = {}, dx = 0): MotionFrame {
  const parts = referencePartsFrom(referencePose).map((p) => ({ ...p, translationM: [p.translationM[0] + dx, p.translationM[1], p.translationM[2]] as [number, number, number] }));
  return {
    schema: 'unfold.motion-frame.v1', assemblyId: EXCAVATOR_ASSEMBLY_V1.id, assemblyDigest: hex('a'), inputDigest: hex('b'), index: null, timestampS: t, worldFrameId: 'world', status: 'ok', poseBasis: 'solved',
    parts, joints: [], actuators: [], measurements: [], solver: { id: 'test', version: '0', method: 'test', status: 'solved', closureResidualM: 0, toleranceM: 1e-6, assumptions: ['frame sintético de teste'] },
    collisions: { checked: false, shapesChecked: [], shapesSkipped: [], groundPlaneChecked: false, contacts: [] }, warnings: [], blocked: null, evidence: [], ...over,
  } as MotionFrame;
}

describe('pose sources', () => {
  it('reads the reference pose with a real check, and rejects a broken one', () => {
    expect(referencePartsFrom(referencePose)).toHaveLength(EXCAVATOR_ASSEMBLY_V1.parts.length);
    expect(() => referencePartsFrom({ parts: [{ partId: 'x', translationM: [0, 0], rotation: [0, 0, 0, 1] }] })).toThrow();
    expect(() => referencePartsFrom({ parts: [{ partId: 'x', translationM: [0, 0, 0], rotation: [0, 0, 0, 2] }] })).toThrow();
  });
  it('the reference source says it is a reference, with no motion and no engine digest', () => {
    const s = new ReferencePoseSource(EXCAVATOR_ASSEMBLY_V1.id, referencePartsFrom(referencePose)).sample();
    expect(s).toMatchObject({ status: 'reference', poseBasis: 'reference', interpolated: false, inputDigest: null, blocked: null });
  });
  it('the test frames are valid motion frames (so the player tests mean something)', () => { expect(validateMotionFrame(frame(0)).ok).toBe(true); });
  it('MotionFramePlayer validates every frame and refuses a sequence with an invalid one (no partial playback)', () => {
    expect(() => new MotionFramePlayer([])).toThrow(MotionFrameRejected);
    expect(() => new MotionFramePlayer([frame(0), { ...frame(1), status: 'weird' }])).toThrow(/frames\[1\]/);
    expect(() => new MotionFramePlayer([frame(0), { ...frame(1), assemblyId: 'outra-montagem' }])).toThrow(/montagens diferentes/);
  });
  it('blends only between two ok frames, and says it did', () => {
    const p = new MotionFramePlayer([frame(0), frame(2, {}, 4)]);
    const mid = p.sample(1); const start = p.sample(0); const end = p.sample(2);
    expect(mid.interpolated).toBe(true); expect(start.interpolated).toBe(false); expect(end.interpolated).toBe(false);
    const x = (s: typeof mid) => s.parts.find((q) => q.partId === 'boom')!.translationM[0];
    expect(x(mid)).toBeCloseTo((x(start) + x(end)) / 2, 9);
    expect(p.durationS).toBe(2);
  });
  it('never blends across a blocked frame and shows the frame as the engine produced it (poseBasis, blocked info, warnings)', () => {
    const blocked = frame(2, { status: 'blocked', poseBasis: 'held_last_valid', solver: { ...frame(0).solver, status: 'blocked' }, blocked: { code: 'LIMIT', message: 'Limite da lança', subjectIds: ['boom_joint'], firstInvalidTimeS: 1.5 }, warnings: [{ code: 'W', severity: 'warning', message: 'aviso', subjectIds: [] }] }, 4);
    const p = new MotionFramePlayer([frame(0), blocked]);
    const near = p.sample(1.8);
    expect(near).toMatchObject({ status: 'blocked', poseBasis: 'held_last_valid', interpolated: false });
    expect(near.blocked?.code).toBe('LIMIT'); expect(near.warnings).toHaveLength(1);
    expect(p.sample(0.4).status).toBe('ok');
  });
  it('is deterministic: the same time gives the same sample', () => {
    const p = new MotionFramePlayer([frame(0), frame(2, {}, 4)]); expect(JSON.stringify(p.sample(0.7))).toBe(JSON.stringify(p.sample(0.7)));
  });
});

describe('proxy visuals', () => {
  const materials = createStudioMaterials();
  const visuals = proxyVisualProvider(materials).load(EXCAVATOR_ASSEMBLY_V1) as ReturnType<ReturnType<typeof proxyVisualProvider>['load']> & { parts: Map<string, THREE.Object3D>; root: THREE.Group; dispose(): void };
  it('draws exactly the assembly shapes: one object per part, one mesh per shape, tagged as proxy', () => {
    expect(visuals.parts.size).toBe(EXCAVATOR_ASSEMBLY_V1.parts.length);
    let meshes = 0; visuals.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { meshes += 1; expect(o.userData.proxy).toBe(true); } });
    expect(meshes).toBe(EXCAVATOR_ASSEMBLY_V1.parts.reduce((n, p) => n + p.shapes.length, 0));
    expect((visuals as { source: string }).source).toBe('proxy');
  });
  it('places parts from a pose and reports ids it does not know instead of inventing them', () => {
    const sample = new ReferencePoseSource(EXCAVATOR_ASSEMBLY_V1.id, [...referencePartsFrom(referencePose), { partId: 'ghost', translationM: [0, 0, 0], rotation: [0, 0, 0, 1] }]).sample();
    const r = applyPose(visuals, sample); expect(r.applied).toBe(EXCAVATOR_ASSEMBLY_V1.parts.length); expect(r.unknown).toEqual(['ghost']);
    const boom = visuals.parts.get('boom')!; expect(boom.position.toArray()).toEqual([0.95, 1.5, 0]);
    const b = machineBounds(visuals); expect(b.max.x).toBeGreaterThan(8); expect(b.min.y).toBeGreaterThanOrEqual(-0.1);
  });
  it('uses one shared material per role family (no per-mesh material allocation)', () => {
    const seen = new Set<THREE.Material>(); visuals.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) seen.add((o as THREE.Mesh).material as THREE.Material); });
    expect(seen.size).toBeLessThanOrEqual(materials.all().length);
  });
});

describe('camera choreography', () => {
  const visuals = proxyVisualProvider(createStudioMaterials()).load(EXCAVATOR_ASSEMBLY_V1) as unknown as { parts: Map<string, THREE.Object3D>; root: THREE.Group };
  applyPose(visuals, new ReferencePoseSource(EXCAVATOR_ASSEMBLY_V1.id, referencePartsFrom(referencePose)).sample());
  const framing = framingOf(machineBounds(visuals), (referencePose as { tip: number[] }).tip as [number, number, number]);
  const shots = buildShots(framing);
  const dist = (a: CameraPose['position'], b: CameraPose['position']) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

  it('has every shot, authored relative to the machine, looking at it', () => {
    expect(shots.map((s) => s.id)).toEqual([...SHOT_IDS]);
    for (const shot of shots) for (const k of shot.keys) {
      const toCenter = dist(k.target, framing.center); expect(toCenter).toBeLessThan(framing.radius * (shot.id === 'bucket' ? 1.3 : 0.6));
      expect(k.position[1]).toBeGreaterThan(framing.floorY); // never under the floor
    }
  });
  it('is a pure function of time: same shot, same time, same camera', () => {
    for (const shot of shots) expect(JSON.stringify(sampleShot(shot, 0.37))).toBe(JSON.stringify(sampleShot(shot, 0.37)));
  });
  it('moves smoothly: no step between 1/60 s frames larger than a small fraction of the machine', () => {
    for (const shot of shots) {
      let worst = 0; let prev = sampleShot(shot, 0); const n = shot.durationS * 60;
      for (let i = 1; i <= n; i += 1) { const cur = sampleShot(shot, i / n); worst = Math.max(worst, dist(prev.position, cur.position)); prev = cur; }
      expect(worst).toBeLessThan(framing.radius * 0.03);
    }
  });
  it('transitions start exactly where the camera was and end exactly on the shot, swinging around the machine', () => {
    const from: CameraPose = { position: [-9, 3, -12], target: [1, 1, 2], fov: 45 };
    const to = sampleShot(shots[0]!, 0);
    const a = blendPoseOrbital(from, to, 0, framing.center); const b = blendPoseOrbital(from, to, 1, framing.center);
    expect(dist(a.position, from.position)).toBeLessThan(1e-9); expect(dist(b.position, to.position)).toBeLessThan(1e-9); expect(b.fov).toBeCloseTo(to.fov, 9);
    let minRadius = Infinity; for (let i = 0; i <= 40; i += 1) { const p = blendPoseOrbital(from, to, i / 40, framing.center); minRadius = Math.min(minRadius, dist(p.position, framing.center)); }
    expect(minRadius).toBeGreaterThan(framing.radius * 1.2); // never passes through the machine
  });
  it('plans: a cut = transition + shot; a tour chains shots; poseAt holds the last pose and reports done', () => {
    const from = sampleShot(shots[1]!, 0.5); const cut = planCut(shots, 'hero', from, framing.center, 1.6);
    expect(cut.totalS).toBeCloseTo(1.6 + shots[0]!.durationS, 9); expect(dist(poseAt(cut, 0).pose.position, from.position)).toBeLessThan(1e-9);
    expect(poseAt(cut, 1.6).shotId).toBe(null); expect(poseAt(cut, 2).shotId).toBe('hero'); expect(poseAt(cut, 1000).done).toBe(true);
    const tour = planTour(shots, ['hero', 'profile', 'bucket'], from, framing.center); expect(tour.segments.filter((s) => s.kind === 'shot')).toHaveLength(3);
    expect(() => planCut(shots, 'nope' as never, from, framing.center)).toThrow();
  });
  it('the director only advances through advance(dt): no clock, deterministic, hands control back at the end', () => {
    const run = () => { const d = new CameraDirector(shots, framing.center, sampleShot(shots[0]!, 0)); d.cut('profile', sampleShot(shots[0]!, 0), 1); let last = d.pose; let steps = 0; while (d.active && steps < 5000) { last = d.advance(1 / 60).pose; steps += 1; } return { last, steps }; };
    const a = run(); const b = run(); expect(JSON.stringify(a)).toBe(JSON.stringify(b)); expect(a.steps).toBeGreaterThan(9 * 60 - 5);
    const d = new CameraDirector(shots, framing.center, sampleShot(shots[0]!, 0)); d.cut('orbit', undefined, 0); d.release(); expect(d.active).toBe(false); expect(d.advance(1).moving).toBe(false);
  });
});

describe('quality tiers and studio set', () => {
  it('picks the tier from the device and never raises it on its own', () => {
    expect(pickTier({ software: true, maxTextureSize: 16384 })).toBe('light'); expect(pickTier({ software: false, maxTextureSize: 2048 })).toBe('light');
    expect(pickTier({ software: false, maxTextureSize: 4096 })).toBe('balanced'); expect(pickTier({ software: false, maxTextureSize: 16384 })).toBe('studio');
    expect(pickTier({ software: true, maxTextureSize: 16384 }, 'studio')).toBe('studio'); // an explicit request is honoured, and reported as such by the UI
  });
  it('steps down in a fixed order and never up', () => {
    const base = CINEMA_TIERS.studio; const one = stepDown(base, 1); const two = stepDown(base, 2);
    expect(one.ao).toBe(false); expect(one.bloom).toBe(true); expect(two.bloom).toBe(false); expect(two.maxPixelRatio).toBe(1); expect(two.shadowMapSize).toBeLessThanOrEqual(1024);
    expect(stepDown(base, 0)).toEqual(base); expect(two.shadows).toBe(base.shadows);
  });
  it('the studio environment has real HDR panels (radiance above 1) so metals can reflect highlights', () => {
    expect(STUDIO_PANELS.filter((p) => p.radiance > 1).length).toBeGreaterThanOrEqual(5); expect(STUDIO_PANELS.map((p) => p.id)).toEqual(expect.arrayContaining(['key', 'rim', 'strip-left', 'strip-right']));
  });
});
