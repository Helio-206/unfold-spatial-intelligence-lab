import { describe, expect, it } from 'vitest';
import { Mesh, type BufferGeometry, type Material, type Texture } from 'three';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../../src/living/contracts/fixtures/excavator.assembly.v1';
import { validateMotionFrame } from '../../../src/living/contracts';
import { buildComponentRegistry } from '../../../src/living/visual-foundry/component-registry';
import { buildExcavator } from '../../../src/living/visual-foundry/excavator/build';
import { createMaterialLibrary, finishPixels, PRESETS } from '../../../src/living/visual-foundry/materials';
import { engineSource, framePoses, loadFixturePreview, referencePoses } from '../../../src/living/visual-foundry/poses';
import { neutralToneMap, untonemap } from '../../../src/living/visual-foundry/studio';
import { Color, SRGBColorSpace } from 'three';

/** Real-time budget for the flagship model. A regression above these fails the suite. */
const BUDGET = { triangles: 300_000, meshes: 90, materials: 12, textures: 10, buildMs: 4000 };

describe('canonical component registry', () => {
  const registry = buildComponentRegistry(EXCAVATOR_ASSEMBLY_V1);
  it('has every part, every actuator and every revolute joint, with stable ids', () => {
    for (const p of EXCAVATOR_ASSEMBLY_V1.parts) expect(registry.get(p.id)?.kind).toBe('part');
    for (const a of EXCAVATOR_ASSEMBLY_V1.actuators) expect(registry.get(a.id)?.kind).toBe('actuator');
    expect(registry.get('boom_cylinder')?.partIds).toEqual(['boom_cyl_barrel', 'boom_cyl_rod']);
    expect(registry.ownerOfPart('boom_cyl_rod')?.id).toBe('boom_cylinder');
    expect(registry.ownerOfPart('boom')?.id).toBe('boom');
  });
  it('keeps provenance as recorded: fixture / unreviewed, with the source evidence', () => {
    for (const c of registry.all()) { expect(c.origin).toBe('fixture'); expect(c.validation).toBe('unreviewed'); }
    expect(registry.get('boom_cylinder')!.evidence[0]!.sourceId).toBe('src-excavator-fixture');
  });
  it('matches labels exactly, ignoring case and diacritics', () => {
    expect(registry.byLabel('cacamba').map((c) => c.id)).toEqual(['bucket']);
    expect(registry.byLabel('Cilindro')).toEqual([]);
  });
});

describe('excavator display model', () => {
  const t0 = performance.now();
  const lib = createMaterialLibrary();
  const model = buildExcavator(EXCAVATOR_ASSEMBLY_V1, lib);
  const buildMs = performance.now() - t0;
  const meshes: Mesh[] = [];
  model.root.traverse((o) => { if ((o as Mesh).isMesh) meshes.push(o as Mesh); });

  it('has a group for every canonical part and no anonymous geometry', () => {
    for (const p of EXCAVATOR_ASSEMBLY_V1.parts) { const g = model.parts.get(p.id); expect(g?.userData.partId).toBe(p.id); expect(g!.children.length).toBeGreaterThan(0); }
    for (const m of meshes) expect(typeof m.userData.partId === 'string' || m.userData.displayOnly === true).toBe(true);
  });

  it('applies canonical poses exactly and reports unknown ids instead of inventing them', () => {
    const ref = referencePoses();
    const r = model.applyPoses([...ref.poses, { partId: 'ghost_part', translationM: [0, 0, 0], rotation: [0, 0, 0, 1] }]);
    expect(r.unknown).toEqual(['ghost_part']);
    expect(r.missing).toEqual([]);
    const boom = model.parts.get('boom')!;
    const pose = ref.poses.find((p) => p.partId === 'boom')!;
    expect(boom.position.toArray()).toEqual(pose.translationM);
    expect(boom.quaternion.toArray().map((v) => +v.toFixed(12))).toEqual(pose.rotation.map((v) => +v.toFixed(12)));
  });

  it('stays inside the real-time budget (performance regression guard)', () => {
    let tris = 0;
    for (const m of meshes) tris += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position!.count) / 3;
    const mats = new Set(meshes.map((m) => (m.material as Material).uuid));
    expect(tris).toBeLessThan(BUDGET.triangles);
    expect(meshes.length).toBeLessThan(BUDGET.meshes);
    expect(mats.size).toBeLessThanOrEqual(BUDGET.materials);
    expect(lib.textures().length).toBeLessThanOrEqual(BUDGET.textures);
    expect(buildMs).toBeLessThan(BUDGET.buildMs);
  });

  it('disposes every geometry, material and texture it created', () => {
    const geos = new Set<BufferGeometry>(meshes.map((m) => m.geometry));
    const mats = lib.materials(), texs: Texture[] = lib.textures();
    let g = 0, m = 0, t = 0;
    geos.forEach((x) => x.addEventListener('dispose', () => g++));
    mats.forEach((x) => x.addEventListener('dispose', () => m++));
    texs.forEach((x) => x.addEventListener('dispose', () => t++));
    model.dispose(); lib.dispose();
    expect(g).toBe(geos.size);
    expect(m).toBe(mats.length);
    expect(t).toBe(texs.length);
    expect(model.root.parent).toBeNull();
  });
});

