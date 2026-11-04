import { Box3, Color, Group, Mesh, Raycaster, type Camera, type Material, type Vector2 } from 'three';
import { analyzeAssembly, describeDefect, refineAssembly, type AssemblyAnalysis } from '../../universal-spatial/assembly-analysis';
import { applySpatialOperationV2, type GeometryNodeV2, type SpatialOperationV2, type SpatialPlanV2, type SpatialReviewPrecondition } from '../../universal-spatial/contracts-v2';
import { collectWorldPoints, heroAzimuth, normalizeForPresentation } from '../../universal-spatial/framing';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../../universal-spatial/geometry-compiler-v2';
import type { SpaceLayer } from '../workspace-design/space-port';
import type { RouterReport } from '../../universal-spatial/fidelity/types';
import { createPresentationDirector, type CameraCue, type PresentationDirector, type PresentationState, type ViewContext } from '../spatial-presentation';
import { SpatialTransactionUnresolvedError } from '../../universal-spatial/api-client';

/**
 * Thrown by a sync's reconciliation when the server session was explicitly recovered (re-adopted
 * from the local pre-transaction plan): the transaction is authoritatively absent from the new
 * session. It is a recovery outcome, not a claim that the original submission reached the server.
 */
export class SpatialTransactionSessionRecoveredError extends Error {
  readonly code = 'SPATIAL_V2_TRANSACTION_NOT_COMMITTED_SESSION_RECOVERED' as const;
  constructor() { super('SPATIAL_V2_TRANSACTION_NOT_COMMITTED_SESSION_RECOVERED'); this.name = 'SpatialTransactionSessionRecoveredError'; }
}

/** Presentation size of the longest side, in stage units. The plan keeps its own units; the scale lives on a wrapper and is never written back. */
export const SPACE_PRESENTATION_SIZE = 5;
const ORIGIN_LABEL = { observed: 'observado', inferred: 'inferido', user_provided: 'introduzido por si', design_approximation: 'aproximação de desenho', unknown: 'desconhecido' } as const;
const CONFIRMED = new Set(['observed', 'user_provided']);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt3 = (v: readonly number[]) => `[${v.map((n) => n.toFixed(3)).join(', ')}]`;

type Pending = { label: string; before: string; after: string; operations: SpatialOperationV2[]; needsAuthorization: boolean; source: 'person' | 'meta' | 'meta-visual' | 'solver'; /** what produced the proposal, recorded in the provenance when a person applies it */ evidence?: string; /** Revalidated at apply time; a false (or a throw) invalidates the proposal instead of applying it. */ authorisationGuard?: () => Promise<boolean>; /** The exact reviewed state this proposal was computed from; sent as the server-side transaction fence. */ reviewBinding?: SpatialReviewPrecondition };
/** Triangles of arrived geometry swapped in per call (and so per frame): bounds the GPU upload one frame has to carry. */
export const UPGRADE_TRIANGLES_PER_CALL = 60_000;
/** A compile result that may finish later: geometry computed off the main thread arrives through `upgrade()`. V2's result has neither method. */
type Upgradable = { upgrade?(budgetTriangles?: number): string[]; readyCount?(): number; retire?(): void; report?: RouterReport };
type Shape = Extract<GeometryNodeV2, { type: 'shape' }>;
export type PendingEdit = Pending;
/** Mirrors edits to the server session so that revisions agree. Throws when the server cannot confirm; the layer then carries on locally and says so. */
export type OperationProvenance = { origin: 'user_provided' | 'inferred'; evidence: string };
export type LayerSync = {
  /** The provenance travels with the operation: a solver result stays `inferred` on the server too. */
  apply(operation: SpatialOperationV2, provenance: OperationProvenance): Promise<SpatialPlanV2>;
  undo(): Promise<SpatialPlanV2>;
  /** Atomic multi-operation commit (V4 E0). When present, grouped edits use it instead of failing closed. The idempotency key is generated once by the layer and stays stable across reconciliation. */
  applyTransaction?(operations: SpatialOperationV2[], provenance: OperationProvenance, idempotencyKey: string, reviewPrecondition?: SpatialReviewPrecondition): Promise<SpatialPlanV2>;
  /** One grouped undo for one grouped commit. When present, grouped undo never falls back to repeated single undos. */
  undoTransaction?(): Promise<SpatialPlanV2>;
  /**
   * Reconciles an unresolved transaction against the authoritative server result for the same
   * idempotency key. Resolves with the authoritative plan when the transaction is committed;
   * throws `SpatialTransactionSessionRecoveredError` when the session was explicitly recovered
   * without it; any other throw keeps the unresolved state.
   */
  reconcileTransaction?(idempotencyKey: string): Promise<SpatialPlanV2>;
};
export type SpaceLayerHost = {
  /** A camera request from the Presentation Director. The workspace asks its arbiter; a person's input always wins. */
  cue?(cue: CameraCue): void;
  presentationChanged?(state: PresentationState): void;
  reducedMotion?(): boolean;
  viewContext?(): ViewContext | undefined;
  /** The server session cannot be trusted any more (expired, conflict, network). The reason is shown to the person. */
  syncLost?(reason: string): void;
  /** The plan changed (edit, undo, solver). The host refreshes the chrome and the inspector. */
  changed(): void;
  /** Redraw only (a highlight, a reveal step). */
  redraw(): void;
  notify(text: string | null): void;
};

