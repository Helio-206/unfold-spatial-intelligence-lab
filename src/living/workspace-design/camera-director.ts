/**
 * The single camera system: OrbitControls for the person, plus short focus transitions for the assistant and for the
 * Focus/Reset tools. Every transition uses the motion tokens, can be interrupted at any moment by user input, and is
 * instant under prefers-reduced-motion. The arbiter decides whether the assistant may move the camera at all.
 */
import gsap from 'gsap';
import { Sphere, Vector3, type PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { DURATION, EASE } from '../../motion/tokens';
import type { CameraArbiter } from './camera-arbiter';
import type { SafeInsets, Viewport } from './digital-hand';
import { fitDistance, safeViewOffset } from './framing';

export type ViewSpec = { target: Vector3; azimuth: number; elevation: number; distance: number };

export class CameraDirector {
  readonly controls: OrbitControls;
  private tween: gsap.core.Tween | null = null;
  private insets: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };
  private viewport: Viewport = { width: 1, height: 1 };
  private home: ViewSpec;
  reducedMotion = false;

  constructor(readonly camera: PerspectiveCamera, dom: HTMLElement, private readonly arbiter: CameraArbiter, private readonly requestRender: () => void, readonly baseFov = 30) {
    this.controls = new OrbitControls(camera, dom);
    this.controls.enableDamping = true; this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 2.5; this.controls.maxDistance = 45;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.screenSpacePanning = true;
    this.controls.addEventListener('start', () => { this.cancel(); arbiter.userInput('user_pointer'); });
    this.controls.addEventListener('end', () => arbiter.userRelease());
    this.controls.addEventListener('change', () => requestRender());
    arbiter.onCancel(() => this.cancel());
    this.home = { target: new Vector3(2.9, 1.8, 0), azimuth: (36 * Math.PI) / 180, elevation: (9 * Math.PI) / 180, distance: 15 };
  }

  setHome(view: ViewSpec): void { this.home = view; }
  homeView(): ViewSpec { return { ...this.home, target: this.home.target.clone() }; }

  /** Applies viewport and UI insets: shifts the projection centre into the usable area. */
  setViewport(viewport: Viewport, insets: SafeInsets): void {
    this.viewport = viewport; this.insets = insets;
    const o = safeViewOffset(viewport, insets, this.baseFov);
    this.camera.fov = o.fov; this.camera.aspect = o.aspect;
    this.camera.setViewOffset(o.fullWidth, o.fullHeight, o.offsetX, o.offsetY, o.width, o.height);
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  get safeInsets(): SafeInsets { return this.insets; }

  /** Called every frame while damping or a transition runs. Returns whether another frame is needed. */
  update(): boolean { const moving = this.controls.update(); return moving || this.tween !== null; }

  cancel(): void { if (this.tween) { this.tween.kill(); this.tween = null; } }

  get transitioning(): boolean { return this.tween !== null; }

  private positionFor(v: ViewSpec): Vector3 {
    return new Vector3(v.target.x + v.distance * Math.cos(v.elevation) * Math.cos(v.azimuth), v.target.y + v.distance * Math.sin(v.elevation), v.target.z - v.distance * Math.cos(v.elevation) * Math.sin(v.azimuth));
  }

  /** Move to a view. `by` says who asked; the assistant needs the arbiter's permission and loses it to any user input. */
  moveTo(v: ViewSpec, by: 'user_tool' | 'assistant'): { moved: boolean; reason?: string } {
    let token = 0;
    if (by === 'assistant') {
      const d = this.arbiter.requestAssistantMove();
      if (!d.granted) return { moved: false, reason: d.reason };
      token = d.token;
    }
    this.cancel();
    const endPos = this.positionFor(v), endTarget = v.target.clone();
    if (this.reducedMotion) {
      this.camera.position.copy(endPos); this.controls.target.copy(endTarget); this.controls.update(); this.requestRender();
      if (by === 'assistant') this.arbiter.assistantDone(token);
      return { moved: true };
    }
    const p0 = this.camera.position.clone(), t0 = this.controls.target.clone();
    const state = { k: 0 };
    this.tween = gsap.to(state, {
      k: 1, duration: DURATION.slow, ease: EASE.inOut,
      onUpdate: () => {
        if (by === 'assistant' && !this.arbiter.isCurrent(token)) { this.cancel(); return; }
        this.camera.position.lerpVectors(p0, endPos, state.k); this.controls.target.lerpVectors(t0, endTarget, state.k); this.requestRender();
      },
      onComplete: () => { this.tween = null; if (by === 'assistant') this.arbiter.assistantDone(token); this.requestRender(); },
    });
    return { moved: true };
  }

  /** Moves the point the camera looks at to `target` keeping direction and distance: selection draws the eye without zooming the person in or out. */
  retarget(target: Vector3, by: 'user_tool' | 'assistant' = 'user_tool'): { moved: boolean; reason?: string } {
    const offset = this.camera.position.clone().sub(this.controls.target), distance = offset.length();
    if (distance < 1e-6 || this.controls.target.distanceTo(target) < 1e-3) return { moved: false };
    const dir = offset.normalize();
    const az = Math.atan2(-dir.z, dir.x), el = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    return this.moveTo({ target: target.clone(), azimuth: az, elevation: Math.max(0.05, el), distance }, by);
  }

  /** Frame a sphere from the current viewing direction, at a distance that fits the usable area. */
  focusSphere(sphere: Sphere, by: 'user_tool' | 'assistant', fill = 0.6): { moved: boolean; reason?: string } {
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    const az = Math.atan2(-dir.z, dir.x), el = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    const distance = Math.max(this.controls.minDistance, fitDistance(sphere.radius, this.viewport, this.insets, this.baseFov, fill));
    return this.moveTo({ target: sphere.center.clone(), azimuth: az, elevation: Math.max(0.05, el), distance }, by);
  }

  reset(): void { this.moveTo(this.home, 'user_tool'); }

  /** Place the camera without a transition (initial framing, captures). */
  jumpTo(v: ViewSpec): void { this.cancel(); this.camera.position.copy(this.positionFor(v)); this.controls.target.copy(v.target); this.controls.update(); this.requestRender(); }

  /** Keyboard orbit: small steps, owned by the user. */
  nudge(dAz: number, dEl: number, dZoom = 1): void {
    this.arbiter.userInput('user_keyboard'); this.cancel();
    const off = this.camera.position.clone().sub(this.controls.target);
    const r = off.length() * dZoom;
    const az = Math.atan2(-off.z, off.x) + dAz, el = Math.max(0.03, Math.min(1.45, Math.asin(off.y / off.length()) + dEl));
    this.camera.position.copy(this.positionFor({ target: this.controls.target, azimuth: az, elevation: el, distance: Math.max(this.controls.minDistance, Math.min(this.controls.maxDistance, r)) }));
    this.controls.update(); this.arbiter.userRelease(); this.requestRender();
  }

  dispose(): void { this.cancel(); this.controls.dispose(); }
}
