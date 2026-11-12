import { canonicalize, sha256Hex } from '../../core/canonical';
import type { SpatialOperationV2, SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import { runAgent, type AgentProposal, type AgentTurn, type AgentWorld, type ModelClient } from './agent';
import type { PartBox } from './collision';
import { compareExperiments, reproduce, runExperiment, type Comparison, type Experiment, type ExperimentSpec, type Reproduction } from './experiment';
import { proposeMechanism } from './inference';
import { solveMechanism, type JointValues, type SolveResult } from './kinematics';
import { emptyMechanism, isConfirmed, validateMechanism, withEvent, type Joint, type Mechanism, type PartPhysics, type Vec3 } from './mechanism';
import { allGeometry } from './plan-geometry';
import type { IntelligenceStore } from './store';

/**
 * The state and operations behind the Mechanism panel in /living: the mechanism of the open Space, the pose the person is exploring, experiments, and the agent. It owns no
 * rendering: poses go to the scene through `applyPoses` (presentation only), structural changes through `proposeStructural` (the Space's own preview -> authorisation ->
 * transaction), and everything it keeps is persisted by the Space's source hash.
 */
export type ControllerDeps = {
  plan: () => SpatialPlanV2; selectedId: () => string | null; store: IntelligenceStore; now?: () => number;
  applyPoses: (poses: Record<string, number[]>) => void; clearPoses: () => void;
  proposeStructural: (ops: SpatialOperationV2[], label: string, origin: 'person' | 'ai', evidence: string) => boolean;
  view?: AgentWorld['view']; onChange: () => void;
};
export type JointSpec = { kind: Joint['kind']; parent: string; child: string; axis: Vec3; origin?: Vec3; limits?: { min: number; max: number }; label?: string };
const unit = (v: Vec3): Vec3 => { const l = Math.hypot(...v); return l < 1e-9 ? [0, 1, 0] : [v[0] / l, v[1] / l, v[2] / l]; };

export class IntelligenceController {
  mechanism: Mechanism | null = null; q: JointValues = {}; last: SolveResult | null = null; experiments: Experiment[] = []; turns: AgentTurn[] = []; proposals: AgentProposal[] = []; notes: string[] = []; descriptors: Record<string, string> = {};
  private counter = 0;
  constructor(private readonly d: ControllerDeps) { this.restore(); }
  private get sha() { return this.d.plan().source.sha256; }
  private now() { return (this.d.now ?? Date.now)(); }
  planFingerprint(): string { return sha256Hex(canonicalize(this.d.plan())).slice(0, 32); }
  boxes(): PartBox[] { return allGeometry(this.d.plan()).flatMap((g) => (g.box ? [g.box] : [])); }
  private save() { if (this.mechanism) this.d.store.saveMechanism(this.mechanism); this.d.onChange(); }
  private restore() {
    const m = this.d.store.loadMechanism(this.sha); if (m.ok) { const ids = new Set(this.d.plan().components.map((c) => c.id)); if (m.value.parts.every((p) => ids.has(p))) this.mechanism = m.value; else this.notes.push('O mecanismo guardado refere componentes que já não existem neste Space: não foi carregado.'); } else if (m.reason === 'corrupt' || m.reason === 'foreign') this.notes.push(`O mecanismo guardado está ${m.reason === 'corrupt' ? 'corrompido' : 'associado a outro objecto'} e não foi carregado.`);
    const e = this.d.store.loadExperiments(this.sha); if (e.ok) this.experiments = e.value;
  }
  /** the Space's components changed (structural operation, undo): joints that touch a component that no longer exists go, new components join as unlinked parts, and it is said */
  syncWithPlan(): void {
    const m = this.mechanism; if (!m) return; const ids = this.d.plan().components.map((x) => x.id), gone = m.parts.filter((p) => !ids.includes(p)), born = ids.filter((id) => !m.parts.includes(id)); if (!gone.length && !born.length) return;
    const joints = m.joints.filter((j) => !gone.includes(j.parent) && !gone.includes(j.child)), kept = new Set(joints.map((j) => j.id)); const ground = ids.includes(m.ground) ? m.ground : ids[0]!;
    this.mechanism = withEvent({ ...m, ground, parts: ids, joints, couplings: m.couplings.filter((x) => kept.has(x.a) && kept.has(x.b)), physics: { ...m.physics, parts: m.physics.parts.filter((x) => ids.includes(x.partId)) } }, { kind: 'edited', target: 'structure', by: 'person', note: `estrutura do Space mudou: saíram ${gone.join(', ') || '—'}, entraram ${born.join(', ') || '—'}` }, this.now());
    if (m.joints.length !== joints.length) this.notes.push(`${m.joints.length - joints.length} junta(s) removida(s) porque o componente deixou de existir.`); this.q = {}; this.driven.clear(); this.last = null; this.d.clearPoses(); this.d.store.saveMechanism(this.mechanism);
  }
  hasMechanism(): boolean { return !!this.mechanism && (this.mechanism.joints.length > 0); }

  /** heuristic hypotheses from the geometry: extracted origin, every joint unconfirmed */
  proposeFromGeometry(ground?: string): number {
    const r = proposeMechanism(this.d.plan(), ground ? { ground } : {}); this.descriptors = r.descriptors; let m = r.mechanism; for (const j of m.joints) m = withEvent(m, { kind: 'proposed', target: j.id, by: 'extracted' }, this.now());
    this.mechanism = m; this.notes = r.notes; this.q = {}; this.last = null; this.d.clearPoses(); this.save(); return m.joints.length;
  }
  private ensure(): Mechanism { if (!this.mechanism) { const plan = this.d.plan(), ground = allGeometry(plan).sort((a, b) => (b.box ? b.box.half[0] * b.box.half[1] * b.box.half[2] : 0) - (a.box ? a.box.half[0] * a.box.half[1] * a.box.half[2] : 0))[0]?.id ?? plan.components[0]!.id; this.mechanism = emptyMechanism(this.sha, ground, plan.components.map((c) => c.id), plan.units); } return this.mechanism; }
  /** a joint the person states: origin 'user' (human-introduced), confirmed by construction */
  addJoint(spec: JointSpec): string {
    const m = this.ensure(), geo = allGeometry(this.d.plan()), a = geo.find((g) => g.id === spec.parent)?.box, b = geo.find((g) => g.id === spec.child)?.box;
    const origin = spec.origin ?? (a && b ? ([0, 1, 2].map((i) => (a.center[i]! + b.center[i]!) / 2) as Vec3) : ([0, 0, 0] as Vec3)), id = `u-${spec.parent}-${spec.child}-${++this.counter}`.slice(0, 48);
    const joint: Joint = { id, kind: spec.kind, parent: spec.parent, child: spec.child, origin, axis: unit(spec.axis), home: 0, ...(spec.limits ? { limits: spec.limits } : {}), ...(spec.label ? { label: spec.label } : {}), claim: { origin: 'user', evidence: 'Indicada por si neste Space.' } };
    // what the person states about a pair wins over a hypothesis about the same pair (a rigid guess and a hinge between the same two parts would contradict each other)
    const replaced = m.joints.filter((j) => j.claim.origin !== 'user' && ((j.parent === spec.parent && j.child === spec.child) || (j.parent === spec.child && j.child === spec.parent)));
    let next = validateMechanism({ ...m, joints: [...m.joints.filter((j) => !replaced.includes(j)), joint] }); for (const r of replaced) next = withEvent(next, { kind: 'rejected', target: r.id, by: 'person', note: `substituída pela junta ${id} indicada por si` }, this.now());
    if (!next.joints.some((j) => j.id !== id && [j.parent, j.child].includes(next.ground)) && ![spec.parent, spec.child].includes(next.ground)) { next = { ...next, ground: spec.parent }; this.notes.push(`Chão passou a ser «${spec.parent}»: era a única forma de a primeira junta ficar ligada ao chão. Pode mudar o chão no painel.`); }
    this.mechanism = withEvent(next, { kind: 'proposed', target: id, by: 'person' }, this.now()); this.save(); return id;
  }
  confirm(id: string) { if (this.mechanism) { this.mechanism = withEvent(this.mechanism, { kind: 'accepted', target: id, by: 'person' }, this.now()); this.save(); } }
  reject(id: string) { if (this.mechanism) { this.mechanism = withEvent({ ...this.mechanism, joints: this.mechanism.joints.filter((j) => j.id !== id), couplings: this.mechanism.couplings.filter((c) => c.a !== id && c.b !== id) }, { kind: 'rejected', target: id, by: 'person' }, this.now()); this.resolve({}); this.save(); } }
  setLimits(id: string, limits: { min: number; max: number } | null) { if (!this.mechanism) return; this.mechanism = withEvent(validateMechanism({ ...this.mechanism, joints: this.mechanism.joints.map((j) => (j.id === id ? (({ limits: _l, ...rest }) => (limits ? { ...rest, limits } : rest))(j) : j)) }), { kind: 'edited', target: id, by: 'person' }, this.now()); this.save(); }
  setGround(part: string) { if (this.mechanism && this.mechanism.parts.includes(part)) { this.mechanism = { ...this.mechanism, ground: part }; this.resolve({}); this.save(); } }
  isConfirmed(id: string) { return !!this.mechanism && isConfirmed(this.mechanism, id); }

  /** poses from joint values; the result is applied to the scene as a presentation-only pose */
  resolve(inputs: JointValues): SolveResult | null {
    if (!this.mechanism) return null; const r = solveMechanism(this.mechanism, { inputs, ...(Object.keys(this.q).length ? { guess: this.q } : {}) }); this.last = r;
    if (r.status === 'solved' || r.status === 'limit_violated') { this.q = r.q; this.d.applyPoses(r.poses); } this.d.onChange(); return r;
  }
  setJoint(id: string, value: number): SolveResult | null { const inputs: JointValues = {}; for (const j of this.mechanism?.joints ?? []) if (j.kind !== 'fixed' && j.actuated !== false && j.id in this.q && j.id !== id && this.driven.has(j.id)) inputs[j.id] = this.q[j.id]!; this.driven.add(id); inputs[id] = value; return this.resolve(inputs); }
  private driven = new Set<string>();
  reset() { this.q = {}; this.driven.clear(); this.last = null; this.d.clearPoses(); this.d.onChange(); }

  setPhysics(partId: string, massKg: number, hypothetical: boolean): void {
    const m = this.ensure(), box = this.boxes().find((b) => b.part === partId); if (!box || !(massKg > 0)) throw new Error('massa inválida ou parte sem dimensões');
    const [hx, hy, hz] = box.half, I: Vec3 = [(massKg / 3) * (hy * hy + hz * hz), (massKg / 3) * (hx * hx + hz * hz), (massKg / 3) * (hx * hx + hy * hy)];
    const p: PartPhysics = { partId, massKg, com: box.center, inertia: I, claim: { origin: 'user', evidence: `${hypothetical ? 'HIPOTÉTICO: ' : ''}massa indicada por si; centro de massa no centro da caixa e inércia de um paralelepípedo maciço homogéneo (aproximação declarada).` } };
    this.mechanism = { ...m, physics: { gravity: m.physics.gravity ?? [0, -9.81, 0], parts: [...m.physics.parts.filter((x) => x.partId !== partId), p] } }; this.save();
  }
  setUnitsMetres() { if (this.mechanism) { this.mechanism = { ...this.mechanism, units: 'm' }; this.save(); } }

  run(spec: ExperimentSpec, name: string): Experiment | null {
    if (!this.mechanism) return null; const e = runExperiment(this.mechanism, spec, { id: `exp-${this.now().toString(36)}-${++this.counter}`, name, planFingerprint: this.planFingerprint(), boxes: this.boxes(), createdAt: this.now() }); this.experiments = [...this.experiments, e]; this.d.store.saveExperiment(e); this.d.onChange(); return e;
  }
  reproduce(id: string): Reproduction | null { const e = this.experiments.find((x) => x.id === id); return e && this.mechanism ? reproduce(e, this.mechanism, this.planFingerprint(), this.boxes()) : null; }
  compare(a: string, b: string): Comparison | null { const x = this.experiments.find((e) => e.id === a), y = this.experiments.find((e) => e.id === b); return x && y ? compareExperiments(x, y) : null; }
  deleteExperiment(id: string) { this.d.store.deleteExperiment(this.sha, id); this.experiments = this.experiments.filter((e) => e.id !== id); this.d.onChange(); }

  world(): AgentWorld { return { plan: this.d.plan, planFingerprint: () => this.planFingerprint(), mechanism: () => this.mechanism, boxes: () => this.boxes(), selectedId: this.d.selectedId, descriptors: () => this.descriptors, ...(this.d.view ? { view: this.d.view } : {}) }; }
  async ask(question: string, client: ModelClient, signal?: AbortSignal): Promise<AgentTurn> { const t = await runAgent(question, this.world(), client, signal ? { signal } : {}); this.turns = [...this.turns, t]; this.proposals = [...this.proposals, ...t.proposals]; this.d.onChange(); return t; }
  /** the person accepts a proposal: the AI origin stays in the claim, the acceptance is a distinct 'accepted' event by the person */
  acceptProposal(id: string): boolean {
    const p = this.proposals.find((x) => x.id === id && x.status === 'pending'); if (!p) return false;
    if (p.kind === 'joint') { const m = this.ensure(), j = p.payload as Joint; this.mechanism = withEvent(withEvent(validateMechanism({ ...m, joints: [...m.joints.filter((x) => x.id !== j.id), j] }), { kind: 'proposed', target: j.id, by: 'ai' }, this.now()), { kind: 'accepted', target: j.id, by: 'person', note: `proposta ${p.id} de ${p.model}` }, this.now()); this.save(); }
    else if (p.kind === 'pose') { this.resolve((p.payload as { inputs: JointValues }).inputs); }
    else if (!this.d.proposeStructural([p.payload as SpatialOperationV2], `Proposta da IA: ${p.summary}`, 'ai', `Proposta ${p.id} de ${p.model}: ${p.rationale}`)) return false;
    this.proposals = this.proposals.map((x) => (x.id === id ? { ...x, status: 'accepted' as never } : x)); this.d.onChange(); return true;
  }
  rejectProposal(id: string) { this.proposals = this.proposals.map((x) => (x.id === id ? { ...x, status: 'rejected' as never } : x)); this.d.onChange(); }
}
