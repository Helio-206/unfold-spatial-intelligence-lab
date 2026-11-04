import { Box3, Color, Group, Mesh, Raycaster, type Camera, type Material, type Object3D, type Vector2 } from 'three';
import { analyzeAssembly, describeDefect, refineAssembly, type AssemblyAnalysis } from '../../universal-spatial/assembly-analysis';
import { applySpatialOperationV2, type GeometryNodeV2, type SpatialOperationV2, type SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import { collectWorldPoints, heroAzimuth, normalizeForPresentation } from '../../universal-spatial/framing';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../../universal-spatial/geometry-compiler-v2';
import type { SpaceLayer } from '../workspace-design/space-port';

/** Presentation size of the longest side, in stage units. The plan keeps its own units; the scale lives on a wrapper and is never written back. */
export const SPACE_PRESENTATION_SIZE = 5;
const ORIGIN_LABEL = { observed: 'observado', inferred: 'inferido', user_provided: 'introduzido por si', design_approximation: 'aproximação de desenho', unknown: 'desconhecido' } as const;
const CONFIRMED = new Set(['observed', 'user_provided']);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt3 = (v: readonly number[]) => `[${v.map((n) => n.toFixed(3)).join(', ')}]`;

type Pending = { label: string; before: string; after: string; operations: SpatialOperationV2[]; needsAuthorization: boolean };
type Shape = Extract<GeometryNodeV2, { type: 'shape' }>;
export type PendingEdit = Pending;
export type SpaceLayerHost = {
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
  private readonly history: SpatialPlanV2[] = [];
  private pending: Pending | null = null;
  private analysisCache: AssemblyAnalysis | null = null;
  private selected: string | null = null;
  private isolated: string | null = null;
  private readonly emissive = new WeakMap<Material, { color: Color; intensity: number }>();
  private readonly raycaster = new Raycaster();
  private revealTimer = 0;
  private disposed = false;
  private authorised = false;
  stats: ReturnType<typeof compileSpatialPlanV2>['stats'];

  constructor(plan: SpatialPlanV2, private readonly host: SpaceLayerHost) {
    this.root.name = 'space-layer';
    this.plan = plan;
    this.stats = this.build();
  }

  get currentPlan(): SpatialPlanV2 { return this.plan; }
  get pendingEdit(): Pending | null { return this.pending; }
  authorise(value: boolean): void { this.authorised = value; }
  get canUndo(): boolean { return this.history.length > 0; }
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
    this.selected = id; this.applyPaint(); this.host.redraw();
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

  /** Components appear one by one, in plan order: a presentation cue, not motion of the object. Instant when `immediate`. */
  reveal(immediate: boolean, stepMs = 140): void {
    clearTimeout(this.revealTimer);
    const roots: Object3D[] = []; this.wrapper?.traverse((object) => { if (object.userData.spatialComponentRoot) roots.push(object); });
    if (immediate) { for (const object of roots) object.visible = true; this.host.redraw(); return; }
    for (const object of roots) object.visible = false;
    let index = 0;
    const next = () => {
      if (this.disposed) return;
      const object = roots[index++]; if (object) object.visible = true;
      this.host.redraw();
      if (index < roots.length) this.revealTimer = window.setTimeout(next, stepMs); else this.applyPaint();
    };
    next();
  }

  // ------------------------------------------------------------------------------------------------ analysis
  analysis(): AssemblyAnalysis | null {
    if (!this.analysisCache) { try { this.analysisCache = analyzeAssembly(this.plan); } catch { return null; } }
    return this.analysisCache;
  }
  assemblyLines(): string[] { const a = this.analysis(); return a ? a.defects.map(describeDefect) : []; }
  get closableGaps(): boolean { return !!this.analysis()?.defects.some((defect) => defect.kind === 'floating' && !('blockedBy' in defect && defect.blockedBy)); }

  /** The bounded solver proposes `set-transform` operations only; they are marked inferred and can be undone. */
  closeGaps(): { applied: number; iterations: number } {
    const result = refineAssembly(this.plan);
    if (!result.applied.length) return { applied: 0, iterations: result.iterations };
    this.history.push(this.plan); this.plan = result.plan; this.stats = this.build(); this.host.changed();
    return { applied: result.applied.length, iterations: result.iterations };
  }
  undo(): boolean {
    const previous = this.history.pop(); if (!previous) return false;
    this.plan = previous; this.pending = null; this.stats = this.build(); this.host.changed(); return true;
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
    this.pending = { label, before, after, operations, needsAuthorization: CONFIRMED.has(component.provenance.transform) };
    this.authorised = false; this.host.changed();
  }
  proposeColour(colour: string): void {
    const component = this.plan.components.find((item) => item.id === this.selected); if (!component) return;
    const keys = shapes(component.geometry); if (!keys.length) return;
    const stamp = Date.now().toString(36);
    this.pending = {
      label: 'Cor', before: keys[0]!.material.color, after: colour, needsAuthorization: CONFIRMED.has(component.provenance.material),
      operations: keys.map((shape, index) => ({ contract: 'unfold.spatial-operation.v2' as const, operationId: `edit-colour-${stamp}-${index}`.slice(0, 80), kind: 'set-material' as const, componentId: component.id, nodeKey: shape.key, value: { ...shape.material, color: colour } })),
    };
    this.authorised = false; this.host.changed();
  }
  applyEdit(): void {
    const pending = this.pending; if (!pending) return;
    if (pending.needsAuthorization && !this.authorised) { this.host.notify('Esta edição toca num valor observado ou confirmado: marque a autorização primeiro.'); return; }
    try {
      let next = this.plan;
      for (const operation of pending.operations) next = applySpatialOperationV2(next, operation, { origin: 'user_provided', evidence: 'Editado por uma pessoa no workspace (afirmado pelo cliente, sem identidade verificada).' });
      this.history.push(this.plan); this.plan = next; this.pending = null; this.authorised = false; this.stats = this.build();
      this.host.notify(`Aplicado: ${pending.label}. Edição local; a sessão do servidor não é actualizada.`); this.host.changed();
    } catch (error) { this.host.notify(`Edição bloqueada: ${error instanceof Error ? error.message : 'erro desconhecido'}`); }
  }

  renderInspector(host: HTMLElement, id: string, evidenceOpen: boolean): void {
    const component = this.plan.components.find((item) => item.id === id); if (!component) { host.replaceChildren(); return; }
    const p = component.provenance, chip = (name: string, origin: keyof typeof ORIGIN_LABEL) => `<span class="u-chip ${CONFIRMED.has(origin) ? '' : 'u-chip--uncertain'}">${esc(name)} · ${esc(ORIGIN_LABEL[origin])}</span>`;
    const keys = shapes(component.geometry);
    const operators = [...new Set(keys.map((shape) => shape.operator))];
    const parent = component.parentId ? this.plan.components.find((item) => item.id === component.parentId)?.label ?? component.parentId : null;
    const pending = this.pending;
    const evidence = evidenceOpen ? `<ul class="uw-evidence" aria-label="Evidência"><li>${esc(p.evidence)}</li>${keys.map((shape) => `<li><code>${esc(shape.key)}</code> · ${esc(shape.operator)}<br><code>${esc(JSON.stringify(shape.parameters).slice(0, 400))}</code></li>`).join('')}</ul>` : '';
    host.innerHTML = `<div class="uw-chips">${chip('geometria', p.geometry)}${chip('posição', p.transform)}${chip('material', p.material)}</div>
      <dl class="u-readout"><div><dt>Formas</dt><dd>${keys.length} · ${esc(operators.join(', '))}</dd></div><div><dt>Posição</dt><dd>${esc(fmt3(component.transform.position))}</dd></div><div><dt>Escala</dt><dd>${esc(fmt3(component.transform.scale))}</dd></div>${parent ? `<div><dt>Ligado a</dt><dd>${esc(parent)}</dd></div>` : ''}<div><dt>Unidades</dt><dd>${this.plan.units === 'm' ? 'metros (indicadas por si)' : 'sem unidade (escala desconhecida)'}</dd></div></dl>
      <div class="uw-inspector-actions" data-el="spaceEdit" role="group" aria-label="Editar componente">
        ${[['scale-down', 'menor'], ['scale-up', 'maior'], ['x-', '−X'], ['x+', '+X'], ['y-', '−Y'], ['y+', '+Y'], ['z-', '−Z'], ['z+', '+Z']].map(([code, label]) => `<button type="button" class="uw-link" data-edit="${code}">${label}</button>`).join('')}
        <label class="uw-link sp-colour">cor <input type="color" data-edit-colour value="${esc((keys[0]?.material.color ?? '#888888').toLowerCase())}"></label>
      </div>
      ${pending ? `<div class="sp-pending" role="status"><p class="u-label">${esc(pending.label)}: ${esc(pending.before)} → ${esc(pending.after)}${pending.needsAuthorization ? ' · toca num valor observado ou confirmado' : ''}</p>
        ${pending.needsAuthorization ? `<label class="sp-auth u-label"><input type="checkbox" data-auth ${this.authorised ? 'checked' : ''}> Autorizo alterar um valor confirmado</label>` : ''}
        <div class="uw-inspector-actions"><button type="button" class="uw-link" data-apply>aplicar</button><button type="button" class="uw-link" data-cancel>cancelar</button></div></div>` : ''}
      <div class="uw-inspector-actions"><button type="button" class="uw-link" data-undo ${this.canUndo ? '' : 'disabled'}>desfazer${this.canUndo ? ` (${this.history.length})` : ''}</button></div>${evidence}`;
    host.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach((button) => button.addEventListener('click', () => this.proposeEdit(button.dataset.edit!, button.textContent ?? button.dataset.edit!)));
    host.querySelector<HTMLInputElement>('[data-edit-colour]')?.addEventListener('change', (event) => this.proposeColour((event.target as HTMLInputElement).value));
    host.querySelector<HTMLInputElement>('[data-auth]')?.addEventListener('change', (event) => { this.authorised = (event.target as HTMLInputElement).checked; });
    host.querySelector('[data-apply]')?.addEventListener('click', () => this.applyEdit());
    host.querySelector('[data-cancel]')?.addEventListener('click', () => { this.pending = null; this.authorised = false; this.host.changed(); });
    host.querySelector('[data-undo]')?.addEventListener('click', () => this.undo());
  }

  dispose(): void {
    this.disposed = true; clearTimeout(this.revealTimer); this.release();
  }
}
