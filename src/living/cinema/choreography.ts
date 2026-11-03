import * as THREE from 'three';

/**
 * Camera choreography: shots are authored RELATIVE to the machine's bounds (so they follow any assembly, including the Visual Foundry model), sampled
 * by a pure function of time, and joined by orbital transitions that never cut through the machine. Same plan + same time = same camera, byte for byte:
 * evidence frames and tests can seek to an exact instant.
 */
export type Vec3 = [number, number, number];
export type CameraPose = { position: Vec3; target: Vec3; fov: number };
export type CameraKey = CameraPose;
export const SHOT_IDS = ['hero', 'profile', 'bucket', 'reach', 'top', 'orbit'] as const;
export type ShotId = (typeof SHOT_IDS)[number];
export type Ease = 'inOutSine' | 'linear' | 'outCubic';
export type Shot = { id: ShotId; label: string; durationS: number; ease: Ease; keys: CameraKey[]; loop: boolean };

const EASE: Record<Ease, (u: number) => number> = {
  inOutSine: (u) => 0.5 - 0.5 * Math.cos(Math.PI * u),
  linear: (u) => u,
  outCubic: (u) => 1 - (1 - u) ** 3,
};
const clamp01 = (u: number) => Math.min(1, Math.max(0, u));
const smoother = (u: number) => u * u * u * (u * (u * 6 - 15) + 10);

export type MachineFraming = { center: Vec3; radius: number; floorY: number; tip: Vec3 | null };
export function framingOf(bounds: THREE.Box3, tip: Vec3 | null): MachineFraming {
  const sphere = bounds.getBoundingSphere(new THREE.Sphere()); const c = sphere.center;
  return { center: [c.x, c.y, c.z], radius: Math.max(1, sphere.radius), floorY: bounds.min.y, tip };
}

/** A point on a sphere around `target`: azimuth from +X toward +Z, elevation above the floor plane. */
function orbitKey(f: MachineFraming, azDeg: number, elDeg: number, distMul: number, fov: number, targetOffset: Vec3 = [0, 0, 0], around: Vec3 = f.center): CameraKey {
  const az = (azDeg * Math.PI) / 180; const el = (elDeg * Math.PI) / 180; const d = f.radius * distMul;
  const target: Vec3 = [around[0] + targetOffset[0] * f.radius, around[1] + targetOffset[1] * f.radius, around[2] + targetOffset[2] * f.radius];
  return { position: [target[0] + d * Math.cos(el) * Math.cos(az), target[1] + d * Math.sin(el), target[2] + d * Math.cos(el) * Math.sin(az)], target, fov };
}

export function buildShots(f: MachineFraming): Shot[] {
  const tip = f.tip ?? f.center; const lowCenter: Vec3 = [f.center[0], f.center[1] - 0.12 * f.radius, f.center[2]];
  const orbit: CameraKey[] = []; for (let i = 0; i <= 12; i += 1) orbit.push(orbitKey(f, 38 + i * 30, 15 + 3 * Math.sin((i / 12) * Math.PI * 2), 3.1, 30, [0, -0.04, 0]));
  return [
    { id: 'hero', label: 'Plano herói', durationS: 9, ease: 'inOutSine', loop: false, keys: [orbitKey(f, 36, 13, 3.15, 30, [0, -0.04, 0]), orbitKey(f, 33, 12, 2.8, 29, [0, -0.04, 0])] },
    { id: 'profile', label: 'Perfil', durationS: 8, ease: 'inOutSine', loop: false, keys: [orbitKey(f, 90, 4, 3.5, 24, [-0.1, 0.0, 0], lowCenter), orbitKey(f, 90, 5, 3.5, 24, [0.0, 0.0, 0], lowCenter), orbitKey(f, 90, 4, 3.5, 24, [0.1, 0.0, 0], lowCenter)] },
    { id: 'bucket', label: 'Balde', durationS: 8, ease: 'inOutSine', loop: false, keys: [orbitKey(f, 52, 14, 1.75, 30, [0, 0.16, 0], tip), orbitKey(f, 62, 16, 1.55, 28, [0, 0.17, 0], tip), orbitKey(f, 74, 15, 1.4, 27, [0, 0.18, 0], tip)] },
    { id: 'reach', label: 'Alcance', durationS: 8, ease: 'inOutSine', loop: false, keys: [orbitKey(f, 150, 14, 3.05, 32, [0.02, -0.02, 0]), orbitKey(f, 140, 20, 2.7, 30, [0.04, -0.01, 0])] },
    { id: 'top', label: 'Planta', durationS: 6, ease: 'inOutSine', loop: false, keys: [orbitKey(f, 20, 62, 3.5, 30), orbitKey(f, 20, 80, 3.2, 30)] },
    { id: 'orbit', label: 'Órbita', durationS: 24, ease: 'linear', loop: true, keys: orbit },
  ];
}

