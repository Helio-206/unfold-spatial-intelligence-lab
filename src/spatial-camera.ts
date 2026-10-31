import { Box3, Vector3 } from 'three';

export type SpatialCameraView = { target: Vector3; position: Vector3; up: Vector3 };

export function cameraFrameAspect(
  width: number,
  height: number,
  insets: { left?: number; right?: number; top?: number; bottom?: number } = {},
): number {
  const fallback = Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 ? width / height : 1;
  const availableWidth = width - (insets.left ?? 0) - (insets.right ?? 0);
  const availableHeight = height - (insets.top ?? 0) - (insets.bottom ?? 0);
  if (availableWidth < width * 0.4 || availableHeight < height * 0.4) return fallback;
  return availableWidth / availableHeight;
}

function fitDistance(bounds: Box3, aspect: number, fovDegrees: number, margin: number): number {
  if (bounds.isEmpty() || !Number.isFinite(aspect) || aspect <= 0 || !Number.isFinite(fovDegrees) || fovDegrees <= 0 || fovDegrees >= 179 || !Number.isFinite(margin) || margin <= 0) {
    throw new Error('CAMERA_BOUNDS_OR_PROJECTION_INVALID');
  }
  const radius = Math.max(bounds.getSize(new Vector3()).length() / 2, 0.25);
  const verticalHalfFov = fovDegrees * Math.PI / 360;
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * aspect);
  return radius * margin / Math.sin(Math.min(verticalHalfFov, horizontalHalfFov));
}

export function createSpatialCameraView(
  bounds: Box3,
  aspect: number,
  view: 'isometric' | 'top' | 'front',
  options: { fovDegrees?: number; margin?: number } = {},
): SpatialCameraView {
  const center = bounds.getCenter(new Vector3());
  const direction = view === 'top'
    ? new Vector3(0, 1, 0)
    : view === 'front'
      ? new Vector3(0, 0, 1)
      : new Vector3(1, 0.82, 1);
  const up = view === 'top' ? new Vector3(0, 0, -1) : new Vector3(0, 1, 0);
  const distance = fitDistance(bounds, aspect, options.fovDegrees ?? 42, options.margin ?? 1.2);
  return { target: center, position: center.clone().add(direction.normalize().multiplyScalar(distance)), up };
}

export function createSpatialFocusView(
  bounds: Box3,
  aspect: number,
  direction: Vector3,
  options: { fovDegrees?: number; margin?: number } = {},
): SpatialCameraView {
  const center = bounds.getCenter(new Vector3());
  const horizontal = new Vector3(direction.x, 0, direction.z);
  if (horizontal.lengthSq() < 1e-8) horizontal.set(1, 0, 1);
  const elevation = Math.max(0.25, Math.min(0.7, direction.y));
  const viewingDirection = horizontal.normalize().setY(elevation).normalize();
  const distance = fitDistance(bounds, aspect, options.fovDegrees ?? 42, options.margin ?? 1.2);
  return { target: center, position: center.clone().add(viewingDirection.multiplyScalar(distance)), up: new Vector3(0, 1, 0) };
}
