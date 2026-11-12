import { applySpatialOperationV2, type SpatialOperationV2, type SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import { checkCollisions, type PartBox } from './collision';
import { explainBlocked, explainEffect, explainMechanism, jointCategory, type Category, type Statement } from './explain';
import { runExperiment, type Experiment, type ExperimentSpec } from './experiment';
import { analyseFunction } from './inference';
import { solveMechanism, type JointValues } from './kinematics';
import { isConfirmed, validateMechanism, type Joint, type Mechanism } from './mechanism';
import { AGENT_LIMITS, AGENT_REQUEST_CONTRACT, type ModelReply, type ToolResultWire, type ToolSpec } from './agent-protocol';

/**
 * The Spatial Intelligence Agent runtime. A model (or the deterministic simulation) may ask for typed tools; every tool either READS the Space, COMPUTES with the engines, creates
 * a PROPOSAL, or changes the PRESENTATION. None can change the object's geometry, mechanism or physical state: proposals wait for a person (preview -> authorisation -> commit through
 * the existing channels). The answer's statements must cite tool results; a statement whose claim is not backed by what the cited results contain is downgraded to
 * "AI inference" and flagged, so a fluent answer cannot smuggle in numbers or facts the engines never produced.
 */
export interface AgentWorld {
  plan(): SpatialPlanV2; planFingerprint(): string; mechanism(): Mechanism | null; boxes(): PartBox[]; selectedId(): string | null; descriptors(): Record<string, string>;
  /** presentation only: isolate / explode / transparency / reset. Never touches geometry or the mechanism. */
  view?(action: 'isolate' | 'explode' | 'transparent' | 'reset', ids: string[]): boolean;
}
export type AgentProposal = { id: string; kind: 'joint' | 'pose' | 'structural'; summary: string; rationale: string; payload: unknown; model: string; status: 'pending' };
export type GroundedStatement = { text: string; declared: Category; category: Category; refs: string[]; grounded: boolean; reason?: string };
export type AgentTurn = { question: string; source: 'muse-spark' | 'simulated'; model: string; results: ToolResultWire[]; statements: GroundedStatement[]; limitations: string[]; proposals: AgentProposal[]; modelCalls: number; errors: string[]; stoppedBecause: 'answered' | 'step_limit' | 'error' };
export interface ModelClient { readonly source: 'muse-spark' | 'simulated'; readonly model: string; complete(input: { question: string; step: number; context: unknown; toolResults: ToolResultWire[]; tools: ToolSpec[] }, signal?: AbortSignal): Promise<ModelReply>; }

type ArgType = 'string' | 'number' | 'component' | 'joint' | 'numbers' | 'any';
type ToolDef = ToolSpec & { argTypes: Record<string, { type: ArgType; optional?: boolean }>; run(args: Record<string, unknown>, ctx: ToolContext): { data: unknown; deterministic: boolean; category: Category };};
type ToolContext = { world: AgentWorld; proposals: AgentProposal[]; model: string; nextProposal: () => string };

const need = (world: AgentWorld): Mechanism => { const m = world.mechanism(); if (!m) throw new Error('Este Space ainda não tem um mecanismo definido (juntas). Use «Propor mecanismo» ou indique as juntas.'); return m; };
const numbers = (v: unknown): JointValues => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('inputs deve ser um objecto {junta: valor}'); const out: JointValues = {}; for (const [k, x] of Object.entries(v)) { if (typeof x !== 'number' || !Number.isFinite(x)) throw new Error(`valor inválido para ${k}`); out[k] = x; } return out; };
const stmts = (s: Statement[]) => s.map((x) => ({ id: x.id, category: x.category, text: x.text, refs: x.refs }));

