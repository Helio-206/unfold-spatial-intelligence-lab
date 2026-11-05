/**
 * The Visual Recipe grammar: a typed, serialisable description of HOW an object is drawn, separate from WHAT it is (the reviewed SpatialPlanV2 stays the single source
 * of truth for components, hierarchy, relations and provenance). A recipe says which family and archetype apply, which role each plan component plays, which semantic
 * parameters drive the geometry, how materials are chosen, what repeats, what is symmetric, what articulates, and above all which parts of it are KNOWN (from the plan),
 * EVIDENCED (from the image), INFERRED (a plausible procedural hypothesis) or UNKNOWN. Generation from a recipe is deterministic for a given seed.
 */
import type { MaterialSpec } from './materials';

export const CATEGORIES = ['construction', 'vehicle', 'furniture', 'electronics', 'appliance', 'architecture', 'tool', 'organic'] as const;
export type Category = (typeof CATEGORIES)[number];
/** Where a recipe value came from. Never promoted without evidence: `inferred` stays inferred. */
export type Known = 'plan' | 'evidence' | 'inferred' | 'unknown';

export type ParamValue = number | string | boolean;
export type ParamSpec = { key: string; label: string; type: 'number' | 'choice' | 'boolean'; min?: number; max?: number; step?: number; options?: string[]; default: ParamValue; doc: string; known: Known };

export type Articulation = { kind: 'hinge' | 'slide' | 'rotate'; axis: 'x' | 'y' | 'z'; /** pivot in the part's own bounds, 0..1 per axis */ pivot: [number, number, number]; range?: [number, number] };
export type PartRecipe = {
  componentId: string; label: string;
  /** structural/semantic role inside the family (wheel, seat, wall, handle, ...); `generic` when nothing is recognised */
  role: string; roleKnown: Known;
  material: MaterialSpec & { semantic: string };
  symmetry: 'mirror-x' | 'mirror-z' | null;
  repeat: { count: number; axis: 'x' | 'y' | 'z'; spacing: number } | null;
  articulation: Articulation | null;
  /** role-specific style parameters (counts, ratios, styles) with their provenance */
  style: Record<string, ParamValue>;
  details: string[]; // names of the semantic detail rules that fired for this part (for the report)
};
export type Palette = { primary: string; secondary: string; accent: string; glass: string };
export type VisualRecipe = {
  version: 1; category: Category; archetype: string; seed: number; confidence: number; alternatives: Array<{ category: Category; score: number }>;
  /** relative proportions of the whole object (longest = 1), estimated, never a verified dimension */
  proportions: { length: number; width: number; height: number; known: Known };
  palette: Palette; paletteKnown: Known;
  params: Record<string, ParamValue>; paramSpec: ParamSpec[];
  parts: PartRecipe[];
  detailBudget: { maxTriangles: number; lod: number };
  unknowns: string[];
  evidence: { used: boolean; summary: string };
};

export type RecipeIssue = { code: string; detail: string };
/** Structural validation of a recipe against its own spec. Pure; never repairs. */
export function validateRecipe(recipe: VisualRecipe): RecipeIssue[] {
  const issues: RecipeIssue[] = [];
  if (recipe.version !== 1) issues.push({ code: 'VERSION', detail: 'unsupported recipe version' });
  if (!(CATEGORIES as readonly string[]).includes(recipe.category)) issues.push({ code: 'CATEGORY', detail: `unknown category ${recipe.category}` });
  if (!Number.isInteger(recipe.seed) || recipe.seed < 0) issues.push({ code: 'SEED', detail: 'the seed must be a non-negative integer' });
  const seen = new Set<string>(); for (const p of recipe.parts) { if (seen.has(p.componentId)) issues.push({ code: 'DUPLICATE_PART', detail: p.componentId }); seen.add(p.componentId); if (p.repeat && (p.repeat.count < 1 || p.repeat.count > 64)) issues.push({ code: 'REPEAT_RANGE', detail: `${p.componentId}: repeat count ${p.repeat.count}` }); }
  for (const spec of recipe.paramSpec) { const v = recipe.params[spec.key]; if (v === undefined) { issues.push({ code: 'PARAM_MISSING', detail: spec.key }); continue; } if (spec.type === 'number' && (typeof v !== 'number' || v < (spec.min ?? -Infinity) || v > (spec.max ?? Infinity))) issues.push({ code: 'PARAM_RANGE', detail: `${spec.key}=${String(v)}` }); if (spec.type === 'choice' && !(spec.options ?? []).includes(String(v))) issues.push({ code: 'PARAM_CHOICE', detail: `${spec.key}=${String(v)}` }); if (spec.type === 'boolean' && typeof v !== 'boolean') issues.push({ code: 'PARAM_TYPE', detail: spec.key }); }
  if (recipe.detailBudget.maxTriangles < 1000 || recipe.detailBudget.maxTriangles > 400_000) issues.push({ code: 'BUDGET', detail: 'maxTriangles must be 1,000..400,000' });
  if (recipe.confidence < 0 || recipe.confidence > 1) issues.push({ code: 'CONFIDENCE', detail: 'confidence must be 0..1' });
  return issues;
}

/** Applies parameter overrides within their spec; values out of range or of the wrong type are clamped or ignored, never trusted. */
export function withParams(recipe: VisualRecipe, overrides: Record<string, ParamValue>): VisualRecipe {
  const params = { ...recipe.params };
  for (const spec of recipe.paramSpec) { const v = overrides[spec.key]; if (v === undefined) continue; if (spec.type === 'number' && typeof v === 'number' && Number.isFinite(v)) params[spec.key] = Math.min(spec.max ?? v, Math.max(spec.min ?? v, spec.step ? Math.round(v / spec.step) * spec.step : v)); else if (spec.type === 'choice' && (spec.options ?? []).includes(String(v))) params[spec.key] = String(v); else if (spec.type === 'boolean' && typeof v === 'boolean') params[spec.key] = v; }
  return { ...recipe, params };
}

export const hexToRgb = (hex: string): [number, number, number] => { const h = hex.replace('#', ''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
export const rgbToHex = (r: number, g: number, b: number) => `#${[r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;
export const shade = (hex: string, f: number) => { const [r, g, b] = hexToRgb(hex); return f >= 0 ? rgbToHex(r + (255 - r) * f, g + (255 - g) * f, b + (255 - b) * f) : rgbToHex(r * (1 + f), g * (1 + f), b * (1 + f)); };