const curveCache = new WeakMap<Shot, { pos: THREE.CatmullRomCurve3; tgt: THREE.CatmullRomCurve3 }>();
function curves(shot: Shot) {
  let c = curveCache.get(shot);
  if (!c) { c = { pos: new THREE.CatmullRomCurve3(shot.keys.map((k) => new THREE.Vector3(...k.position)), false, 'centripetal'), tgt: new THREE.CatmullRomCurve3(shot.keys.map((k) => new THREE.Vector3(...k.target)), false, 'centripetal') }; curveCache.set(shot, c); }
  return c;
}

/** Pure: the camera of `shot` at normalised time `u` in [0, 1] (clamped). */
export function sampleShot(shot: Shot, u: number): CameraPose {
  const e = EASE[shot.ease](clamp01(u));
  if (shot.keys.length === 1) return shot.keys[0]!;
  const c = curves(shot); const p = c.pos.getPointAt(e); const t = c.tgt.getPointAt(e);
  const span = e * (shot.keys.length - 1); const i = Math.min(shot.keys.length - 2, Math.floor(span)); const k = span - i;
  const fov = shot.keys[i]!.fov + (shot.keys[i + 1]!.fov - shot.keys[i]!.fov) * smoother(k);
  return { position: [p.x, p.y, p.z], target: [t.x, t.y, t.z], fov };
}

/** Pure: blend between two poses by swinging around `around` (azimuth by the short way, radius and elevation eased), so a transition never cuts through the machine. */
export function blendPoseOrbital(a: CameraPose, b: CameraPose, u: number, around: Vec3): CameraPose {
  const k = smoother(clamp01(u));
  const sph = (p: Vec3) => { const x = p[0] - around[0]; const y = p[1] - around[1]; const z = p[2] - around[2]; const r = Math.hypot(x, y, z) || 1e-6; return { r, el: Math.asin(y / r), az: Math.atan2(z, x) }; };
  const sa = sph(a.position); const sb = sph(b.position);
  let d = sb.az - sa.az; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
  const az = sa.az + d * k; const el = sa.el + (sb.el - sa.el) * k; const r = sa.r + (sb.r - sa.r) * k;
  const lerp = (x: number, y: number) => x + (y - x) * k;
  const target: Vec3 = [lerp(a.target[0], b.target[0]), lerp(a.target[1], b.target[1]), lerp(a.target[2], b.target[2])];
  const swing: Vec3 = [around[0] + r * Math.cos(el) * Math.cos(az), around[1] + r * Math.sin(el), around[2] + r * Math.cos(el) * Math.sin(az)];
  return { position: swing, target, fov: lerp(a.fov, b.fov) };
}

export type Segment = { kind: 'transition'; durationS: number; from: CameraPose; to: CameraPose } | { kind: 'shot'; shot: Shot; durationS: number };
export type Plan = { segments: Segment[]; around: Vec3; totalS: number };

