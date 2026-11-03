/**
 * Camera framing that respects the interface: the projection centre is moved to the middle of the usable area
 * (viewport minus rail, composer, open panels) with a view offset, keeping the pixel scale of the base field of view.
 * Pure maths, so it is tested without a GPU.
 */
import { Box3, PerspectiveCamera, Vector3 } from 'three';
import type { SafeInsets, Viewport } from './digital-hand';

export type ViewOffset = { fullWidth: number; fullHeight: number; offsetX: number; offsetY: number; width: number; height: number; fov: number; aspect: number };

export function safeViewOffset(viewport: Viewport, insets: SafeInsets, baseFovDeg: number): ViewOffset {
  const W = Math.max(1, viewport.width), H = Math.max(1, viewport.height);
  const cx = (insets.left + W - insets.right) / 2, cy = (insets.top + H - insets.bottom) / 2;
  const fullWidth = 2 * Math.max(cx, W - cx), fullHeight = 2 * Math.max(cy, H - cy);
  const offsetX = fullWidth / 2 - cx, offsetY = fullHeight / 2 - cy;
  // same pixels per radian as an un-offset camera of baseFov over H
  const fov = (2 * Math.atan(Math.tan((baseFovDeg * Math.PI) / 360) * (fullHeight / H)) * 180) / Math.PI;
  return { fullWidth, fullHeight, offsetX, offsetY, width: W, height: H, fov, aspect: fullWidth / fullHeight };
}

/** Distance at which a sphere of `radius` fills `fill` of the smaller side of the usable area. */
export function fitDistance(radius: number, viewport: Viewport, insets: SafeInsets, baseFovDeg: number, fill = 0.86): number {
  const sw = Math.max(40, viewport.width - insets.left - insets.right), sh = Math.max(40, viewport.height - insets.top - insets.bottom);
  const t = Math.tan((baseFovDeg * Math.PI) / 360);
  const byHeight = (radius * viewport.height) / (sh * fill * t);
  const byWidth = (radius * viewport.height) / (sw * fill * t);
  return Math.max(byHeight, byWidth);
}

/** Centre of the usable area in CSS pixels. */
export const safeCentre = (viewport: Viewport, insets: SafeInsets) => ({ x: (insets.left + viewport.width - insets.right) / 2, y: (insets.top + viewport.height - insets.bottom) / 2 });

/**
 * Distance along a viewing direction at which every corner of `box` projects inside the usable area (with `margin`
 * pixels to spare), for a camera that uses `safeViewOffset`. Binary search on a scratch camera; no GPU.
 */
export function fitBoxDistance(box: Box3, target: Vector3, azimuth: number, elevation: number, viewport: Viewport, insets: SafeInsets, baseFovDeg: number, margin = 24): number {
  const o = safeViewOffset(viewport, insets, baseFovDeg);
  const cam = new PerspectiveCamera(o.fov, o.aspect, 0.05, 1000);
  cam.setViewOffset(o.fullWidth, o.fullHeight, o.offsetX, o.offsetY, o.width, o.height);
  cam.updateProjectionMatrix();
  const dir = new Vector3(Math.cos(elevation) * Math.cos(azimuth), Math.sin(elevation), -Math.cos(elevation) * Math.sin(azimuth));
  const corners: Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new Vector3(x, y, z));
  const fits = (d: number) => {
    cam.position.copy(target).addScaledVector(dir, d); cam.lookAt(target); cam.updateMatrixWorld();
    return corners.every((c) => {
      const p = c.clone().project(cam);
      if (p.z > 1 || p.z < -1) return false;
      const x = (p.x * 0.5 + 0.5) * viewport.width, y = (-p.y * 0.5 + 0.5) * viewport.height;
      return x >= insets.left + margin && x <= viewport.width - insets.right - margin && y >= insets.top + margin && y <= viewport.height - insets.bottom - margin;
    });
  };
  let lo = 0.5, hi = 400;
  if (!fits(hi)) return hi;
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
  return hi;
}
