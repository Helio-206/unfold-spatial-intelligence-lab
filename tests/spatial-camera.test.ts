import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { cameraFrameAspect, createSpatialCameraView, createSpatialFocusView } from '../src/spatial-camera';

const wideScene = new Box3(new Vector3(0, 0, -16), new Vector3(24, 2.72, 0));

describe('spatial camera views', () => {
  it('frames the unobstructed stage while falling back safely on narrow mobile layouts', () => {
    expect(cameraFrameAspect(1440, 960, { left: 374, right: 322, top: 68, bottom: 94 })).toBeCloseTo(744 / 798);
    expect(cameraFrameAspect(390, 844, { left: 300, right: 0, top: 64, bottom: 108 })).toBeCloseTo(390 / 844);
  });
  it('fits a wide architectural scene within the perspective field of view', () => {
    const view = createSpatialCameraView(wideScene, 16 / 9, 'isometric');
    const radius = wideScene.getSize(new Vector3()).length() / 2;
    const distance = view.position.distanceTo(view.target);
    expect(distance).toBeGreaterThan(radius / Math.sin(42 * Math.PI / 360));
    expect(view.position.y).toBeGreaterThan(view.target.y);
  });

  it('provides genuinely distinct top and front camera axes', () => {
    const top = createSpatialCameraView(wideScene, 16 / 9, 'top');
    const front = createSpatialCameraView(wideScene, 16 / 9, 'front');
    expect(top.position.clone().sub(top.target).normalize().toArray()).toEqual([0, 1, 0]);
    expect(top.up.toArray()).toEqual([0, 0, -1]);
    expect(front.position.x).toBeCloseTo(front.target.x);
    expect(front.position.z).toBeGreaterThan(front.target.z);
    expect(front.up.toArray()).toEqual([0, 1, 0]);
  });

  it('focuses a wall from its face normal with enough elevation to read its height', () => {
    const wall = new Box3(new Vector3(-8, 0, -0.075), new Vector3(8, 2.72, 0.075));
    const view = createSpatialFocusView(wall, 16 / 9, new Vector3(0, 0, 1));
    const direction = view.position.clone().sub(view.target).normalize();
    expect(direction.z).toBeGreaterThan(0.6);
    expect(direction.y).toBeGreaterThan(0.15);
    expect(view.position.distanceTo(view.target)).toBeGreaterThan(wall.getSize(new Vector3()).length() / 2);
  });

  it('rejects empty bounds and invalid projections', () => {
    expect(() => createSpatialCameraView(new Box3(), 1, 'isometric')).toThrow('CAMERA_BOUNDS_OR_PROJECTION_INVALID');
    expect(() => createSpatialCameraView(wideScene, 0, 'top')).toThrow('CAMERA_BOUNDS_OR_PROJECTION_INVALID');
  });
});