export function planCut(shots: Shot[], id: ShotId, from: CameraPose, around: Vec3, transitionS = 1.6): Plan {
  const shot = shots.find((s) => s.id === id); if (!shot) throw new Error(`Plano desconhecido: ${id}`);
  const segments: Segment[] = [];
  if (transitionS > 0) segments.push({ kind: 'transition', durationS: transitionS, from, to: sampleShot(shot, 0) });
  segments.push({ kind: 'shot', shot, durationS: shot.durationS });
  return { segments, around, totalS: segments.reduce((s, x) => s + x.durationS, 0) };
}
export function planTour(shots: Shot[], ids: ShotId[], from: CameraPose, around: Vec3, transitionS = 1.6): Plan {
  const segments: Segment[] = []; let last = from;
  for (const id of ids) {
    const shot = shots.find((s) => s.id === id); if (!shot) throw new Error(`Plano desconhecido: ${id}`);
    if (transitionS > 0) segments.push({ kind: 'transition', durationS: transitionS, from: last, to: sampleShot(shot, 0) });
    segments.push({ kind: 'shot', shot, durationS: shot.durationS }); last = sampleShot(shot, 1);
  }
  return { segments, around, totalS: segments.reduce((s, x) => s + x.durationS, 0) };
}

/** Pure: the camera at `timeS` seconds into a plan (holds the last pose after the end). */
export function poseAt(plan: Plan, timeS: number): { pose: CameraPose; segment: number; shotId: ShotId | null; done: boolean } {
  let t = Math.max(0, timeS);
  for (let i = 0; i < plan.segments.length; i += 1) {
    const seg = plan.segments[i]!;
    if (t <= seg.durationS || i === plan.segments.length - 1) {
      const u = seg.durationS > 0 ? clamp01(t / seg.durationS) : 1;
      if (seg.kind === 'transition') return { pose: blendPoseOrbital(seg.from, seg.to, u, plan.around), segment: i, shotId: null, done: false };
      const wrapped = seg.shot.loop && timeS > plan.totalS ? ((t % seg.durationS) / seg.durationS) : u;
      return { pose: sampleShot(seg.shot, wrapped), segment: i, shotId: seg.shot.id, done: !seg.shot.loop && t >= seg.durationS && i === plan.segments.length - 1 };
    }
    t -= seg.durationS;
  }
  const last = plan.segments.at(-1); const pose = last && last.kind === 'shot' ? sampleShot(last.shot, 1) : (last as { to: CameraPose }).to;
  return { pose, segment: plan.segments.length - 1, shotId: null, done: true };
}

/** Plays a plan. Time only advances through `advance(dt)`; nothing here reads a clock. */
export class CameraDirector {
  private plan: Plan | null = null; private time = 0; private current: CameraPose;
  constructor(public shots: Shot[], private around: Vec3, initial: CameraPose) { this.current = initial; }
  get pose(): CameraPose { return this.current; }
  get active(): boolean { return this.plan !== null; }
  get elapsedS(): number { return this.time; }
  get shotId(): ShotId | null { return this.plan ? poseAt(this.plan, this.time).shotId : null; }
  reframe(shots: Shot[], around: Vec3) { this.shots = shots; this.around = around; }
  cut(id: ShotId, from: CameraPose = this.current, transitionS = 1.6) { this.plan = planCut(this.shots, id, from, this.around, transitionS); this.time = 0; this.current = poseAt(this.plan, 0).pose; return this.current; }
  tour(ids: ShotId[], from: CameraPose = this.current, transitionS = 1.6) { this.plan = planTour(this.shots, ids, from, this.around, transitionS); this.time = 0; this.current = poseAt(this.plan, 0).pose; return this.current; }
  /** hands the camera back to the user (orbit controls) */
  release(): void { this.plan = null; }
  seek(timeS: number): CameraPose { if (!this.plan) return this.current; this.time = Math.max(0, timeS); this.current = poseAt(this.plan, this.time).pose; return this.current; }
  advance(dtS: number): { pose: CameraPose; moving: boolean } {
    if (!this.plan) return { pose: this.current, moving: false };
    this.time += Math.max(0, dtS); const r = poseAt(this.plan, this.time); this.current = r.pose;
    if (r.done) { this.plan = null; return { pose: this.current, moving: false }; }
    return { pose: this.current, moving: true };
  }
}