export const TOOLS: ToolDef[] = [
  { name: 'list_components', kind: 'read', description: 'Lista os componentes do Space com a origem do que se sabe de cada um.', args: {}, argTypes: {}, run: (_a, { world }) => ({ deterministic: true, category: 'observed', data: world.plan().components.map((c) => ({ id: c.id, label: c.label, parentId: c.parentId, origem: { geometria: c.provenance.geometry, posição: c.provenance.transform, material: c.provenance.material }, descritor: world.descriptors()[c.id] ?? null })) }) },
  { name: 'describe_component', kind: 'read', description: 'Descreve um componente: proveniência, formas, posição, relações e papel no mecanismo.', args: { id: 'id do componente' }, argTypes: { id: { type: 'component' } }, run: (a, { world }) => {
    const plan = world.plan(), c = plan.components.find((x) => x.id === a.id)!, m = world.mechanism(), f = m ? analyseFunction(m) : null;
    return { deterministic: true, category: 'observed', data: { id: c.id, label: c.label, proveniência: c.provenance, posição: c.transform.position, descritor: world.descriptors()[c.id] ?? null, relações: plan.relations.filter((r) => r.fromId === c.id || r.toId === c.id).map((r) => ({ de: r.fromId, para: r.toId, tipo: r.kind, origem: r.origin })), juntas: (m?.joints ?? []).filter((j) => j.parent === c.id || j.child === c.id).map((j) => ({ id: j.id, tipo: j.kind, entre: [j.parent, j.child], categoria: jointCategory(m!, j.id) })), papel: f ? (f.movableParts.includes(c.id) ? 'móvel (se as juntas se confirmarem)' : f.fixedParts.includes(c.id) ? 'fixo (rigidez assumida)' : c.id === m!.ground ? 'chão' : 'sem ligação') : 'mecanismo não definido' } }; } },
  { name: 'get_mechanism', kind: 'read', description: 'Devolve as juntas, acoplamentos, o chão e a origem/confirmação de cada junta.', args: {}, argTypes: {}, run: (_a, { world }) => { const m = need(world); return { deterministic: true, category: 'observed', data: { chão: m.ground, juntas: m.joints.map((j) => ({ id: j.id, tipo: j.kind, pai: j.parent, filho: j.child, eixo: j.axis, limites: j.limits ?? null, origem: j.claim.origin, confirmada: isConfirmed(m, j.id), evidência: j.claim.evidence })), acoplamentos: m.couplings.map((c) => ({ id: c.id, a: c.a, b: c.b, razão: c.ratio })), unidades: m.units, físicaIndicada: m.physics.parts.map((p) => p.partId) } }; } },
  { name: 'explain_mechanism', kind: 'compute', description: 'Explica o mecanismo: cada junta com a sua categoria, graus de liberdade (Grübler e rank numérico) e análise funcional (partes fixas/móveis, dependências, conjuntos accionáveis).', args: {}, argTypes: {}, run: (_a, { world }) => { const m = need(world), f = analyseFunction(m); return { deterministic: true, category: 'computed', data: { declarações: stmts(explainMechanism(m, world.descriptors())), partesFixas: f.fixedParts, partesMóveis: f.movableParts, dependências: f.dependencies, conjuntosAccionáveis: f.actuatorSets, mobilidade: f.mobility } }; } },
  { name: 'solve_pose', kind: 'compute', description: 'Resolve a posição do mecanismo para valores de junta dados ({junta: valor}; radianos ou unidades de comprimento).', args: { inputs: 'objecto {id da junta: valor}' }, argTypes: { inputs: { type: 'numbers' } }, run: (a, { world }) => { const m = need(world), r = solveMechanism(m, { inputs: numbers(a.inputs) }); return { deterministic: true, category: 'computed', data: { estado: r.status, q: r.q, resíduo: r.residual, graus_de_liberdade: r.mobility.numerical, violações: r.violations, singular: r.singular, notas: r.notes, assenta_em: r.basis } }; } },
  { name: 'explain_blocked', kind: 'compute', description: 'Tenta mover uma junta até um valor e diz onde e porque pára (limite, laço que não fecha, colisão entre caixas).', args: { joint: 'id da junta', target: 'valor alvo' }, argTypes: { joint: { type: 'joint' }, target: { type: 'number' } }, run: (a, { world }) => { const r = explainBlocked(need(world), String(a.joint), Number(a.target), { boxes: world.boxes() }); return { deterministic: true, category: 'computed', data: { causa: r.cause, alcançado: r.reachedValue, tentado: r.attemptedValue, declarações: stmts(r.statements) } }; } },
  { name: 'explain_effect', kind: 'compute', description: 'Calcula o que acontece às outras juntas e partes se uma junta passar a ter um valor.', args: { joint: 'id da junta', value: 'novo valor' }, argTypes: { joint: { type: 'joint' }, value: { type: 'number' } }, run: (a, { world }) => { const r = explainEffect(need(world), String(a.joint), Number(a.value)); return { deterministic: true, category: 'computed', data: { estado: r.status, declarações: stmts(r.statements) } }; } },
  { name: 'check_collisions', kind: 'compute', description: 'Verifica colisões entre caixas orientadas das partes numa configuração.', args: { inputs: 'objecto {junta: valor}' }, argTypes: { inputs: { type: 'numbers' } }, run: (a, { world }) => { const m = need(world), r = solveMechanism(m, { inputs: numbers(a.inputs) }), c = checkCollisions(m, r.q, world.boxes()); return { deterministic: true, category: 'computed', data: { estado: r.status, colisões: c.collisions.map((x) => ({ a: x.a, b: x.b, penetração: x.penetration })), método: c.method, limitação: c.limitation } }; } },
  { name: 'run_experiment', kind: 'compute', description: 'Executa uma experiência reprodutível (pose, varrimento ou dinâmica) sem a guardar; a dinâmica exige parâmetros físicos.', args: { spec: 'objecto {kind:"pose"|"sweep"|"dynamics", ...}' }, argTypes: { spec: { type: 'any' } }, run: (a, { world }) => { const e: Experiment = runExperiment(need(world), a.spec as ExperimentSpec, { id: 'agent-run', name: 'agente', planFingerprint: world.planFingerprint(), boxes: world.boxes() }); return { deterministic: true, category: 'computed', data: { estado: e.result.status, resumo: e.result.summary, violações: e.result.violations, colisões: e.result.collisions, em_falta: e.result.missing, hipotética: e.hypothetical, limitações: e.limitations, hash: e.resultHash } }; } },
  { name: 'propose_joint', kind: 'propose', description: 'Propõe (não aplica) uma junta. A pessoa aceita ou rejeita; a proposta guarda a origem «ai».', args: { kind: 'revolute|prismatic|fixed', parent: 'componente', child: 'componente', origin: '[x,y,z] ponto no eixo', axis: '[x,y,z]', rationale: 'porquê' }, argTypes: { kind: { type: 'string' }, parent: { type: 'component' }, child: { type: 'component' }, origin: { type: 'any' }, axis: { type: 'any' }, rationale: { type: 'string' } }, run: (a, ctx) => {
    const m = need(ctx.world), joint: Joint = { id: `ai-${String(a.parent)}-${String(a.child)}`.slice(0, 48), kind: a.kind as Joint['kind'], parent: String(a.parent), child: String(a.child), origin: a.origin as Joint['origin'], axis: a.axis as Joint['axis'], home: 0, claim: { origin: 'ai', evidence: String(a.rationale).slice(0, 380), model: ctx.model, proposalId: ctx.nextProposal() } };
    validateMechanism({ ...m, joints: [...m.joints, joint] }); const id = joint.claim.proposalId!; ctx.proposals.push({ id, kind: 'joint', summary: `${joint.kind} entre ${joint.parent} e ${joint.child}`, rationale: joint.claim.evidence, payload: joint, model: ctx.model, status: 'pending' }); return { deterministic: false, category: 'ai', data: { proposta: id, estado: 'pendente: nada foi aplicado' } }; } },
  { name: 'propose_pose', kind: 'propose', description: 'Propõe uma pose (valores de junta) para pré-visualizar na cena; só se aplica depois de autorizada.', args: { inputs: 'objecto {junta: valor}', rationale: 'porquê' }, argTypes: { inputs: { type: 'numbers' }, rationale: { type: 'string', optional: true } }, run: (a, ctx) => {
    const m = need(ctx.world), r = solveMechanism(m, { inputs: numbers(a.inputs) }), id = ctx.nextProposal(); ctx.proposals.push({ id, kind: 'pose', summary: `pose ${JSON.stringify(a.inputs)} — ${r.status}`, rationale: String(a.rationale ?? ''), payload: { inputs: a.inputs, status: r.status }, model: ctx.model, status: 'pending' }); return { deterministic: true, category: 'computed', data: { proposta: id, estadoCalculado: r.status, violações: r.violations, nota: 'a pose fica em pré-visualização só depois de autorizada' } }; } },
  { name: 'propose_structural', kind: 'propose', description: 'Propõe uma operação estrutural (add-component, remove-component, merge-components, split-component) validada num plano de cópia; nada é aplicado.', args: { operation: 'objecto SpatialOperationV2 sem contract/operationId', rationale: 'porquê' }, argTypes: { operation: { type: 'any' }, rationale: { type: 'string' } }, run: (a, ctx) => {
    const op = { contract: 'unfold.spatial-operation.v2', operationId: `agent-${ctx.nextProposal()}`, nodeKey: null, ...(a.operation as object) } as SpatialOperationV2; applySpatialOperationV2(ctx.world.plan(), op, { origin: 'inferred', evidence: 'pré-validação da proposta do agente' }); const id = ctx.nextProposal(); ctx.proposals.push({ id, kind: 'structural', summary: `${op.kind} ${op.componentId}`, rationale: String(a.rationale).slice(0, 380), payload: op, model: ctx.model, status: 'pending' }); return { deterministic: true, category: 'computed', data: { proposta: id, validadaNumaCópia: true, nota: 'nada foi aplicado' } }; } },
  { name: 'set_view', kind: 'view', description: 'Altera só a apresentação: isolar componentes, vista explodida, transparência, repor. Não toca na geometria nem no mecanismo.', args: { action: 'isolate|explode|transparent|reset', ids: 'ids dos componentes' }, argTypes: { action: { type: 'string' }, ids: { type: 'any', optional: true } }, run: (a, { world }) => { const ids = Array.isArray(a.ids) ? (a.ids as unknown[]).map(String) : []; if (!['isolate', 'explode', 'transparent', 'reset'].includes(String(a.action))) throw new Error('acção de vista desconhecida'); const ok = world.view?.(a.action as 'isolate', ids) ?? false; return { deterministic: true, category: 'observed', data: { acção: a.action, aplicada: ok, nota: 'só apresentação' } }; } },
];
export const TOOL_SPECS: ToolSpec[] = TOOLS.map(({ name, kind, description, args }) => ({ name, kind, description, args }));

