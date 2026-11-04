import { describe, expect, it } from 'vitest';
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import { cueToViewSpec, establishingView, viewForBox } from '../src/living/spatial-presentation/cues';
import { safeViewOffset } from '../src/living/workspace-design/framing';
import type { ViewContext } from '../src/living/spatial-presentation/types';

const ctx: ViewContext = { viewport: { width: 1440, height: 900 }, insets: { top: 80, right: 330, bottom: 120, left: 80 }, baseFovDeg: 30 };
const box = (s: number) => new Box3(new Vector3(-s, 0, -s * 0.4), new Vector3(s, s * 3, s * 0.4));

/** Project the 8 corners with the workspace camera model (safe view offset) and report whether all land inside the usable area. */
function inside(view: ReturnType<typeof viewForBox>, b: Box3, c: ViewContext): boolean {
  const o = safeViewOffset(c.viewport, c.insets, c.baseFovDeg), cam = new PerspectiveCamera(o.fov, o.aspect, 0.01, 1e6);
  cam.setViewOffset(o.fullWidth, o.fullHeight, o.offsetX, o.offsetY, o.width, o.height); cam.updateProjectionMatrix();
  const az = (view.azimuthDeg * Math.PI) / 180, el = (view.elevationDeg * Math.PI) / 180, target = new Vector3(...view.target);
  cam.position.set(target.x + view.distance * Math.cos(el) * Math.cos(az), target.y + view.distance * Math.sin(el), target.z - view.distance * Math.cos(el) * Math.sin(az)); cam.lookAt(target); cam.updateMatrixWorld();
  for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
    const p = new Vector3(x, y, z).project(cam), px = (p.x * 0.5 + 0.5) * c.viewport.width, py = (-p.y * 0.5 + 0.5) * c.viewport.height;
    if (px < c.insets.left - 1 || px > c.viewport.width - c.insets.right + 1 || py < c.insets.top - 1 || py > c.viewport.height - c.insets.bottom + 1) return false;
  }
  return true;
}

describe('camera cue maths', () => {
  it('fits the whole box inside the usable area, whatever the scale', () => {
    for (const s of [0.003, 1, 400]) { const b = box(s), view = viewForBox(b, { azimuthDeg: 38, elevationDeg: 14, ctx }); expect(inside(view, b, ctx), `scale ${s}`).toBe(true); }
  });

  it('distance is proportional to the object (10x bigger, 10x farther)', () => {
    const a = viewForBox(box(1), { azimuthDeg: 38, elevationDeg: 14, ctx }), b = viewForBox(box(10), { azimuthDeg: 38, elevationDeg: 14, ctx });
    expect(b.distance / a.distance).toBeGreaterThan(9.5); expect(b.distance / a.distance).toBeLessThan(10.5);
  });

  it('uses the workspace director convention: Cinema azimuth 38 becomes -38', () => {
    expect(viewForBox(box(1), { azimuthDeg: 38, elevationDeg: 14, ctx }).azimuthDeg).toBeCloseTo(-38, 6);
  });

  it('adapts to a different usable area (narrow phone, closed panels)', () => {
    const phone: ViewContext = { viewport: { width: 390, height: 780 }, insets: { top: 60, right: 0, bottom: 140, left: 0 }, baseFovDeg: 30 };
    for (const c of [phone, { ...ctx, insets: { top: 0, right: 0, bottom: 0, left: 0 } }]) { const b = box(2), view = viewForBox(b, { azimuthDeg: 128, elevationDeg: 10, ctx: c }); expect(inside(view, b, c)).toBe(true); }
  });

  it('establishing view is farther and higher than the hero view of the same box', () => {
    const hero = viewForBox(box(1), { azimuthDeg: 38, elevationDeg: 14, ctx }), establish = establishingView(box(1), 38, ctx);
    expect(establish.distance).toBeGreaterThan(hero.distance); expect(establish.elevationDeg).toBeGreaterThan(hero.elevationDeg);
  });

  it('turns a cue into the workspace ViewSpec (Vector3, radians)', () => {
    const view = viewForBox(box(1), { azimuthDeg: 38, elevationDeg: 14, ctx }), spec = cueToViewSpec({ id: 'x', kind: 'poi', reason: 'r', view, durationMs: 100, componentId: null, interruptible: true });
    expect(spec.target).toBeInstanceOf(Vector3); expect(spec.azimuth).toBeCloseTo((view.azimuthDeg * Math.PI) / 180, 9); expect(spec.elevation).toBeCloseTo((14 * Math.PI) / 180, 9); expect(spec.distance).toBe(view.distance);
  });

  it('refuses an empty box instead of producing NaN', () => {
    expect(() => viewForBox(new Box3(), { azimuthDeg: 0, elevationDeg: 10, ctx })).toThrow('SPATIAL_PRESENTATION_EMPTY_BOX');
  });
});
