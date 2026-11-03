import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EXCAVATOR_ASSEMBLY_V1 as A } from '../../../src/living/contracts/fixtures/excavator.assembly.v1';
import { createExcavatorProvider } from '../../../src/living/visual-foundry/provider';
import { ACCENT_ZONES, FOLD_ORANGE, PREMIUM_PALETTE, PREMIUM_STUDIO, applyPremiumLook, premiumLookOf } from '../../../src/living/visual-foundry/premium-look';
import { MATERIAL_KEYS } from '../../../src/living/visual-foundry/materials';

const meshes = (root: THREE.Object3D) => { const out: THREE.Mesh[] = []; root.traverse((o) => { if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh); }); return out; };
const fingerprint = (root: THREE.Object3D) => meshes(root).map((m) => `${m.name}|${m.userData.partId ?? ''}|${m.userData.displayOnly ?? ''}|${m.geometry.uuid}|${m.matrix.elements.join(',')}|${m.parent?.name ?? ''}`).join('\n');
const luminance = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

describe('premium look: reversible, material-only', () => {
  const p = createExcavatorProvider(A);
  const before = fingerprint(p.root); const originals = new Map(meshes(p.root).map((m) => [m, m.material]));
  it('changes materials only: names, ids, geometry, transforms, hierarchy and displayOnly flags are identical', () => {
    const h = applyPremiumLook(p.root);
    expect(fingerprint(p.root)).toBe(before); expect([...p.parts.keys()].sort()).toEqual(A.parts.map((x) => x.id).sort());
    for (const m of meshes(p.root)) expect(m.material).not.toBe(originals.get(m));
    h.revert();
  });
  it('clones keep the Foundry material key (so isFoundryMaterial and every key-based lookup still work) and share the textures', () => {
    const h = applyPremiumLook(p.root);
    for (const m of meshes(p.root)) { const o = originals.get(m) as THREE.MeshPhysicalMaterial; const c = m.material as THREE.MeshPhysicalMaterial; expect(c.userData.materialKey).toBe(o.userData.materialKey); expect(c.userData.premiumLook).toBe('unfold.premium-look'); expect(c.roughnessMap).toBe(o.roughnessMap); expect(c.map).toBe(o.map); }
    h.revert();
  });
  it('reverting restores the very same material objects and disposes only the clones', () => {
    let originalsDisposed = 0; for (const o of new Set(originals.values())) (o as THREE.Material).addEventListener('dispose', () => { originalsDisposed += 1; });
    const h = applyPremiumLook(p.root); let clonesDisposed = 0; for (const c of h.materials) c.addEventListener('dispose', () => { clonesDisposed += 1; });
    h.revert(); h.revert();
    for (const m of meshes(p.root)) expect(m.material).toBe(originals.get(m));
    expect(clonesDisposed).toBe(h.materials.length); expect(originalsDisposed).toBe(0); expect(h.active).toBe(false); expect(premiumLookOf(p.root)).toBeUndefined();
  });
  it('applying again replaces the previous application: no accumulation over 20 profile switches', () => {
    let live = 0; const count = (h: { materials: readonly THREE.Material[] }) => { live += h.materials.length; for (const c of h.materials) c.addEventListener('dispose', () => { live -= 1; }); };
    let first = 0;
    for (let i = 0; i < 20; i += 1) { const h = applyPremiumLook(p.root); count(h); if (i === 0) first = h.materials.length; if (i % 2) h.revert(); }
    applyPremiumLook(p.root).revert();
    expect(live).toBe(0); expect(first).toBeGreaterThan(10);
    for (const m of meshes(p.root)) expect(m.material).toBe(originals.get(m));
  });
  it('the clone count is one per material key in use plus one per accent zone: bounded, not per mesh', () => {
    const h = applyPremiumLook(p.root); expect(h.materials.length).toBeLessThanOrEqual(MATERIAL_KEYS.length + ACCENT_ZONES.length); h.revert();
  });
  it('every declared accent zone matches a real Foundry mesh (so a change in the Foundry that renames one is caught)', () => {
    const names = new Set(meshes(p.root).map((m) => m.name)); for (const z of ACCENT_ZONES) expect(names.has(z.mesh)).toBe(true);
    const h = applyPremiumLook(p.root); expect(new Set(h.accentZones)).toEqual(new Set(ACCENT_ZONES.map((z) => z.id))); h.revert();
  });
  it('the accent shader patch is applied to zone materials only, and compiles into a position-based mask', () => {
    const h = applyPremiumLook(p.root); const patched = h.materials.filter((m) => m.userData.accentZone);
    expect(patched.length).toBe(ACCENT_ZONES.length); for (const m of h.materials.filter((x) => !x.userData.accentZone)) expect(m.onBeforeCompile.toString()).not.toContain('accentColor');
    const shader = { uniforms: {} as Record<string, { value: unknown }>, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>' };
    patched[0]!.onBeforeCompile(shader as never, null as never);
    expect(shader.vertexShader).toContain('vAccentPos = position'); expect(shader.fragmentShader).toContain('mix(diffuseColor.rgb, accentColor'); expect(Object.keys(shader.uniforms)).toEqual(expect.arrayContaining(['accentColor', 'accentMin', 'accentMax']));
    expect(new Set(patched.map((m) => m.customProgramCacheKey())).size).toBe(patched.length); h.revert();
  });
  it('hoses and canonical parts keep their roles: displayOnly meshes get the rubber finish, part meshes keep their part id', () => {
    const h = applyPremiumLook(p.root);
    for (const m of meshes(p.root)) { if (m.userData.displayOnly) expect((m.material as THREE.Material).userData.materialKey).toBe('rubber'); }
    expect(meshes(p.root).filter((m) => m.userData.partId).length).toBeGreaterThan(40); h.revert();
  });
  it('does not touch meshes that are not Foundry materials', () => {
    const root = new THREE.Group(); const foreign = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()); root.add(foreign); const m0 = foreign.material;
    const h = applyPremiumLook(root); expect(foreign.material).toBe(m0); expect(h.materials).toHaveLength(0); h.revert();
  });
});