function checkArgs(def: ToolDef, raw: unknown, world: AgentWorld): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('argumentos devem ser um objecto'); const a = raw as Record<string, unknown>;
  for (const k of Object.keys(a)) if (!(k in def.argTypes)) throw new Error(`argumento desconhecido «${k}»`);
  const comps = new Set(world.plan().components.map((c) => c.id)), joints = new Set((world.mechanism()?.joints ?? []).map((j) => j.id));
  for (const [k, spec] of Object.entries(def.argTypes)) { const v = a[k]; if (v === undefined) { if (!spec.optional) throw new Error(`falta «${k}»`); continue; }
    if (spec.type === 'string' && (typeof v !== 'string' || !v.trim() || v.length > 400)) throw new Error(`«${k}» inválido`); if (spec.type === 'number' && (typeof v !== 'number' || !Number.isFinite(v))) throw new Error(`«${k}» deve ser um número`);
    if (spec.type === 'component' && (typeof v !== 'string' || !comps.has(v))) throw new Error(`componente «${String(v)}» não existe`); if (spec.type === 'joint' && (typeof v !== 'string' || !joints.has(v))) throw new Error(`junta «${String(v)}» não existe`); if (spec.type === 'numbers') numbers(v); }
  return a;
}

/** the numbers in a statement must exist (to the precision shown) in the results it cites */
const NUM = /-?\d+(?:[.,]\d+)?/g;
function numbersGrounded(text: string, data: unknown[]): boolean {
  const have: number[] = []; const walk = (v: unknown) => { if (typeof v === 'number') have.push(v); else if (typeof v === 'string') for (const n of v.match(NUM) ?? []) have.push(Number(n.replace(',', '.'))); else if (Array.isArray(v)) v.forEach(walk); else if (v && typeof v === 'object') Object.values(v).forEach(walk); }; data.forEach(walk);
  const near = (x: number) => have.some((h) => Math.abs(h - x) <= Math.max(0.0051, Math.abs(h) * 0.006) || Math.abs((h * 180) / Math.PI - x) <= Math.max(0.051, Math.abs(x) * 0.006) || Math.abs((h * 100) - x) <= 0.51);
  return (text.match(NUM) ?? []).map((n) => Number(n.replace(',', '.'))).filter((n) => Math.abs(n) > 3 || String(n).includes('.')).every(near) || (text.match(NUM) ?? []).length === 0;
}
export function groundStatements(model: ModelReply & { kind: 'answer' }, results: ToolResultWire[]): GroundedStatement[] {
  return model.statements.map((s) => {
    const cited = s.refs.map((r) => results.find((x) => x.id === r)), missing = s.refs.filter((_, i) => !cited[i]), real = cited.filter((x): x is ToolResultWire => !!x && x.ok);
    const down = (reason: string): GroundedStatement => ({ text: s.text, declared: s.category, category: 'ai', refs: s.refs, grounded: false, reason });
    if (s.category === 'ai') return { text: s.text, declared: 'ai', category: 'ai', refs: s.refs, grounded: false, reason: 'inferência da IA, sem fundamento nos motores' };
    if (s.category === 'unknown') return { text: s.text, declared: 'unknown', category: 'unknown', refs: s.refs, grounded: true };
    if (missing.length) return down(`cita resultados inexistentes (${missing.join(', ')})`); if (!real.length) return down('sem resultados de ferramentas que a sustentem');
    if (s.category === 'computed' && !real.some((r) => r.deterministic && r.category === 'computed')) return down('«calculado» exige um resultado determinístico de cálculo');
    if ((s.category === 'observed' || s.category === 'user') && !real.some((r) => r.category === 'observed')) return down('«observado/indicado» exige uma leitura do Space');
    if (!numbersGrounded(s.text, real.map((r) => r.data))) return down('contém números que não constam dos resultados citados');
    return { text: s.text, declared: s.category, category: s.category, refs: s.refs, grounded: true };
  });
}