describe('materials and colour management', () => {
  it('finish textures are deterministic', () => {
    expect(Buffer.from(finishPixels('brushed', 64)).equals(Buffer.from(finishPixels('brushed', 64)))).toBe(true);
  });
  it('metals are metals, dielectrics are dielectrics, rods are polished', () => {
    expect(PRESETS.chrome.metalness).toBe(1);
    expect(PRESETS.chrome.roughness).toBeLessThan(0.1);
    expect(PRESETS.paint.metalness).toBe(0);
    expect(PRESETS.rubber.roughness).toBeGreaterThan(0.7);
    expect(PRESETS.glass.transparent).toBe(true);
  });
  it('the inverse tone map makes the canvas background equal the Void surface token', () => {
    const target = new Color().setStyle('#0B0D10', SRGBColorSpace);
    const lin = untonemap(target);
    const out = neutralToneMap([lin.r, lin.g, lin.b]);
    expect(out[0]).toBeCloseTo(target.r, 4); expect(out[1]).toBeCloseTo(target.g, 4); expect(out[2]).toBeCloseTo(target.b, 4);
  });
});

describe('pose sources', () => {
  it('fixture preview frames are valid motion frames, labelled fixture, never engine output', () => {
    const p = loadFixturePreview();
    expect(p.notEngineOutput).toBe(true);
    expect(p.origin).toBe('fixture');
    for (const f of p.frames) {
      expect(validateMotionFrame(f).ok).toBe(true);
      expect(f.solver.id).toBe('visual-foundry-fixture-fk');
      expect(f.warnings.map((w) => w.code)).toContain('FIXTURE_NOT_ENGINE');
      expect(f.actuators[0]!.forceStatus).toBe('unknown');
    }
  });
  it('frame 0 reproduces the independent reference pose (cross-check)', () => {
    const f0 = framePoses(loadFixturePreview().frames[0]!), ref = referencePoses().poses;
    for (const r of ref) {
      const p = f0.find((x) => x.partId === r.partId)!;
      r.translationM.forEach((v, i) => expect(p.translationM[i]).toBeCloseTo(v, 9));
      r.rotation.forEach((v, i) => expect(p.rotation[i]).toBeCloseTo(v, 9));
    }
  });
  it('rejects a preview that is not marked as fixture', () => {
    const raw = JSON.stringify({ ...loadFixturePreview(), notEngineOutput: false });
    expect(() => loadFixturePreview(raw)).toThrow('FOUNDRY_PREVIEW_NOT_A_FIXTURE');
  });
  it('the engine source is explicitly unavailable', () => {
    expect(engineSource().status).toBe('unavailable');
  });
});
