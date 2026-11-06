import type { Box3, Matrix4, Vector3 } from 'three';
import type { Bucket, Lod } from '../ops';
import type { MaterialSpec } from '../materials';
import type { Category, Palette, ParamSpec, ParamValue, PartRecipe } from '../recipe';

/** What a role builder knows about its neighbours (never their geometry, only where they are and what role they play). */
export type Sibling = { id: string; role: string; /** bounds in the shared object frame (the root of the plan) */ box: Box3; centre: Vector3; size: Vector3 };
export type PartContext = {
  id: string; label: string; role: string; part: PartRecipe;
  /** bounds of the part's own geometry in ITS local frame (what the builder must fill), and the centre/size of that box */
  min: Vector3; max: Vector3; size: Vector3; centre: Vector3;
  /** the part's box in the shared object frame, and the matrix taking object-frame points into this part's local frame */
  worldBox: Box3; toLocal: Matrix4;
  objectSize: Vector3; /** a length that scales details with the whole object: fasteners, bevels, gaps */ unit: number;
  /** the plan's own colour for this component */ own?: string;
  params: Record<string, ParamValue>; archetype: string; palette: Palette; rnd: () => number; lod: Lod; siblings: Sibling[];
};
export type Family = {
  category: Category; archetypes: string[];
  /** words (EN/PT) that make a plan component, label or title point at this family */
  keywords: RegExp; archetypeOf(words: string, facts: Facts): string;
  roles: Array<{ role: string; words: RegExp }>;
  params(archetype: string, facts: Facts): ParamSpec[];
  /** role-specific style defaults derived from the plan */
  style(role: string, facts: Facts, size: Vector3): Record<string, ParamValue>;
  /** the material semantic a role gets, for the recipe and the report (the builder applies the same choice) */
  materialOf(role: string, palette: Palette, params: Record<string, ParamValue>): MaterialSpec;
  build(role: string, ctx: PartContext): Bucket;
  /** semantic details this role gets, by name, for the report */
  detailRules(role: string): string[];
};
/** Counts and ratios read from the plan, not from any particular object. */
export type Facts = { counts: Record<string, number>; size: Vector3; words: string; components: number; mostly: { rounded: number; boxy: number } };