/** keeps a tool result inside the wire limit without ever fabricating: an oversized result is replaced by a labelled preview */
const clip = (data: unknown): unknown => { const t = JSON.stringify(data ?? null); return t.length <= AGENT_LIMITS.toolResultBytes ? data : { truncado: true, tamanhoOriginal: t.length, prévia: t.slice(0, AGENT_LIMITS.toolResultBytes - 120) }; };
export function buildContext(world: AgentWorld): unknown {
  const plan = world.plan(), m = world.mechanism();
  return { título: plan.title, unidades: plan.units, seleccionado: world.selectedId(), componentes: plan.components.map((c) => ({ id: c.id, label: c.label, pai: c.parentId })), mecanismo: m ? { chão: m.ground, juntas: m.joints.map((j) => ({ id: j.id, tipo: j.kind, entre: [j.parent, j.child], origem: j.claim.origin, confirmada: isConfirmed(m, j.id) })) } : null, nota: 'A forma e a estrutura vêm do plano; a função (juntas) só é afirmação se a junta estiver confirmada. Fidelidade geométrica não demonstrada.' };
}

export async function runAgent(question: string, world: AgentWorld, client: ModelClient, options: { signal?: AbortSignal } = {}): Promise<AgentTurn> {
  const results: ToolResultWire[] = [], proposals: AgentProposal[] = [], errors: string[] = []; let calls = 0, counter = 0; const nextProposal = () => `p${++counter}`;
  const turn = (statements: GroundedStatement[], limitations: string[], stopped: AgentTurn['stoppedBecause']): AgentTurn => ({ question, source: client.source, model: client.model, results, statements, limitations, proposals, modelCalls: calls, errors, stoppedBecause: stopped });
  for (let step = 0; step < AGENT_LIMITS.steps; step++) {
    let reply: ModelReply; calls++;
    try { reply = await client.complete({ question, step, context: buildContext(world), toolResults: results, tools: TOOL_SPECS }, options.signal); } catch (e) { errors.push(`O modelo não respondeu: ${e instanceof Error ? e.message : 'erro'}`); return turn([], ['Nada foi alterado.'], 'error'); }
    if (reply.kind === 'answer') return turn(groundStatements(reply, results), reply.limitations, 'answered');
    for (const call of reply.toolCalls.slice(0, AGENT_LIMITS.toolCallsPerStep)) {
      const id = `r${results.length + 1}`, def = TOOLS.find((t) => t.name === call.tool);
      if (results.length >= AGENT_LIMITS.toolResults) { errors.push('Limite de ferramentas por pergunta atingido.'); break; }
      if (!def) { results.push({ id, tool: call.tool, ok: false, deterministic: false, category: 'unknown', data: { erro: 'ferramenta desconhecida' } }); continue; }
      try { const args = checkArgs(def, JSON.parse(call.args), world), out = def.run(args, { world, proposals, model: client.model, nextProposal }); results.push({ id, tool: def.name, ok: true, deterministic: out.deterministic, category: out.category, data: clip(out.data) }); }
      catch (e) { results.push({ id, tool: def.name, ok: false, deterministic: false, category: 'unknown', data: { erro: e instanceof Error ? e.message : 'erro' } }); }
    }
  }
  return turn([], ['O modelo não chegou a uma resposta dentro do limite de passos.'], 'step_limit');
}
export { AGENT_REQUEST_CONTRACT };
