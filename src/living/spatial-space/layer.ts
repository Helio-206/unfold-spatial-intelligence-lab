import { Box3, Color, Group, Mesh, Raycaster, type Camera, type Material, type Vector2 } from 'three';
import { analyzeAssembly, describeDefect, refineAssembly, type AssemblyAnalysis } from '../../universal-spatial/assembly-analysis';
import { applySpatialOperationV2, type GeometryNodeV2, type SpatialOperationV2, type SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import { collectWorldPoints, heroAzimuth, normalizeForPresentation } from '../../universal-spatial/framing';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../../universal-spatial/geometry-compiler-v2';
import type { SpaceLayer } from '../workspace-design/space-port';
import { createPresentationDirector, type CameraCue, type PresentationDirector, type PresentationState, type ViewContext } from '../spatial-presentation';

/** Presentation size of the longest side, in stage units. The plan keeps its own units; the scale lives on a wrapper and is never written back. */
export const SPACE_PRESENTATION_SIZE = 5;
const ORIGIN_LABEL = { observed: 'observado', inferred: 'inferido', user_provided: 'introduzido por si', design_approximation: 'aproximação de desenho', unknown: 'desconhecido' } as const;
const CONFIRMED = new Set(['observed', 'user_provided']);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt3 = (v: readonly number[]) => `[${v.map((n) => n.toFixed(3)).join(', ')}]`;

type Pending = { label: string; before: string; after: string; operations: SpatialOperationV2[]; needsAuthorization: boolean; source: 'person' | 'meta' | 'meta-visual' };
type Shape = Extract<GeometryNodeV2, { type: 'shape' }>;
export type PendingEdit = Pending;
/** Mirrors edits to the server session so that revisions agree. Throws when the server cannot confirm; the layer then carries on locally and says so. */
export type LayerSync = {
  apply(operation: SpatialOperationV2): Promise<SpatialPlanV2>;
  undo(): Promise<SpatialPlanV2>;
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
  private busy = false;
  private director: PresentationDirector | null = null;
  presentation: PresentationState | null = null;
  private pending: Pending | null = null;
  private analysisCache: AssemblyAnalysis | null = null;
  private selected: string | null = null;
  private isolated: string | null = null;
  private readonly emissive = new WeakMap<Material, { color: Color; intensity: number }>();
  private readonly raycaster = new Raycaster();
  private authorised = false;
  stats: ReturnType<typeof compileSpatialPlanV2>['stats'];

  constructor(plan: SpatialPlanV2, private readonly host: SpaceLayerHost) {
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
  get pendingEdit(): Pending | null { return this.pending; }
  authorise(value: boolean): void { this.authorised = value; }
  get canUndo(): boolean { return this.history.length > 0 && !this.busy; }
  get isBusy(): boolean { return this.busy; }
  get synced(): boolean { return this.sync !== null; }
  attachSync(sync: LayerSync | null): void { this.sync = sync; }
  get isExploded(): boolean { return (this.director?.state.exploded ?? 0) > 0.5; }
  /** Called from the workspace frame loop with the real elapsed time; true while another frame is needed. */
  update(dtMs: number): boolean { return this.director?.update(dtMs) ?? false; }
  get editCount(): number { return this.history.length; }

  private build(): ReturnType<typeof compileSpatialPlanV2>['stats'] {
    this.release();
    const compiled = compileSpatialPlanV2(this.plan);
    this.compiled = compiled.root;
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
    return compiled.stats;
  }

  private release(): void {
    if (this.wrapper) this.root.remove(this.wrapper);
    if (this.compiled) disposeCompiledSpatialPlan(this.compiled);
    this.wrapper = null; this.compiled = null;
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
  private async commit(operations: SpatialOperationV2[], provenance: { origin: 'user_provided' | 'inferred'; evidence: string }, localPlan?: SpatialPlanV2): Promise<void> {
    const before = this.plan; let next = before;
    if (this.sync) {
      try { for (const operation of operations) next = await this.sync.apply(operation); }
      catch (error) { this.sync = null; this.host.syncLost?.(error instanceof Error ? error.message : 'sessão do servidor indisponível'); next = localPlan ?? this.applyLocal(before, operations, provenance); }
    } else next = localPlan ?? this.applyLocal(before, operations, provenance);
    this.history.push({ plan: before, ops: operations.length }); this.plan = next; this.pending = null; this.authorised = false; this.stats = this.build();
  }
  private applyLocal(plan: SpatialPlanV2, operations: SpatialOperationV2[], provenance: { origin: 'user_provided' | 'inferred'; evidence: string }): SpatialPlanV2 {
    let next = plan; for (const operation of operations) next = applySpatialOperationV2(next, operation, provenance); return next;
  }

  /** The bounded solver proposes `set-transform` operations only; they are marked inferred and can be undone. */
  async closeGaps(): Promise<{ applied: number; iterations: number }> {
    if (this.busy) return { applied: 0, iterations: 0 };
    const result = refineAssembly(this.plan);
    if (!result.applied.length) return { applied: 0, iterations: result.iterations };
    this.busy = true; this.director?.enterEditing();
    try { await this.commit(result.applied.map((a) => a.operation), { origin: 'inferred', evidence: 'Assembly solver proposed a position that closes a gap (bounding boxes, not a contact proof).' }, this.sync ? undefined : result.plan); }
    finally { this.busy = false; }
    this.director?.resumeExploring(); this.host.changed();
    return { applied: result.applied.length, iterations: result.iterations };
  }
  async undo(): Promise<boolean> {
    const previous = this.history.pop(); if (!previous || this.busy) { if (previous) this.history.push(previous); return false; }
    this.busy = true; this.director?.enterEditing();
    try {
      if (this.sync) { try { let restored = this.plan; for (let i = 0; i < previous.ops; i++) restored = await this.sync.undo(); this.plan = restored; } catch (error) { this.sync = null; this.host.syncLost?.(error instanceof Error ? error.message : 'sessão do servidor indisponível'); this.plan = previous.plan; } }
      else this.plan = previous.plan;
      this.pending = null; this.stats = this.build();
    } finally { this.busy = false; }
    this.director?.resumeExploring(); this.host.changed(); return true;
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
  cancelPending(): void { this.pending = null; this.authorised = false; this.host.changed(); }
  get selectedId(): string | null { return this.selected; }

  async applyEdit(): Promise<void> {
    const pending = this.pending; if (!pending || this.busy) return;
    if (pending.needsAuthorization && !this.authorised) { this.host.notify(pending.source === 'person' ? 'Esta edição toca num valor observado ou confirmado: marque a autorização primeiro.' : 'Uma alteração proposta pela IA só se aplica depois de a autorizar: marque a autorização.'); return; }
    this.busy = true; this.director?.enterEditing();
    try {
      const evidence = pending.source === 'person' ? 'Editado por uma pessoa no workspace (afirmado pelo cliente, sem identidade verificada).' : 'Proposta por Muse Spark (hipótese) e autorizada por uma pessoa no workspace (afirmado pelo cliente, sem identidade verificada).';
      await this.commit(pending.operations, { origin: 'user_provided', evidence });
      this.host.notify(`Aplicado: ${pending.label}.${this.sync ? '' : ' Edição só local: a sessão do servidor não a conhece.'}`);
    } catch (error) { this.pending = null; this.host.notify(`Edição bloqueada: ${error instanceof Error ? error.message : 'erro desconhecido'}`); }
    finally { this.busy = false; }
    this.director?.resumeExploring(); this.host.changed();
  }

  renderInspector(host: HTMLElement, id: string, evidenceOpen: boolean): void {
    const component = this.plan.components.find((item) => item.id === id); if (!component) { host.replaceChildren(); return; }
    const p = component.provenance, chip = (name: string, origin: keyof typeof ORIGIN_LABEL) => `<span class="u-chip ${CONFIRMED.has(origin) ? '' : 'u-chip--uncertain'}">${esc(name)} · ${esc(ORIGIN_LABEL[origin])}</span>`;
    const keys = shapes(component.geometry);
    const operators = [...new Set(keys.map((shape) => shape.operator))];
    const parent = component.parentId ? this.plan.components.find((item) => item.id === component.parentId)?.label ?? component.parentId : null;
    const pending = this.pending;
    const evidence = evidenceOpen ? `<ul class="uw-evidence" aria-label="Evidência"><li>${esc(p.evidence)}</li>${keys.map((shape) => `<li><code>${esc(shape.key)}</code> · ${esc(shape.operator)}<br><code>${esc(JSON.stringify(shape.parameters).slice(0, 400))}</code></li>`).join('')}</ul>` : '';
    const pendingHtml = pending ? `<div class="sp-pending" role="status" data-source="${pending.source}"><p class="u-label"><b>${pending.source === 'person' ? 'Pré-visualização' : pending.source === 'meta' ? 'Proposta da Meta · ainda não aplicada' : 'Proposta da avaliação visual · ainda não aplicada'}</b></p><p class="u-label">${esc(pending.label)}: ${esc(pending.before)} → ${esc(pending.after)}</p>
        ${pending.needsAuthorization ? `<label class="sp-auth u-label"><input type="checkbox" data-auth ${this.authorised ? 'checked' : ''}> ${pending.source === 'person' ? 'Autorizo alterar um valor confirmado' : 'Autorizo aplicar esta alteração proposta pela IA'}</label>` : ''}
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
    this.director?.dispose(); this.director = null; this.release();
  }
}
