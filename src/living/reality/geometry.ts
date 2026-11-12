import { Mesh, MeshPhysicalMaterial, Group, LOD, type BufferGeometry } from 'three';
import type { SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import { compileSpatialPlanV2, type CompiledSpatialPlanV2 } from '../../universal-spatial/geometry-compiler-v2';
import { partGeometry, type PartMesh, type RealityModel } from './model';
import { buildLods } from './lod';
import { displayScale } from './plan';

/**
 * Geometry seam for reconstructed Spaces. The plan decides WHAT exists (components, ids, transforms, provenance); this draws each component's reconstructed
 * shell inside the component's own group. If the reconstruction for this plan's evidence is not available, the plan compiler's proxies stay on stage and
 * the report says so: no silent fallback to a prettier object.
 */
export const REALITY_TRIANGLE_BUDGET = 160_000;
export type RealityReport = { engine: 'reality-engine'; status: 'shells' | 'proxies_no_evidence' | 'proxies_over_budget'; sourceSha256: string; components: Array<{ id: string; drawn: 'shell' | 'proxy' | 'none'; triangles: number; observedFraction: number; /** levels of detail with their measured worst vertex displacement, % of the part's diagonal (level 0 = the shell itself) */ lod?: Array<{ level: number; triangles: number; maxDisplacementPct: number }> }>; triangles: number };

export class RealityGeometry {
  private last: RealityReport | null = null;
  private owned: Array<BufferGeometry | MeshPhysicalMaterial> = [];
  constructor(private readonly modelFor: (sourceSha256: string) => RealityModel | null) {}

  compile = (plan: SpatialPlanV2): CompiledSpatialPlanV2 => {
    const compiled = compileSpatialPlanV2(plan), model = this.modelFor(plan.source.sha256);
    this.release();
    const sha = plan.source.sha256;
    if (!model) { this.last = { engine: 'reality-engine', status: 'proxies_no_evidence', sourceSha256: sha, components: plan.components.map((c) => ({ id: c.id, drawn: 'proxy', triangles: 0, observedFraction: 0 })), triangles: 0 }; return compiled; }
    const total = model.parts.reduce((s, p) => s + p.indices.length / 3, 0);
    if (total > REALITY_TRIANGLE_BUDGET) { this.last = { engine: 'reality-engine', status: 'proxies_over_budget', sourceSha256: sha, components: plan.components.map((c) => ({ id: c.id, drawn: 'proxy', triangles: 0, observedFraction: 0 })), triangles: 0 }; return compiled; }
    const k = displayScale(model), byId = new Map<string, PartMesh>(model.parts.map((p) => [p.id, p])), groups = new Map<string, Group>();
    compiled.root.traverse((o) => { if (o.userData.spatialComponentRoot) groups.set(o.userData.spatialEntityId as string, o as Group); });
    const report: RealityReport['components'] = [];
    let drawnTriangles = 0;
    for (const component of plan.components) {
      const group = groups.get(component.id), part = byId.get(component.id);
      if (group && !part) {
        // the refined evidence no longer supports this part: nothing is drawn for it (the component stays in the plan and is reported, not deleted)
        const gone = group.children[0]!; group.remove(gone); disposeObject(gone); group.add(new Group()); group.children.splice(0, 0, group.children.pop()!);
        report.push({ id: component.id, drawn: 'none', triangles: 0, observedFraction: 0 }); continue;
      }
      if (!group || !part) { report.push({ id: component.id, drawn: 'proxy', triangles: 0, observedFraction: 0 }); continue; }
      const old = group.children[0]!, levels = buildLods(part), diag = Math.hypot(...part.size) || 1;
      // The appearance is the colour the photographs show (shading and highlights already baked in), so the surface is matte and unlit by specular terms: a glossy
      // coat would invent highlights that no photograph showed. Roughness/metalness are assumptions, declared in the material's userData, not measurements.
      const material = new MeshPhysicalMaterial({ vertexColors: true, roughness: 0.92, metalness: 0, clearcoat: 0 });
      material.name = 'reality:evidence-colour'; material.userData.realityHypothesisColour = true; material.userData.realityMaterialBasis = 'assumed-matte (no photographed reflectance)';
      const shell = new Group(); shell.userData = { ...old.userData, spatialSubcomponentKey: component.geometry.key, realityShell: true };
      const meshes = levels.map((lv) => {
        const geometry = partGeometry({ ...part, ...lv.mesh } as PartMesh), positions = geometry.getAttribute('position'); for (let i = 0; i < positions.count; i++) positions.setXYZ(i, positions.getX(i) * k, positions.getY(i) * k, positions.getZ(i) * k);
        positions.needsUpdate = true; geometry.computeBoundingSphere(); this.owned.push(geometry);
        const mesh = new Mesh(geometry, material); mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData = { spatialEntityId: component.id, spatialSubcomponentKey: component.geometry.key, realityLod: lv.level }; return mesh;
      });
      if (meshes.length === 1) shell.add(meshes[0]!);
      else { const lod = new LOD(), radius = (meshes[0]!.geometry.boundingSphere?.radius ?? 1); lod.userData = { spatialEntityId: component.id }; meshes.forEach((m, i) => lod.addLevel(m, i === 0 ? 0 : radius * 14 * i)); shell.add(lod); }
      group.remove(old); disposeObject(old); group.add(shell); group.children.splice(0, 0, group.children.pop()!);
      this.owned.push(material);
      const triangles = part.indices.length / 3; drawnTriangles += triangles;
      report.push({ id: component.id, drawn: 'shell', triangles, observedFraction: part.observedFraction, lod: levels.map((lv) => ({ level: lv.level, triangles: lv.triangles, maxDisplacementPct: +((lv.maxDisplacement / diag) * 100).toFixed(2) })) });
    }
    compiled.root.updateMatrixWorld(true);
    this.last = { engine: 'reality-engine', status: 'shells', sourceSha256: sha, components: report, triangles: drawnTriangles };
    return compiled;
  };
  attach(_onReady: () => void): void { /* shells are built synchronously from the evidence */ }
  report(): RealityReport | null { return this.last; }
  private release(): void { /* the previous compile's meshes are disposed by the layer through disposeCompiledSpatialPlan; shared materials are freed here */ for (const o of this.owned) o.dispose(); this.owned = []; }
  dispose(): void { this.release(); this.last = null; }
}

function disposeObject(o: { traverse(cb: (x: unknown) => void): void }): void {
  o.traverse((x) => { if (x instanceof Mesh) { x.geometry.dispose(); for (const m of Array.isArray(x.material) ? x.material : [x.material]) m.dispose(); } });
}
