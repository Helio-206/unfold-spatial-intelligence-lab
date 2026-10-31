import { Box3, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { createFitCameraView, createFocusCameraView } from '../src/four-bar-lab-camera';

const bounds = new Box3(new Vector3(-2, 0, -1), new Vector3(4, 1, 3));

describe('Four-Bar Lab intelligent camera views', () => {
  it('fits the complete geometry around its measured centre with a positive margin', () => {
    const view = createFitCameraView(bounds, 42);
    const center = bounds.getCenter(new Vector3());

    expect(view.target.distanceTo(center)).toBeCloseTo(0);
    expect(view.position.distanceTo(center)).toBeGreaterThan(4);
  });

  it('focuses a selected component while preserving the current viewing direction', () => {
    const view = createFocusCameraView(new Box3(new Vector3(0, 0, 0), new Vector3(1, 0.4, 2)), 42, new Vector3(5, 4, 5), new Vector3(0, 0, 0));
    const expectedTarget = new Vector3(0.5, 0.2, 1);

    expect(view.target.distanceTo(expectedTarget)).toBeCloseTo(0);
    expect(view.position.distanceTo(view.target)).toBeGreaterThanOrEqual(2.4);
    expect(view.position.distanceTo(view.target)).toBeLessThanOrEqual(8);
  });

  it('increases the fit distance for a narrow viewport so horizontal bounds remain visible', () => {
    const desktop = createFitCameraView(bounds, 42, undefined, 16 / 9);
    const mobile = createFitCameraView(bounds, 42, undefined, 390 / 844);

    expect(mobile.position.distanceTo(mobile.target)).toBeGreaterThan(desktop.position.distanceTo(desktop.target));
  });
});
