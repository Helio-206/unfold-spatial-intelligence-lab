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
import { canonicalPlanJson } from '../../universal-spatial/review-v1';
import { spatialPlanFingerprintV2 } from '../../universal-spatial/api-client';
import { fitGeometryToEvidence, type FittingResult } from './fitting';

export type StorageLike = { getItem(k: string): string | null; setItem(k: string, v: string): void };
const KEY = 'unfold.foundry.params.v2';
export type EvidenceBinding = { plan: SpatialPlanV2; planFingerprint: string; sourceSha256: string; originalSha256: string; preparedSha256: string; preparation: string; generationId: string; recipeVersion: 1 };
type BoundEvidence = { value: ImageEvidence; binding: EvidenceBinding; planIdentity: string };

export class FoundryGeometry {
  private overrides: Record<string, ParamValue> = {};
  private result: FoundryResult | null = null;
  private evidence: BoundEvidence | null = null;
  private evidenceEpoch = 0;
  private seed = 1;
  private listeners = new Set<() => void>();
  constructor(private readonly storage: StorageLike | null = typeof localStorage === 'undefined' ? null : localStorage) {}
  private keyFor(plan: SpatialPlanV2) { return canonicalPlanJson(plan); }
  private load(plan: SpatialPlanV2): void { this.overrides = {}; this.seed = 1; try { const all = JSON.parse(this.storage?.getItem(KEY) ?? '{}') as Record<string, { params: Record<string, ParamValue>; seed: number }>; const mine = all[this.keyFor(plan)]; if (mine) { this.overrides = mine.params; this.seed = mine.seed; } } catch { /* unreadable storage: defaults */ } }
  private save(plan: SpatialPlanV2): void { try { const all = JSON.parse(this.storage?.getItem(KEY) ?? '{}') as Record<string, unknown>; all[this.keyFor(plan)] = { params: this.overrides, seed: this.seed }; this.storage?.setItem(KEY, JSON.stringify(all)); } catch { /* quota or privacy mode: the session keeps its values */ } }
  private loaded: string | null = null;
  private fittingCache = new Map<string, FittingResult>();
  private lastFitting: FittingResult | null = null;
  /** Resultado do fitting por silhueta da última compilação (null sem evidência ligada). */
  get fitting(): FittingResult | null { return this.lastFitting; }
  compile = (plan: SpatialPlanV2): FoundryResult => {
    if (this.loaded !== this.keyFor(plan)) { if (this.loaded !== null) { this.evidenceEpoch++; this.evidence = null; } this.loaded = this.keyFor(plan); this.load(plan); }
    this.result?.retire();
    const binding = this.evidence;
    const evidence = binding && binding.planIdentity === this.keyFor(plan) && plan.source.kind === 'image' && binding.binding.sourceSha256 === plan.source.sha256 && binding.binding.preparedSha256 === plan.source.sha256 ? binding.value : null;
    // Image-conditioned fitting: bounded silhouette search over declared parameters, cached
    // per plan+silhouette so regeneration does not refit. User overrides win over fitted ones.
    let fitted: Record<string, number> = {};
    this.lastFitting = null;
    if (evidence) {
      const cacheKey = `${this.keyFor(plan)}|${evidence.aspect.toFixed(3)}|${evidence.symmetry.toFixed(3)}|${evidence.foregroundRatio.toFixed(3)}`;
      let fitting = this.fittingCache.get(cacheKey);
      if (!fitting) { fitting = fitGeometryToEvidence(plan, evidence); if (this.fittingCache.size > 4) this.fittingCache.clear(); this.fittingCache.set(cacheKey, fitting); }
      this.lastFitting = fitting;
      if (fitting.status === 'fitted') fitted = fitting.overrides;
    }
    this.result = compileFoundry(plan, { overrides: { ...fitted, ...this.overrides }, seed: this.seed, evidence });
    if (this.result.recipe && this.lastFitting) {
      if (this.lastFitting.status === 'fitted') this.result.recipe.unknowns.push(this.lastFitting.summary);
      else if (this.lastFitting.status !== 'aborted') this.result.recipe.unknowns.push(`Fitting por imagem não aplicado: ${this.lastFitting.reason}`);
    }
    if (plan.source.kind === 'image' && !evidence && this.result.recipe) this.result.recipe.unknowns.push('Evidência da imagem indisponível para este plano; apresentação conceptual baseada no plano.');
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
  async setEvidence(evidence: ImageEvidence | null, binding?: EvidenceBinding, signal?: AbortSignal): Promise<void> {
    const epoch = ++this.evidenceEpoch;
    this.evidence = null;
    if (!evidence || !binding || binding.recipeVersion !== 1 || binding.plan.source.kind !== 'image' || binding.plan.source.sha256 !== binding.sourceSha256 || binding.preparedSha256 !== binding.sourceSha256 || !/^[a-f0-9]{64}$/i.test(binding.originalSha256) || !binding.generationId || signal?.aborted) return;
    const planIdentity = this.keyFor(binding.plan);
    const fingerprint = await spatialPlanFingerprintV2(binding.plan);
    if (epoch !== this.evidenceEpoch || signal?.aborted || fingerprint !== binding.planFingerprint || planIdentity !== this.keyFor(binding.plan)) return;
    this.evidence = { value: evidence, binding, planIdentity };
  }
  onCompiled(l: () => void): () => void { this.listeners.add(l); return () => this.listeners.delete(l); }
  /** Ends this Space's build. The provider can serve the next Space the flow opens (parameters are keyed by plan source, evidence is replaced per picture). */
  dispose(): void { this.result?.retire(); this.result = null; this.loaded = null; this.overrides = {}; this.seed = 1; this.evidenceEpoch++; this.evidence = null; }
}