const shapes = (node: GeometryNodeV2): Shape[] => node.type === 'shape' ? [node] : node.children.flatMap(shapes);

/**
 * The compiled plan on the workspace stage. It owns its objects, picks by `spatialEntityId`, and changes the plan only through typed
 * operations (`applySpatialOperationV2`): previewed first, authorised when they touch an observed or confirmed value, undoable.
 */
export class PlanSpaceLayer implements SpaceLayer {
  readonly root = new Group();
  private wrapper: Group | null = null;
  private compiled: Group | null = null;
  private fixed: { scale: number; position: [number, number, number] } | null = null;
  private plan: SpatialPlanV2;
  private readonly history: Array<{ plan: SpatialPlanV2; ops: number }> = [];
  private sync: LayerSync | null = null;
  /**
   * A grouped transaction whose outcome is unknown (the server may or may not have committed it).
   * While set, every dependent edit and undo is blocked: the local plan is the pre-transaction plan
   * and must not diverge further from a possibly-committed remote state.
   */
  private unresolvedTx: { key: string; before: SpatialPlanV2; ops: number } | null = null;
  /** While set, no edit is applied (the server session is being prepared and would not know it). */
  private lockReason: string | null = null;
  private busy = false;
  /** An applyEdit is between claim and commit (guard or network in flight): no second application may start. */
  private applying = false;
  private director: PresentationDirector | null = null;
  presentation: PresentationState | null = null;
  private pending: Pending | null = null;
  private analysisCache: AssemblyAnalysis | null = null;
  private routed: Upgradable | null = null;
  private disposed = false;
  private displayed = false;
  private retiredMaterials: (() => void) | null = null;
  private retirementTimer: ReturnType<typeof setTimeout> | null = null;
  private continuation: (() => void) | null = null;
  private frameHandle: unknown = null;
  explanationVersion = 0;
  private selected: string | null = null;
  private isolated: string | null = null;
  private readonly emissive = new WeakMap<Material, { color: Color; intensity: number }>();
  private readonly raycaster = new Raycaster();
  private authorised = false;
  stats: ReturnType<typeof compileSpatialPlanV2>['stats'];

  /** `compile` is the geometry seam: default is the V2 compiler. The V3 router has the same call shape (`compileWithRouter`). It must not write the plan. */
  constructor(plan: SpatialPlanV2, private readonly host: SpaceLayerHost, private readonly compile: (plan: SpatialPlanV2) => ReturnType<typeof compileSpatialPlanV2> = compileSpatialPlanV2) {
    this.root.name = 'space-layer';
    this.plan = plan;
    this.stats = this.build();
    this.director = createPresentationDirector({
      plan: this.plan, root: this.wrapper!, requestRender: () => this.host.redraw(), tuning: { dim: 0.55 },
      onCue: (cue) => this.host.cue?.(cue), onState: (state) => { this.presentation = state; this.host.presentationChanged?.(state); },
      reducedMotion: this.host.reducedMotion?.() ? true : 'auto', view: this.host.viewContext?.(),
    });
  }

  get currentPlan(): SpatialPlanV2 { return this.plan; }
  get geometryReport(): RouterReport | null { return this.routed?.report ?? null; }
  get pendingEdit(): Pending | null { return this.pending; }
  authorise(value: boolean): void { this.authorised = value; }
  get canUndo(): boolean { return this.history.length > 0 && !this.busy && this.lockReason === null && !this.unresolvedTx; }
  get isBusy(): boolean { return this.busy || this.lockReason !== null || this.unresolvedTx !== null; }
  /** True while a grouped transaction's remote outcome is unknown; dependent edits stay blocked. */
  get transactionUnresolved(): boolean { return this.unresolvedTx !== null; }
  get unresolvedTransactionKey(): string | null { return this.unresolvedTx?.key ?? null; }
  lockEditing(reason: string): void { this.lockReason = reason; }
  unlockEditing(): void { this.lockReason = null; }
  get synced(): boolean { return this.sync !== null; }
  attachSync(sync: LayerSync | null): void { this.sync = sync; }
  get isExploded(): boolean { return (this.director?.state.exploded ?? 0) > 0.5; }
  /** Called from the workspace frame loop with the real elapsed time; true while another frame is needed. */
  update(dtMs: number): boolean { return this.director?.update(dtMs) ?? false; }
  afterRender(): void { if (this.disposed) return; this.displayed = true; this.releaseRetiredMaterials(); }
  get editCount(): number { return this.history.length; }

