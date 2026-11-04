import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Vector2 } from 'three';
import { ANATOMY_COMPONENTS } from '../src/anatomy/contracts';
import { AtlasSpaceLayer, ATLAS_NOTICE } from '../src/living/spatial-space/atlas-layer';

const buffer = () => { const b = readFileSync('public/anatomy/heart.glb'); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };

describe('AtlasSpaceLayer (Anatomy as a provider of Space)', () => {
  it('loads exactly the 11 reviewed structures, with labels, framing boxes and picking', async () => {
    const host = { redraw: vi.fn(), changed: vi.fn() }, layer = await AtlasSpaceLayer.fromBuffer(host, buffer());
    expect(layer.structureCount).toBe(11);
    for (const id of ANATOMY_COMPONENTS) { expect(layer.has(id), id).toBe(true); expect(layer.describe(id)?.label).toBeTruthy(); expect(layer.box(id)).not.toBeNull(); }
    expect(layer.has('liver')).toBe(false);
    const whole = layer.box()!, size = whole.getSize(whole.max.clone());
    expect(Math.max(size.x, size.y, size.z)).toBeCloseTo(5, 3);
    const camera = new PerspectiveCamera(30, 1, 0.1, 100); const c = whole.getCenter(whole.max.clone()); camera.position.set(c.x, c.y, c.z + 14); camera.lookAt(c); camera.updateMatrixWorld(true);
    const hit = layer.pick(new Vector2(0, 0), camera); expect(ANATOMY_COMPONENTS as readonly string[]).toContain(hit);
    layer.dispose();
  });
  it('isolates, explodes and restores without changing the model, and says the exploded view is only a visualisation', async () => {
    const host = { redraw: vi.fn(), changed: vi.fn() }, layer = await AtlasSpaceLayer.fromBuffer(host, buffer());
    const positions = () => [...ANATOMY_COMPONENTS].map((id) => layer.box(id)!.getCenter(layer.box()!.max.clone()).toArray());
    const before = positions();
    layer.setExploded(true, true); expect(positions()).not.toEqual(before); expect(layer.presentationNotice).toMatch(/visual/i); expect(host.changed).toHaveBeenCalled();
    layer.setExploded(false, true); expect(positions()).toEqual(before); expect(layer.presentationNotice).toBeNull();
    layer.isolate('left-ventricle'); expect(layer.isolatedId).toBe('left-ventricle');
    layer.isolate(null); layer.dispose();
  });
  it('the inspector never presents the atlas as a reconstruction or as clinical', async () => {
    const layer = await AtlasSpaceLayer.fromBuffer({ redraw: vi.fn() }, buffer());
    expect(ATLAS_NOTICE.text).toMatch(/educativo/); expect(ATLAS_NOTICE.text).toMatch(/não é clínico/); expect(ATLAS_NOTICE.detail).toMatch(/CC BY 4\.0/);
    layer.dispose();
  });
});
