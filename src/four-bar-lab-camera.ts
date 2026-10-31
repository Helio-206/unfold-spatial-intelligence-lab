import { Box3, Vector3 } from 'three';

export type CameraView = {
  position: Vector3;
  target: Vector3;
};

const DEFAULT_DIRECTION = new Vector3(0.92, 0.78, 1.1).normalize();

function centerOf(bounds: Box3): Vector3 {
  return bounds.getCenter(new Vector3());
}

function spanOf(bounds: Box3): number {
  const size = bounds.getSize(new Vector3());
  return Math.max(size.x, size.y, size.z, 0.4);
}

function viewDirection(position: Vector3, target: Vector3): Vector3 {
  const direction = position.clone().sub(target);
  return direction.lengthSq() > 0.0001 ? direction.normalize() : DEFAULT_DIRECTION.clone();
}

function distanceFor(span: number, fovDegrees: number, margin: number): number {
  const halfFov = (fovDegrees * Math.PI) / 360;
  return (span / (2 * Math.tan(halfFov))) * margin;
}

function distanceForAspect(span: number, fovDegrees: number, margin: number, aspect: number): number {
  const safeAspect = Math.max(aspect, 0.1);
  const verticalDistance = distanceFor(span, fovDegrees, margin);
  const horizontalFov = (2 * Math.atan(Math.tan((fovDegrees * Math.PI) / 360) * safeAspect) * 180) / Math.PI;
  return Math.max(verticalDistance, distanceFor(span, horizontalFov, margin));
}

export function createFitCameraView(bounds: Box3, fovDegrees: number, direction = DEFAULT_DIRECTION, aspect = 1): CameraView {
  const target = centerOf(bounds);
  const distance = distanceForAspect(spanOf(bounds), fovDegrees, 2.08, aspect);
  const viewDirectionValue = direction.clone().normalize();
  return { target, position: target.clone().add(viewDirectionValue.multiplyScalar(distance)) };
}

export function createFocusCameraView(bounds: Box3, fovDegrees: number, currentPosition: Vector3, currentTarget: Vector3, aspect = 1): CameraView {
  const target = centerOf(bounds);
  const distance = Math.min(Math.max(distanceForAspect(spanOf(bounds), fovDegrees, 1.8, aspect), 2.4), 8);
  return { target, position: target.clone().add(viewDirection(currentPosition, currentTarget).multiplyScalar(distance)) };
}