  private build(): ReturnType<typeof compileSpatialPlanV2>['stats'] {
    this.explanationVersion++;
    this.release();
    this.routed?.retire?.(); this.cancelContinuation(); // results asked for by the previous plan version can no longer be used
    const compiled = this.compile(this.plan);
    this.routed = compiled as Upgradable; this.compiled = compiled.root;
    if (!this.fixed) {
      const presentation = normalizeForPresentation(compiled.root, SPACE_PRESENTATION_SIZE);
      this.fixed = { scale: presentation.scale, position: presentation.wrapper.position.toArray() as [number, number, number] };
      this.wrapper = presentation.wrapper;
    } else {
      const wrapper = new Group(); wrapper.name = 'presentation-stage';
      wrapper.scale.setScalar(this.fixed.scale); wrapper.position.set(...this.fixed.position); wrapper.add(compiled.root); this.wrapper = wrapper;
    }
    this.root.add(this.wrapper); this.root.updateMatrixWorld(true);
    this.analysisCache = null;
    this.director?.rebind({ plan: this.plan, root: this.wrapper });
    this.applyPaint();
    // Cache hits do not emit onReady; schedule them after this build has returned.
    if ((this.routed.readyCount?.() ?? 0) > 0) this.scheduleGeometryUpgrade(12_000);
    return compiled.stats;
  }

  /**
   * Swaps in geometry that finished computing after the Space was built. Only the meshes inside the affected component groups change; the plan, the groups,
   * the selection, the isolation and the Director's state (entrance, focus, exploded view, tour) are untouched. Returns the component ids that changed.
   */
  upgradeGeometry(budgetTriangles = UPGRADE_TRIANGLES_PER_CALL): string[] {
    if (this.disposed || !this.wrapper) return [];
    const ids = this.routed?.upgrade?.(budgetTriangles) ?? [];
    if (ids.length) {
      this.explanationVersion++;
      const totals = this.routed?.report?.totals; if (totals) this.stats = { ...this.stats, meshCount: totals.meshes, triangleCount: totals.triangles, geometryBytes: totals.geometryBytes };
      this.root.updateMatrixWorld(true); this.analysisCache = null;
      this.applyPaint(); this.director?.refreshComponents(ids); this.host.redraw();
    }
    // a big arrival is uploaded to the GPU on the next render: what did not fit in this call follows on the next frames, so no single frame carries it all
    if ((this.routed?.readyCount?.() ?? 0) > 0) this.scheduleGeometryUpgrade(budgetTriangles);
    return ids;
  }

  /** Coalesce worker arrivals into one cooperative slice per animation frame. */
  scheduleGeometryUpgrade(budgetTriangles = UPGRADE_TRIANGLES_PER_CALL): void {
    if (this.disposed || this.continuation) return;
    const routedNow = this.routed;
    const step = () => { this.continuation = null; this.frameHandle = null; if (!this.disposed && this.routed === routedNow) this.upgradeGeometry(budgetTriangles); };
    this.continuation = step;
    const g = globalThis as { requestAnimationFrame?: (cb: () => void) => number };
    this.frameHandle = g.requestAnimationFrame ? g.requestAnimationFrame(step) : setTimeout(step, 16);
  }

  private cancelContinuation(): void {
    if (this.frameHandle === null) { this.continuation = null; return; }
    const g = globalThis as { cancelAnimationFrame?: (h: number) => void }; if (g.cancelAnimationFrame) g.cancelAnimationFrame(this.frameHandle as number); else clearTimeout(this.frameHandle as ReturnType<typeof setTimeout>);
    this.frameHandle = null; this.continuation = null;
  }

  private release(): void {
    if (this.wrapper) this.root.remove(this.wrapper);
    if (this.compiled) {
      const defer = this.displayed && !this.disposed;
      const releaseMaterials = disposeCompiledSpatialPlan(this.compiled, defer);
      if (defer) {
        this.releaseRetiredMaterials(); this.retiredMaterials = releaseMaterials;
        // A hidden or stalled scene must not keep the previous materials indefinitely.
        this.retirementTimer = setTimeout(() => this.releaseRetiredMaterials(), 1000);
      }
    }
    this.displayed = false;
    this.wrapper = null; this.compiled = null;
  }

  private releaseRetiredMaterials(): void {
    if (this.retirementTimer !== null) clearTimeout(this.retirementTimer);
    this.retirementTimer = null; this.retiredMaterials?.(); this.retiredMaterials = null;
  }

  // ------------------------------------------------------------------------------------------------ SpaceLayer
  has(id: string): boolean { return this.plan.components.some((component) => component.id === id); }
  describe(id: string) { const component = this.plan.components.find((item) => item.id === id); return component ? { kind: 'componente', label: component.label } : null; }
  get isolatedId(): string | null { return this.isolated; }

  box(id?: string | null): Box3 | null {
    if (!this.wrapper) return null;
    this.root.updateMatrixWorld(true);
    let points: ReturnType<typeof collectWorldPoints>;
    if (id) {
      points = [];
      this.wrapper.traverse((object) => { if (object.userData.spatialComponentRoot && object.userData.spatialEntityId === id) points.push(...collectWorldPoints(object, 2000, (child) => child !== object && Boolean(child.userData.spatialComponentRoot))); });
    } else points = collectWorldPoints(this.wrapper, 20_000);
    return points.length ? new Box3().setFromPoints(points) : null;
  }

  /** The three-quarter view with the largest silhouette and the most detail facing the camera (a stated heuristic from the V2 recovery, not recognition). */
  heroAzimuthDeg(): number | null {
    if (!this.wrapper) return null;
    const points = collectWorldPoints(this.wrapper, 8000);
    // plans are told that the front of the object faces +Z, so the hero view is chosen among the two three-quarter views from that side
    return points.length ? heroAzimuth(points, [38, 128]) : null;
  }

