import { describe, expect, it } from 'vitest';
import { Mesh } from 'three';
import { ProductGeometry, productGeometryRequests } from '../src/living/spatial-space/product-geometry';
import { createInlineWorker } from '../src/universal-spatial/fidelity/continuous-service';
import { lungsLikeReply, microscopeLikeReply } from './fixtures/spatial-v2/handauthored';
import { PlanSpaceLayer } from '../src/living/spatial-space/layer';

const host = () => ({ changed() {}, redraw() {}, notify() {}, syncLost() {} });
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('product geometry policy', () => {
  it('does not route simple cylinders and boxes as a fidelity claim', () => {
    const plan = microscopeLikeReply().plan; const request = productGeometryRequests(plan);
    expect(request.eyepiece).toBe('procedural_v2'); expect(request.base).toBe('procedural_v2');
    const source = lungsLikeReply().plan.components.find(c => c.geometry.type === 'group' && c.geometry.children.some(n => n.type === 'shape' && n.operator === 'tube'))!;
    const tube = source.geometry.type === 'group' ? source.geometry.children.find(n => n.type === 'shape' && n.operator === 'tube')! : source.geometry;
    const eligible = { ...source, geometry: { ...tube, repeat: null } };
    expect(productGeometryRequests({ ...plan, components: [eligible] })[eligible.id]).toBe('continuous_surface');
    expect(productGeometryRequests({ ...plan, components: Array.from({ length: 33 }, (_, i) => ({ ...eligible, id: `part-${i}` })) })['part-0']).toBe('procedural_v2');
  });
  it('starts in V2, upgrades eligible geometry without changing selection or plan, and disposes', async () => {
    const original = lungsLikeReply().plan;
    const source = original.components.find(c => c.geometry.type === 'group' && c.geometry.children.some(n => n.type === 'shape' && n.operator === 'tube'))!;
    const tube = source.geometry.type === 'group' ? source.geometry.children.find(n => n.type === 'shape' && n.operator === 'tube')! : source.geometry;
    const plan = { ...original, components: [{ ...source, parentId: null, geometry: { ...tube, repeat: null } }], relations: [], constraints: [] };
    const geometry = new ProductGeometry(() => createInlineWorker()); const layer = new PlanSpaceLayer(plan, host(), geometry.compile);
    geometry.attach(() => layer.upgradeGeometry(12000)); layer.highlight(source.id);
    const firstVersion = layer.explanationVersion;
    expect(layer.geometryReport?.decisions[0]?.used).toBe('procedural_v2');
    for (let i = 0; i < 100 && layer.geometryReport?.pending.length; i++) await wait(10);
    expect(layer.geometryReport?.pending).toEqual([]);
    expect(layer.geometryReport?.decisions[0]?.used).toBe('continuous_surface');
    expect(layer.selectedId).toBe(source.id); expect(layer.currentPlan).toEqual(plan); expect(layer.explanationVersion).toBeGreaterThan(firstVersion);
    const ids: string[] = []; layer.root.traverse(o => { if (o instanceof Mesh) ids.push(o.userData.spatialEntityId); }); expect(ids).toContain(source.id);
    layer.dispose(); geometry.dispose(); geometry.dispose();
  });
  it('falls back when worker creation fails and without worker support', async () => {
    const original = lungsLikeReply().plan;
    const source = original.components.find(c => c.geometry.type === 'group' && c.geometry.children.some(n => n.type === 'shape' && n.operator === 'tube'))!;
    const tube = source.geometry.type === 'group' ? source.geometry.children.find(n => n.type === 'shape' && n.operator === 'tube')! : source.geometry;
    const plan = { ...original, components: [{ ...source, parentId: null, geometry: { ...tube, repeat: null } }], relations: [], constraints: [] };
    const geometry = new ProductGeometry(() => { throw new Error('worker blocked'); }); const layer = new PlanSpaceLayer(plan, host(), geometry.compile); geometry.attach(() => layer.upgradeGeometry());
    await wait(10); expect(layer.geometryReport?.decisions[0]).toMatchObject({ used: 'procedural_v2', fallback: { code: 'WORKER_ERROR' } });
    layer.dispose(); geometry.dispose();
    const unavailable = new ProductGeometry(null); const compiled = unavailable.compile(plan); expect(compiled.stats.componentCount).toBe(1); expect(unavailable.report()).toBeNull(); unavailable.dispose();
  });
});