describe('premium palette and studio data', () => {
  it('graphite is the dominant paint, with steel, chrome, rubber and dark glass as supporting finishes', () => {
    const lum = (k: keyof typeof PREMIUM_PALETTE) => luminance(new THREE.Color().setStyle(PREMIUM_PALETTE[k].color, THREE.SRGBColorSpace));
    expect(lum('paint')).toBeLessThan(0.05); expect(lum('paintDark')).toBeLessThan(0.03); expect(lum('rubber')).toBeLessThan(0.01); expect(lum('glass')).toBeLessThan(0.02);
    expect(PREMIUM_PALETTE.chrome.roughness!).toBeLessThan(0.06); expect(PREMIUM_PALETTE.chrome.metalness).toBe(1); expect(PREMIUM_PALETTE.glass.opacity!).toBeLessThan(1);
  });
  it('the accent is the UNFOLD fold token and is restricted to a few functional zones', () => {
    expect(FOLD_ORANGE).toBe('#FF5A1F'); expect(ACCENT_ZONES.length).toBeLessThanOrEqual(5);
  });
  it('the studio set is plain data: HDR panels above 1, absorbers black, key/rim/kick lights, and nothing here is a scene object', () => {
    const panels = PREMIUM_STUDIO.environment; expect(panels.filter((e) => e.kind === 'panel' && e.radiance > 1).length).toBeGreaterThanOrEqual(8);
    expect(panels.filter((e) => e.kind === 'absorber').every((e) => e.color === '#000000')).toBe(true);
    expect(Object.keys(PREMIUM_STUDIO.lights)).toEqual(expect.arrayContaining(['key', 'rim', 'kick', 'fill', 'floorPool']));
  });
});