  pick(ndc: Vector2, camera: Camera): string | null {
    if (!this.wrapper) return null;
    this.raycaster.setFromCamera(ndc, camera);
    const hit = this.raycaster.intersectObject(this.wrapper, true).find((item) => item.object.visible && typeof item.object.userData.spatialEntityId === 'string');
    return hit ? (hit.object.userData.spatialEntityId as string) : null;
  }

  highlight(id: string | null): void {
    if (id !== this.selected) { this.pending = null; this.authorised = false; }
    this.selected = id; this.director?.focus(id, { cue: false }); this.applyPaint(); this.host.redraw();
  }
  isolate(id: string | null): void { this.isolated = id; this.applyPaint(); this.host.redraw(); }
  onSelectionCleared(): void { this.selected = null; this.pending = null; this.applyPaint(); }

  private meshes(): Mesh[] { const out: Mesh[] = []; this.wrapper?.traverse((object) => { if (object instanceof Mesh) out.push(object); }); return out; }
  private applyPaint(): void {
    for (const mesh of this.meshes()) {
      const mine = mesh.userData.spatialEntityId === this.selected;
      mesh.visible = !(this.isolated && mesh.userData.spatialEntityId !== this.isolated);
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        const m = material as Material & { emissive?: Color; emissiveIntensity?: number };
        if (!m.emissive) continue;
        if (!this.emissive.has(m)) this.emissive.set(m, { color: m.emissive.clone(), intensity: m.emissiveIntensity ?? 1 });
        const base = this.emissive.get(m)!;
        if (mine) { m.emissive.set('#FF5A1F'); m.emissiveIntensity = 0.42; } else { m.emissive.copy(base.color); m.emissiveIntensity = base.intensity; }
      }
    }
  }

  /**
   * Construction by the Presentation Director (#26): parts arrive in structural order and settle on the planned positions. Instant when `immediate`.
   * Presentation only; it is not a simulation and not an assembly procedure.
   */
  reveal(immediate: boolean): void {
    const d = this.director; if (!d) return;
    if (immediate) { d.setReducedMotion(true); d.playEntrance(); d.setReducedMotion(this.host.reducedMotion?.() ? true : 'auto'); return; }
    d.playEntrance();
  }
  get revealing(): boolean { return this.director?.state.phase === 'entering'; }
  /** Stops any presentation motion and restores the planned state, so a capture shows the object as planned. */
  settle(): void { this.director?.cancel(); this.applyPaint(); }
  get presentationNotice(): string | null { return this.director?.state.notice ?? null; }

  /** Exploded view by the Director: generic, reversible, announced by `presentationNotice`. */
  setExploded(on: boolean, immediate = false): boolean { this.director?.setExploded(on ? 1 : 0, { animate: !immediate, cue: !immediate }); return this.isExploded || on; }

  // ------------------------------------------------------------------------------------------------ analysis
  analysis(): AssemblyAnalysis | null {
    if (!this.analysisCache) { try { this.analysisCache = analyzeAssembly(this.plan); } catch { return null; } }
    return this.analysisCache;
  }
  assemblyLines(): string[] { const a = this.analysis(); return a ? a.defects.map(describeDefect) : []; }
  get closableGaps(): boolean { return !!this.analysis()?.defects.some((defect) => defect.kind === 'floating' && !('blockedBy' in defect && defect.blockedBy)); }

  /** Applies operations in order, through the server session when there is one, so both sides keep the same revision. */
  private async commit(operations: SpatialOperationV2[], provenance: { origin: 'user_provided' | 'inferred'; evidence: string }, localPlan?: SpatialPlanV2, reviewPrecondition?: SpatialReviewPrecondition): Promise<void> {
    if (this.unresolvedTx) throw new Error('SPATIAL_V2_TRANSACTION_UNRESOLVED');
    const before = this.plan; let next = before;
    if (this.sync && (operations.length > 1 || reviewPrecondition)) {
      // Grouped edits only ever commit through the atomic transaction endpoint. Without it, fail
      // closed; with it, a failure leaves the local plan untouched (never a silent local commit).
      // A review-fenced edit uses the transaction endpoint even for one operation, so the server
      // can verify the fence in the same critical section as the commit.
      if (!this.sync.applyTransaction) throw new Error(reviewPrecondition ? 'REVIEW_FENCED_TRANSACTION_UNAVAILABLE' : 'BATCH_REQUIRES_ATOMIC_SERVER');
      const idempotencyKey = `txn-${globalThis.crypto.randomUUID()}`;
      try { next = await this.sync.applyTransaction(operations, provenance, idempotencyKey, reviewPrecondition); }
      catch (error) {
        // Outcome unknown: keep the stable key and the pre-transaction plan, and block dependent
        // edits until reconcileTransaction() settles this against the authoritative server result.
        if (error instanceof SpatialTransactionUnresolvedError) { this.unresolvedTx = { key: idempotencyKey, before, ops: operations.length }; }
        throw error;
      }
    } else if (this.sync) {
      try { for (const operation of operations) next = await this.sync.apply(operation, provenance); }
      catch (error) { if (this.disposed) throw new Error('SPACE_DISPOSED'); this.sync = null; this.host.syncLost?.(error instanceof Error ? error.message : 'sessão do servidor indisponível'); next = localPlan ?? this.applyLocal(before, operations, provenance); }
    } else next = localPlan ?? this.applyLocal(before, operations, provenance);
    if (this.disposed) throw new Error('SPACE_DISPOSED');
    this.history.push({ plan: before, ops: operations.length }); this.plan = next; this.pending = null; this.authorised = false; this.stats = this.build();
  }
  private applyLocal(plan: SpatialPlanV2, operations: SpatialOperationV2[], provenance: { origin: 'user_provided' | 'inferred'; evidence: string }): SpatialPlanV2 {
    let next = plan; for (const operation of operations) next = applySpatialOperationV2(next, operation, provenance); return next;
  }

  /** The bounded solver proposes `set-transform` operations only; they are marked inferred and can be undone. */
  async closeGaps(): Promise<{ applied: number; iterations: number }> {
    if (this.disposed) return { applied: 0, iterations: 0 };
    if (this.unresolvedTx) { this.host.notify('Edição bloqueada: há uma transacção por reconciliar (SPATIAL_V2_TRANSACTION_UNRESOLVED).'); return { applied: 0, iterations: 0 }; }
    if (this.busy || this.lockReason) { if (this.lockReason) this.host.notify(`Edição indisponível: ${this.lockReason}.`); return { applied: 0, iterations: 0 }; }
    const result = refineAssembly(this.plan);
    if (!result.applied.length) return { applied: 0, iterations: result.iterations };
    this.busy = true; this.director?.enterEditing();
    let committed = false;
    try { await this.commit(result.applied.map((a) => a.operation), { origin: 'inferred', evidence: 'Assembly solver proposed a position that closes a gap (bounding boxes, not a contact proof).' }, this.sync ? undefined : result.plan); committed = true; }
    catch (error) { if (!this.disposed) this.host.notify(`Edição bloqueada: ${error instanceof Error ? error.message : 'erro desconhecido'}`); }
    finally { this.busy = false; }
    this.director?.resumeExploring(); if (!this.disposed) this.host.changed();
    return { applied: committed ? result.applied.length : 0, iterations: result.iterations };
  }
  async undo(): Promise<boolean> {
    if (this.disposed) return false;
    if (this.unresolvedTx) { this.host.notify('Undo bloqueado: há uma transacção por reconciliar (SPATIAL_V2_TRANSACTION_UNRESOLVED).'); return false; }
    if (this.lockReason) { this.host.notify(`Edição indisponível: ${this.lockReason}.`); return false; }
    const previous = this.history.pop(); if (!previous || this.busy) { if (previous) this.history.push(previous); return false; }
    if (this.sync && previous.ops > 1 && !this.sync.undoTransaction) { this.history.push(previous); this.host.notify('Undo agrupado indisponível: o servidor não oferece transacção atómica.'); return false; }
    this.busy = true; this.director?.enterEditing();
    try {
      if (this.sync && previous.ops > 1) {
        // One grouped undo for the whole transaction; on failure nothing changes locally.
        try { const restored = await this.sync.undoTransaction!(); if (this.disposed) { this.history.push(previous); return false; } this.plan = restored; }
        catch (error) { this.history.push(previous); if (!this.disposed) this.host.notify(`Undo agrupado bloqueado: ${error instanceof Error ? error.message : 'erro desconhecido'}`); return false; }
      }
      else if (this.sync) { try { let restored = this.plan; for (let i = 0; i < previous.ops; i++) restored = await this.sync.undo(); if (this.disposed) return false; this.plan = restored; } catch (error) { if (this.disposed) return false; this.sync = null; this.host.syncLost?.(error instanceof Error ? error.message : 'sessão do servidor indisponível'); this.plan = previous.plan; } }
      else this.plan = previous.plan;
      this.pending = null; this.stats = this.build();
    } finally { this.busy = false; }
    this.director?.resumeExploring(); this.host.changed(); return true;
  }

  /**
   * Settles an unresolved grouped transaction against the authoritative server result.
   * `committed`: the authoritative plan is adopted as one undoable history entry.
   * `recovered-not-committed`: the session was explicitly recovered without the transaction; the
   * local pre-transaction plan stands and editing resumes. `still-unresolved`: nothing was
   * decided and the block stays. Never invents an outcome.
   */
  async reconcileTransaction(): Promise<'committed' | 'recovered-not-committed' | 'still-unresolved'> {
    const pendingTx = this.unresolvedTx;
    if (this.disposed || !pendingTx || this.busy) return 'still-unresolved';
    if (!this.sync?.reconcileTransaction) { this.host.notify('Reconciliação indisponível: a sessão não oferece recuperação de transacções.'); return 'still-unresolved'; }
    this.busy = true; this.director?.enterEditing();
    try {
      const authoritative = await this.sync.reconcileTransaction(pendingTx.key);
      if (this.disposed) return 'still-unresolved';
      this.history.push({ plan: pendingTx.before, ops: pendingTx.ops });
      this.plan = authoritative; this.unresolvedTx = null; this.pending = null; this.authorised = false; this.stats = this.build();
      this.host.notify('Transacção reconciliada: o plano do servidor foi adoptado.');
      return 'committed';
    } catch (error) {
      if (error instanceof SpatialTransactionSessionRecoveredError) {
        if (this.disposed) return 'still-unresolved';
        this.unresolvedTx = null; this.pending = null;
        this.host.notify('Sessão recuperada sem a transacção por reconciliar: ela não ficou aplicada e as edições reabriram sobre o plano actual.');
        return 'recovered-not-committed';
      }
      if (!this.disposed) this.host.notify(`Reconciliação ainda impossível: ${error instanceof Error ? error.message : 'erro desconhecido'}. As edições continuam bloqueadas.`);
      return 'still-unresolved';
    } finally { this.busy = false; this.director?.resumeExploring(); if (!this.disposed) this.host.changed(); }
  }

  // ------------------------------------------------------------------------------------------------ editing
  private step(): number { return (this.analysis()?.span ?? 1) * 0.05; }
  /** Previews a nudge or a scale on the selected component. Nothing changes until `applyEdit`. */
  proposeEdit(code: string, label = code): void {
    const component = this.plan.components.find((item) => item.id === this.selected); if (!component) return;
    const opId = `edit-${code.replace(/[^a-zA-Z0-9]+/g, (m) => (m === '+' ? 'plus' : m === '-' ? '-' : '-'))}-${Date.now().toString(36)}`.replace(/--+/g, '-').slice(0, 80);
    const op = (value: unknown, kind: SpatialOperationV2['kind'] = 'set-transform', nodeKey: string | null = null): SpatialOperationV2 => ({ contract: 'unfold.spatial-operation.v2', operationId: `${opId}${nodeKey ? `-${nodeKey}` : ''}`.slice(0, 80), kind, componentId: component.id, nodeKey, value });
    let operations: SpatialOperationV2[], before: string, after: string;
    if (code.startsWith('scale')) {
      const factor = code === 'scale-up' ? 1.1 : 1 / 1.1, next = component.transform.scale.map((n) => n * factor) as [number, number, number];
      operations = [op({ ...component.transform, scale: next })]; before = `escala ${fmt3(component.transform.scale)}`; after = `escala ${fmt3(next)}`;
    } else {
      const axis = 'xyz'.indexOf(code[0]!), sign = code[1] === '+' ? 1 : -1, position = [...component.transform.position] as [number, number, number];
      position[axis] = Math.round((position[axis]! + sign * this.step()) * 1e6) / 1e6;
      operations = [op({ ...component.transform, position })]; before = `posição ${fmt3(component.transform.position)}`; after = `posição ${fmt3(position)}`;
    }
    this.pending = { label, before, after, operations, needsAuthorization: CONFIRMED.has(component.provenance.transform), source: 'person' };
    this.authorised = false; this.host.changed();
  }
  proposeColour(colour: string): void {
    const component = this.plan.components.find((item) => item.id === this.selected); if (!component) return;
    const keys = shapes(component.geometry); if (!keys.length) return;
    const stamp = Date.now().toString(36);
    this.pending = {
      label: 'Cor', before: keys[0]!.material.color, after: colour, needsAuthorization: CONFIRMED.has(component.provenance.material), source: 'person',
      operations: keys.map((shape, index) => ({ contract: 'unfold.spatial-operation.v2' as const, operationId: `edit-colour-${stamp}-${index}`.slice(0, 80), kind: 'set-material' as const, componentId: component.id, nodeKey: shape.key, value: { ...shape.material, color: colour } })),
    };
    this.authorised = false; this.host.changed();
  }
  /** An operation a model proposed. It is only previewed; it is applied when a person authorises it, always. */
  proposeOperation(operation: SpatialOperationV2, source: 'meta' | 'meta-visual', label: string): boolean {
    const component = this.plan.components.find((item) => item.id === operation.componentId); if (!component) return false;
    try { applySpatialOperationV2(this.plan, operation, { origin: 'inferred', evidence: 'preview' }); } catch { return false; }
    const describe = (op: SpatialOperationV2) => op.kind === 'set-transform' ? `posição ${fmt3((op.value as { position: number[] }).position)}, escala ${fmt3((op.value as { scale: number[] }).scale)}` : op.kind === 'set-material' ? `cor ${(op.value as { color: string }).color}` : op.kind === 'set-repeat' ? 'padrão de repetição' : 'geometria';
    const current = operation.kind === 'set-transform' ? `posição ${fmt3(component.transform.position)}, escala ${fmt3(component.transform.scale)}` : operation.kind === 'set-material' ? `cor ${shapes(component.geometry)[0]?.material.color ?? '?'}` : 'valor actual';
    this.selected = component.id; this.pending = { label: `${label} · ${component.label}`, before: current, after: describe(operation), operations: [operation], needsAuthorization: true, source }; this.authorised = false;
    this.applyPaint(); this.host.changed(); return true;
  }
  /**
   * A result of a deterministic solver (V4 structural fit): several typed operations previewed as ONE step. Not an AI hypothesis and not a human value: it
   * is applied only when a person authorises it, then recorded as that person's decision with the solver's evidence in the provenance. One undo reverts all of it.
   */
  proposeSolverEdit(operations: SpatialOperationV2[], label: string, evidence: string, options?: { authorisationGuard?: () => Promise<boolean>; reviewBinding?: SpatialReviewPrecondition }): boolean {
    if (this.disposed || !operations.length || this.isBusy) return false;
    try { let probe = this.plan; for (const operation of operations) probe = applySpatialOperationV2(probe, operation, { origin: 'inferred', evidence: 'preview' }); } catch { return false; }
    const first = this.plan.components.find((item) => item.id === operations[0]!.componentId); if (!first) return false;
    this.selected = this.selected && operations.some((op) => op.componentId === this.selected) ? this.selected : first.id;
    this.pending = { label, before: 'colocação actual', after: `${new Set(operations.map((op) => op.componentId)).size} componentes: ${[...new Set(operations.map((op) => op.kind === 'set-geometry' ? 'geometria' : op.kind === 'set-transform' ? 'posição, rotação e escala' : op.kind === 'set-material' ? 'material' : 'padrão'))].join(', ')}`, operations, needsAuthorization: true, source: 'solver', evidence, ...(options?.authorisationGuard ? { authorisationGuard: options.authorisationGuard } : {}), ...(options?.reviewBinding ? { reviewBinding: options.reviewBinding } : {}) }; this.authorised = false;
    this.applyPaint(); this.host.changed(); return true;
  }
  cancelPending(): void { this.pending = null; this.authorised = false; this.host.changed(); }
  get selectedId(): string | null { return this.selected; }

  async applyEdit(): Promise<void> {
    const pending = this.pending; if (!pending || this.busy || this.applying) return;
    if (this.lockReason) { this.host.notify(`Edição indisponível: ${this.lockReason}.`); return; }
    if (pending.needsAuthorization && !this.authorised) { this.host.notify(pending.source === 'person' ? 'Esta edição toca num valor observado ou confirmado: marque a autorização primeiro.' : pending.source === 'solver' ? 'Uma proposta do solver só se aplica depois de a autorizar: marque a autorização.' : 'Uma alteração proposta pela IA só se aplica depois de a autorizar: marque a autorização.'); return; }
    // One application at a time, claimed synchronously before any await: a second applyEdit during
    // the guard (or the commit) is a no-op, never a duplicate submission.
    this.applying = true;
    const planAtStart = this.plan, authorisedAtStart = this.authorised;
    try {
      if (pending.authorisationGuard) {
        // Bound to an external state (e.g. a review revision): revalidate now, fail closed on any doubt.
        const valid = await pending.authorisationGuard().catch(() => false);
        if (!valid) { if (this.pending === pending) { this.pending = null; this.authorised = false; } if (!this.disposed) { this.host.notify('Proposta invalidada: o estado revisto mudou ou não pôde ser revalidado. Nada foi aplicado.'); this.host.changed(); } return; }
        // While the guard was awaiting the network, the world may have moved: only the exact same
        // pending proposal, with the same authorisation, on the same plan, may proceed.
        if (this.disposed) return;
        if (this.pending !== pending || this.plan !== planAtStart || this.authorised !== authorisedAtStart || pending.needsAuthorization && !this.authorised) {
          if (!this.disposed) { this.host.notify('Proposta invalidada: a proposta, a autorização ou o plano mudaram durante a revalidação. Nada foi aplicado.'); this.host.changed(); }
          return;
        }
      }
      this.busy = true; this.director?.enterEditing();
      try {
        // Three facts stay separate: who inferred the values (the provenance origin), that a person
        // authorised applying them (recorded in the evidence text), and the server commit itself.
        // Authorisation never promotes inferred geometry to user_provided.
        const inferred = pending.source !== 'person';
        const baseEvidence = pending.source === 'solver' ? (pending.evidence ?? 'Proposta do solver estrutural.') : pending.source === 'person' ? 'Editado por uma pessoa no workspace (afirmado pelo cliente, sem identidade verificada).' : 'Proposta pela IA (hipótese) no workspace (afirmado pelo cliente, sem identidade verificada).';
        const authorisationNote = inferred ? ` Authorisation: a person authorised applying this inferred result in the workspace (client-asserted, reviewer identity not authenticated)${pending.reviewBinding ? `; review ${pending.reviewBinding.reviewId} revision ${pending.reviewBinding.reviewRevision}` : ''}.` : '';
        const evidence = `${baseEvidence.slice(0, Math.max(0, 500 - authorisationNote.length))}${authorisationNote}`.slice(0, 500);
        await this.commit(pending.operations, { origin: inferred ? 'inferred' : 'user_provided', evidence }, undefined, pending.reviewBinding);
        this.host.notify(`Aplicado: ${pending.label}.${this.sync ? '' : ' Edição só local: a sessão do servidor não a conhece.'}`);
      } catch (error) { if (this.pending === pending) this.pending = null; if (!this.disposed) this.host.notify(`Edição bloqueada: ${error instanceof Error ? error.message : 'erro desconhecido'}`); }
      finally { this.busy = false; }
      this.director?.resumeExploring(); if (!this.disposed) this.host.changed();
    } finally { this.applying = false; }
  }

  renderInspector(host: HTMLElement, id: string, evidenceOpen: boolean): void {
    const component = this.plan.components.find((item) => item.id === id); if (!component) { host.replaceChildren(); return; }
    const p = component.provenance, chip = (name: string, origin: keyof typeof ORIGIN_LABEL) => `<span class="u-chip ${CONFIRMED.has(origin) ? '' : 'u-chip--uncertain'}">${esc(name)} · ${esc(ORIGIN_LABEL[origin])}</span>`;
    const keys = shapes(component.geometry);
    const operators = [...new Set(keys.map((shape) => shape.operator))];
    const parent = component.parentId ? this.plan.components.find((item) => item.id === component.parentId)?.label ?? component.parentId : null;
    const pending = this.pending;
    const route = this.geometryReport?.decisions.find(decision => decision.componentId === id);
    const evidence = evidenceOpen ? `<ul class="uw-evidence" aria-label="Evidência"><li>${esc(p.evidence)}</li>${route ? `<li>Método de geometria: ${esc(route.used)} · ${esc(route.reason)}</li>` : '<li>Método de geometria: procedural_v2</li>'}${keys.map((shape) => `<li><code>${esc(shape.key)}</code> · ${esc(shape.operator)}<br><code>${esc(JSON.stringify(shape.parameters).slice(0, 400))}</code></li>`).join('')}</ul>` : '';
    const pendingHtml = pending ? `<div class="sp-pending" role="status" data-source="${pending.source}"><p class="u-label"><b>${pending.source === 'person' ? 'Pré-visualização' : pending.source === 'meta' ? 'Proposta da Meta · ainda não aplicada' : pending.source === 'solver' ? 'Proposta do solver estrutural (resultado de optimização) · ainda não aplicada' : 'Proposta da avaliação visual · ainda não aplicada'}</b></p><p class="u-label">${esc(pending.label)}: ${esc(pending.before)} → ${esc(pending.after)}</p>
        ${pending.needsAuthorization ? `<label class="sp-auth u-label"><input type="checkbox" data-auth ${this.authorised ? 'checked' : ''}> ${pending.source === 'person' ? 'Autorizo alterar um valor confirmado' : pending.source === 'solver' ? 'Autorizo aplicar esta proposta do solver' : 'Autorizo aplicar esta alteração proposta pela IA'}</label>` : ''}
        <div class="uw-inspector-actions"><button type="button" class="uw-link" data-apply ${this.busy ? 'disabled' : ''}>aplicar</button><button type="button" class="uw-link" data-cancel>cancelar</button></div></div>` : '';
    host.innerHTML = `${pendingHtml}<div class="uw-chips">${chip('geometria', p.geometry)}${chip('posição', p.transform)}${chip('material', p.material)}</div>
      <dl class="u-readout"><div><dt>Formas</dt><dd>${keys.length} · ${esc(operators.join(', '))}</dd></div><div><dt>Posição</dt><dd>${esc(fmt3(component.transform.position))}</dd></div><div><dt>Escala</dt><dd>${esc(fmt3(component.transform.scale))}</dd></div>${parent ? `<div><dt>Ligado a</dt><dd>${esc(parent)}</dd></div>` : ''}<div><dt>Unidades</dt><dd>${this.plan.units === 'm' ? 'metros (indicadas por si)' : 'sem unidade (escala desconhecida)'}</dd></div></dl>
      <details class="sp-edit" ${pending ? 'open' : ''}><summary class="u-label">Editar este componente</summary>
        <div class="uw-inspector-actions" data-el="spaceEdit" role="group" aria-label="Editar componente">
          ${[['scale-down', 'menor'], ['scale-up', 'maior'], ['x-', '−X'], ['x+', '+X'], ['y-', '−Y'], ['y+', '+Y'], ['z-', '−Z'], ['z+', '+Z']].map(([code, label]) => `<button type="button" class="uw-link" data-edit="${code}">${label}</button>`).join('')}
          <label class="uw-link sp-colour">cor <input type="color" data-edit-colour value="${esc((keys[0]?.material.color ?? '#888888').toLowerCase())}"></label>
        </div><p class="u-label sp-hint">Cada alteração é pré-visualizada primeiro e só se aplica quando carrega em «aplicar».</p></details>
      <div class="uw-inspector-actions"><button type="button" class="uw-link" data-undo ${this.canUndo ? '' : 'disabled'}>desfazer${this.history.length ? ` (${this.history.length})` : ''}</button></div>${evidence}`;
    host.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((button) => button.addEventListener('click', () => this.proposeEdit(button.dataset.edit!, button.textContent ?? button.dataset.edit!)));
    host.querySelector<HTMLInputElement>('[data-edit-colour]')?.addEventListener('change', (event) => this.proposeColour((event.target as HTMLInputElement).value));
    host.querySelector<HTMLInputElement>('[data-auth]')?.addEventListener('change', (event) => { this.authorised = (event.target as HTMLInputElement).checked; });
    host.querySelector('[data-apply]')?.addEventListener('click', () => void this.applyEdit());
    host.querySelector('[data-cancel]')?.addEventListener('click', () => this.cancelPending());
    host.querySelector('[data-undo]')?.addEventListener('click', () => void this.undo());
  }

  dispose(): void {
    this.disposed = true; this.pending = null; this.routed?.retire?.(); this.routed = null; this.cancelContinuation();
    this.director?.dispose(); this.director = null; this.release();
    this.releaseRetiredMaterials();
  }
}
