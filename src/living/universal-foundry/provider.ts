/**
 * Experimental geometry provider for /living. It owns one Space's Foundry state: the recipe parameter overrides (persisted per plan source, so a saved Space reopens
 * with the same parameters), the seed, optional image evidence, and the last compiled result. It never writes the plan; the layer asks it to compile.
 */
import type { SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import type { RouterReport } from '../../universal-spatial/fidelity/types';
import { compileFoundry, type FoundryResult } from './foundry';
import type { ImageEvidence } from './evidence';
import type { ParamSpec, ParamValue, VisualRecipe } from './recipe';
import { withParams } from './recipe';

export type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void };
const KEY = 'unfold.foundry.params.v1';

export class FoundryGeometry {
  private overrides: Record<string, ParamValue> = {};
  private result: FoundryResult | null = null;
  private evidence: ImageEvidence | null = null;
  private seed = 1;
  private listeners = new Set<() => void>();
  constructor(private readonly storage: StorageLike | null = typeof localStorage === 'undefined' ? null : localStorage) {}
  private keyFor(plan: SpatialPlanV2) { return `${plan.source.sha256}`; }
  private load(plan: SpatialPlanV2): void { try { const all = JSON.parse(this.storage?.getItem(KEY) ?? '{}') as Record<string, { params: Record<string, ParamValue>; seed: number }>; const mine = all[this.keyFor(plan)]; if (mine) { this.overrides = mine.params; this.seed = mine.seed; } } catch { /* unreadable storage: defaults */ } }
  private save(plan: SpatialPlanV2): void { try { const all = JSON.parse(this.storage?.getItem(KEY) ?? '{}') as Record<string, unknown>; all[this.keyFor(plan)] = { params: this.overrides, seed: this.seed }; this.storage?.setItem(KEY, JSON.stringify(all)); } catch { /* quota or privacy mode: the session keeps its values */ } }
  private loaded: string | null = null;
  compile = (plan: SpatialPlanV2): FoundryResult => {
    if (this.loaded !== this.keyFor(plan)) { this.loaded = this.keyFor(plan); this.load(plan); }
    this.result?.retire();
    this.result = compileFoundry(plan, { overrides: this.overrides, seed: this.seed, evidence: this.evidence });
    this.listeners.forEach((l) => l());
    return this.result;
  };
  attach(_onReady: () => void): void { /* geometry is built by the layer's own upgrade loop, nothing arrives asynchronously from outside */ }
  report(): RouterReport | null { return this.result?.report ?? null; }
  get recipe(): VisualRecipe | null { return this.result?.recipe ? withParams(this.result.recipe, this.overrides) : null; }
  get specs(): ParamSpec[] { return this.result?.recipe?.paramSpec ?? []; }
  get values(): Record<string, ParamValue> { return { ...(this.result?.recipe?.params ?? {}), ...this.overrides }; }
  get currentSeed(): number { return this.seed; }
  /** Applies overrides; the caller asks the layer to rebuild so everything regenerates from the same plan, coherently. */
  set(plan: SpatialPlanV2, change: Record<string, ParamValue>, seed?: number): void { this.overrides = { ...this.overrides, ...change }; if (seed !== undefined) this.seed = Math.max(0, Math.floor(seed)); this.save(plan); }
  reset(plan: SpatialPlanV2): void { this.overrides = {}; this.seed = 1; this.save(plan); }
  setEvidence(evidence: ImageEvidence | null): void { this.evidence = evidence; }
  onCompiled(l: () => void): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
  /** Ends this Space's build. The provider can serve the next Space the flow opens (parameters are keyed by plan source, evidence is replaced per picture). */
  dispose(): void { this.result?.retire(); this.result = null; this.loaded = null; this.overrides = {}; this.seed = 1; }
}
