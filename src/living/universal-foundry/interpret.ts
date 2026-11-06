/**
 * SpatialPlanV2 (+ optional image evidence) -> object classification -> VisualRecipe. Everything the plan states is `plan`; everything read from the picture is
 * `evidence`; every generator choice the plan does not carry (archetype defaults, detail parameters) is `inferred`. Nothing here invents a verified dimension: sizes
 * come from the plan's own bounds, proportions are relative.
 */
import { Box3, Matrix4, Vector3 } from 'three';
import type { GeometryNodeV2, SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import { CATEGORIES, shade, withParams, type Category, type Known, type ParamValue, type PartRecipe, type Palette, type VisualRecipe } from './recipe';
import type { Family, Facts, PartContext } from './families/types';
import { mat } from './materials';
import { rng } from './ops';
import { saturation, type ImageEvidence } from './evidence';
import { vehicleFamily } from './families/vehicle';
import { furnitureFamily } from './families/furniture';
import { FAMILY_LIST } from './families/registry';

export { vehicleFamily, furnitureFamily };
export const familyFor = (category: Category): Family | undefined => FAMILY_LIST.find((f) => f.category === category);

const shapesOf = (node: GeometryNodeV2): Array<Extract<GeometryNodeV2, { type: 'shape' }>> => (node.type === 'shape' ? [node] : node.children.flatMap(shapesOf));
const words = (c: SpatialPlanV2["components"][number]) => `${c.label} ${c.id}`.toLowerCase();

export type Interpretation = { recipe: VisualRecipe; family: Family; roles: Map<string, string> };
export type InterpretOptions = { seed?: number; overrides?: Record<string, ParamValue>; evidence?: ImageEvidence | null; forceCategory?: Category; maxTriangles?: number };

/** Scores every family by how much of the plan's vocabulary (title x3, component labels, hints from the preset profile) it recognises. */
export function classify(plan: SpatialPlanV2): Array<{ category: Category; score: number }> {
  const scores = FAMILY_LIST.map((f) => {
    let s = f.keywords.test(plan.title) ? 3 : 0;
    for (const c of plan.components) if (f.keywords.test(c.label)) s += 1;
    if (f.category === 'organic' && plan.presentationProfile === 'organic') s += 1;
    return { category: f.category, score: s };
  });
  return scores.sort((a, b) => b.score - a.score);
}

function paletteOf(plan: SpatialPlanV2, evidence: ImageEvidence | null | undefined, sizes: Map<string, number>): { palette: Palette; known: Known } {
  const tally = new Map<string, number>();
  for (const c of plan.components) for (const s of shapesOf(c.geometry)) { if (s.material.profile === 'glass') continue; tally.set(s.material.color.toLowerCase(), (tally.get(s.material.color.toLowerCase()) ?? 0) + (sizes.get(c.id) ?? 1)); }
  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  let primary = ranked[0] ?? '#9AA0A6', known: Known = ranked.length ? 'plan' : 'inferred';
  // the picture decides the body colour when it shows a clearly coloured subject: evidence outranks the plan's placeholder colour but never rewrites the plan
  const dominant = evidence?.colours.find((c) => saturation(c.hex) > 0.18 && c.share > 0.12) ?? evidence?.colours[0];
  if (dominant && evidence && evidence.foregroundRatio > 0.02) { primary = dominant.hex; known = 'evidence'; }
  return { palette: { primary, secondary: ranked.find((c) => c !== primary) ?? shade(primary, -0.35), accent: ranked[2] ?? shade(primary, 0.3), glass: '#3A4A57' }, known };
}

export function interpret(plan: SpatialPlanV2, size: Vector3, partSizes: Map<string, number>, options: InterpretOptions = {}): Interpretation | null {
  const ranking = classify(plan), chosen = options.forceCategory ?? ranking[0]?.category, top = ranking.find((r) => r.category === chosen);
  const family = chosen ? familyFor(chosen) : undefined;
  if (!family || (!options.forceCategory && (!top || top.score <= 0))) return null;
  const text = `${plan.title} ${plan.components.map((c) => c.label).join(' ')}`.toLowerCase(), roles = new Map<string, string>(), counts: Record<string, number> = {};
  for (const c of plan.components) { const w = words(c), hit = family.roles.find((r) => r.words.test(w)); const role = hit?.role ?? 'generic'; roles.set(c.id, role); counts[role] = (counts[role] ?? 0) + 1; }
  const dims = Math.max(size.x, size.y, size.z) || 1;
  const facts: Facts = { counts, size: size.clone(), words: text, components: plan.components.length, mostly: { rounded: plan.components.filter((c) => shapesOf(c.geometry).some((s) => ['sphere', 'ellipsoid', 'cylinder', 'torus'].includes(s.operator))).length, boxy: plan.components.filter((c) => shapesOf(c.geometry).some((s) => ['box', 'rounded_box'].includes(s.operator))).length } };
  const archetype = family.archetypeOf(text, facts), paramSpec = family.params(archetype, facts);
  const base = Object.fromEntries(paramSpec.map((p) => [p.key, p.default] as const));
  const { palette, known } = paletteOf(plan, options.evidence, partSizes);
  const recipe0: VisualRecipe = {
    version: 1, category: family.category, archetype, seed: options.seed ?? 1, confidence: Math.min(1, (top?.score ?? 1) / Math.max(3, plan.components.length * 0.8)),
    alternatives: ranking.filter((r) => r.score > 0 && r.category !== family.category).slice(0, 3), proportions: { length: Math.max(size.x, size.z) / dims, width: Math.min(size.x, size.z) / dims, height: size.y / dims, known: 'plan' },
    palette, paletteKnown: known, params: base, paramSpec,
    parts: plan.components.map((c): PartRecipe => {
      const role = roles.get(c.id)!, spec = family.materialOf(role, palette, base);
      return { componentId: c.id, label: c.label, role, roleKnown: role === 'generic' ? 'unknown' : 'plan', material: { ...spec, semantic: spec.kind }, symmetry: null, repeat: null, articulation: null, style: family.style(role, facts, size), details: family.detailRules(role) };
    }),
    detailBudget: { maxTriangles: options.maxTriangles ?? 220_000, lod: 1 },
    unknowns: [...plan.unknowns, ...(counts.generic ? [`${counts.generic} component(s) have no recognised ${family.category} role: drawn as a plain rounded solid (inferred)`] : []), 'surface detail beyond the plan (seams, fasteners, trims) is inferred from the component roles, not read from the picture'],
    evidence: options.evidence ? { used: true, summary: `foreground ${(options.evidence.foregroundRatio * 100).toFixed(0)}%, aspect ${options.evidence.aspect.toFixed(2)}, symmetry ${options.evidence.symmetry.toFixed(2)}, ${options.evidence.colours.length} dominant colours` } : { used: false, summary: 'no image evidence supplied' },
  };
  void CATEGORIES; void mat; void rng;
  return { recipe: options.overrides ? withParams(recipe0, options.overrides) : recipe0, family, roles };
}

/** Bounds of a compiled component, in its own local frame and in the shared object frame. */
export function boundsOf(group: import('three').Object3D, content: import('three').Object3D): { local: Box3; world: Box3 } {
  group.updateWorldMatrix(true, false);
  const world = new Box3().setFromObject(group, true);
  const p = group.position.clone(), q = group.quaternion.clone(), s = group.scale.clone(); group.position.set(0, 0, 0); group.quaternion.identity(); group.scale.set(1, 1, 1); group.updateMatrix(); group.updateMatrixWorld(true);
  const local = new Box3().setFromObject(content, true); group.position.copy(p); group.quaternion.copy(q); group.scale.copy(s); group.updateMatrix(); group.updateMatrixWorld(true);
  return { local, world };
}
export const context = (id: string, label: string, role: string, part: PartRecipe, local: Box3, world: Box3, toLocal: Matrix4, objectSize: Vector3, recipe: VisualRecipe, siblings: PartContext['siblings'], rnd: () => number, lod: PartContext['lod']): PartContext => ({
  id, label, role, part, min: local.min.clone(), max: local.max.clone(), size: local.getSize(new Vector3()), centre: local.getCenter(new Vector3()), worldBox: world.clone(), toLocal, objectSize, unit: Math.max(0.01, Math.max(objectSize.x, objectSize.y, objectSize.z) / 20),
  params: recipe.params, archetype: recipe.archetype, palette: recipe.palette, rnd, lod, siblings,
});
