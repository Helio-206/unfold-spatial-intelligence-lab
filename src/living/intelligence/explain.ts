import { checkCollisions, type PartBox } from './collision';
import { solveMechanism, type JointValues, type SolveResult } from './kinematics';
import { isConfirmed, type Mechanism } from './mechanism';

/**
 * Explanations are built FROM what the engines computed, with the category of every statement stated: observed, introduced by the user, an AI inference, a deterministic
 * computation, a hypothesis, or unknown. Each statement carries the components, joints, values and equation it rests on. Nothing here is a justification written after the
 * fact: a "why can't it rotate" answer comes from actually trying the motion and reporting where and why the engine stopped (limit, loop closure, collision, coupling).
 */
export type Category = 'observed' | 'user' | 'ai' | 'computed' | 'hypothesis' | 'unknown';
export type Statement = { id: string; text: string; category: Category; refs: { components?: string[]; joints?: string[]; values?: Record<string, number | string>; equation?: string; source?: string } };
const fmt = (n: number) => (Math.abs(n) >= 100 || Number.isInteger(n) ? String(Math.round(n * 1000) / 1000) : n.toFixed(4).replace(/0+$/, '').replace(/\.$/, ''));
const deg = (r: number) => `${fmt((r * 180) / Math.PI)}°`;

/** how a joint is known: the category follows its origin AND whether a person confirmed it */
export function jointCategory(m: Mechanism, jointId: string): Category {
  const j = m.joints.find((x) => x.id === jointId); if (!j) return 'unknown';
  if (isConfirmed(m, jointId)) return 'user'; // a person stated or accepted it: human confirmation (an accepted AI proposal keeps its AI origin in the claim and the event log)
  return j.claim.origin === 'ai' ? 'ai' : 'hypothesis';
}
export function explainMechanism(m: Mechanism, descriptors: Record<string, string> = {}): Statement[] {
  const out: Statement[] = [], r = solveMechanism(m);
  for (const j of m.joints) {
    const cat = jointCategory(m, j.id), what = j.kind === 'fixed' ? 'liga rigidamente' : j.kind === 'revolute' ? 'permite rotação' : 'permite translação', lim = j.limits ? `, limites ${j.kind === 'revolute' ? `${deg(j.limits.min)} a ${deg(j.limits.max)}` : `${fmt(j.limits.min)} a ${fmt(j.limits.max)}`}` : j.kind === 'fixed' ? '' : ', sem limites indicados';
    const who = cat === 'user' ? (j.claim.origin === 'user' ? 'Indicado por si' : `Aceite por si (proposta de ${j.claim.origin === 'ai' ? `IA ${j.claim.model ?? ''}` : 'extracção por heurística'})`) : cat === 'ai' ? `Proposta da IA${j.claim.model ? ` (${j.claim.model})` : ''}, ainda não aceite` : 'Hipótese extraída da geometria, ainda não confirmada';
    out.push({ id: `joint-${j.id}`, category: cat, text: `${who}: ${j.parent} ${what} ${j.child}${j.kind !== 'fixed' ? ` em torno do eixo [${j.axis.map(fmt).join(', ')}]` : ''}${lim}. Fundamento: ${j.claim.evidence}`, refs: { components: [j.parent, j.child], joints: [j.id], values: { kind: j.kind, home: j.home } } });
  }
  for (const [part, d] of Object.entries(descriptors)) out.push({ id: `shape-${part}`, category: 'observed', text: `${part}: ${d} (descrição da geometria do plano, não da função).`, refs: { components: [part] } });
  out.push({ id: 'mobility', category: 'computed', text: `Graus de liberdade: ${r.mobility.numerical} (rank numérico das restrições, ${r.mobility.variables} variáveis, rank ${r.mobility.constraintRank}). Contagem de Grübler–Kutzbach: ${r.mobility.gruebler.formula}. ${r.mobility.note}`, refs: { values: { dof: r.mobility.numerical, gruebler: r.mobility.gruebler.value }, equation: r.mobility.gruebler.planar ? 'M = 3(N−1) − Σ(3 − fᵢ) − acoplamentos' : 'M = 6(N−1) − Σ(6 − fᵢ) − acoplamentos', source: 'solveMechanism' } });
  if (r.basis !== 'confirmed') out.push({ id: 'basis', category: 'hypothesis', text: `Tudo o que se calcula sobre este mecanismo assenta em ${r.basis === 'hypothesis' ? 'hipóteses por confirmar' : 'juntas parte confirmadas, parte hipóteses'}: confirme ou corrija as juntas para as conclusões deixarem de ser condicionais.`, refs: { joints: m.joints.filter((j) => !isConfirmed(m, j.id)).map((j) => j.id) } });
  return out;
}

export type BlockedCause = 'movable' | 'not_movable' | 'limit' | 'loop' | 'collision' | 'input';
export type BlockedReport = { cause: BlockedCause; reachedValue: number; attemptedValue: number; statements: Statement[]; lastGood: SolveResult | null };
/**
 * Tries to move `jointId` from its current value toward `target` in small steps, solving the whole mechanism at each step, and reports where and why it stops:
 * the joint's own limit, another joint's limit (reached through the coupling or the loop), a loop that cannot close, a box collision, or nothing (it can move).
 */
export function explainBlocked(m: Mechanism, jointId: string, target: number, options: { q?: JointValues; boxes?: PartBox[]; steps?: number } = {}): BlockedReport {
  const j = m.joints.find((x) => x.id === jointId), st = (id: string, text: string, category: Category, refs: Statement['refs']): Statement => ({ id, text, category, refs });
  if (!j) return { cause: 'input', reachedValue: NaN, attemptedValue: target, lastGood: null, statements: [st('no-joint', `A junta «${jointId}» não existe neste mecanismo.`, 'unknown', {})] };
  if (j.kind === 'fixed') return { cause: 'not_movable', reachedValue: j.home, attemptedValue: target, lastGood: null, statements: [st('fixed', `«${jointId}» é uma junta rígida (${jointCategory(m, jointId) === 'user' ? 'confirmada' : 'hipótese'}): não tem movimento. Se o movimento existe na realidade, a junta tem de ser corrigida.`, jointCategory(m, jointId), { joints: [jointId], components: [j.parent, j.child] })] };
  const start = options.q?.[jointId] ?? j.home, n = options.steps ?? 60; let guess = options.q, last: SolveResult | null = null, reached = start;
  const unit = j.kind === 'revolute' ? deg : fmt;
  for (let i = 0; i <= n; i++) {
    const v = start + ((target - start) * i) / n, r = solveMechanism(m, { inputs: { ...(options.q ?? {}), [jointId]: v }, ...(guess ? { guess } : {}) });
    const coll = options.boxes && (r.status === 'solved' || r.status === 'limit_violated') ? checkCollisions(m, r.q, options.boxes) : null;
    if (r.status === 'solved' && !coll?.collisions.length) { last = r; guess = r.q; reached = v; continue; }
    const attemptedAt = v, base: Statement['refs'] = { joints: [jointId], values: { tentado: attemptedAt, alcançado: reached }, source: 'solveMechanism' };
    if (r.status === 'limit_violated') { const x = r.violations.find((q) => q.kind === 'limit')!; const own = x.kind === 'limit' && x.jointId === jointId, lj = x.kind === 'limit' ? m.joints.find((y) => y.id === x.jointId)! : j;
      return { cause: 'limit', reachedValue: reached, attemptedValue: target, lastGood: last, statements: [st('limit', `${own ? `«${jointId}»` : `«${jointId}» arrasta «${x.kind === 'limit' ? x.jointId : ''}» (acoplamento ou laço) e esta`} atinge o limite ${x.kind === 'limit' ? `${unit(x.value > x.max ? x.max : x.min)} (${x.value > x.max ? 'máximo' : 'mínimo'})` : ''} quando «${jointId}» vale ${unit(attemptedAt)}; o movimento pára em ${unit(reached)}. Limite ${jointCategory(m, lj.id) === 'user' ? 'indicado/confirmado por si' : 'é uma hipótese por confirmar'}.`, 'computed', { ...base, joints: [jointId, ...(own ? [] : [lj.id])] })] }; }
    if (r.status === 'no_solution_found') return { cause: 'loop', reachedValue: reached, attemptedValue: target, lastGood: last, statements: [st('loop', `Com «${jointId}» = ${unit(attemptedAt)} as restrições do mecanismo (laços fechados e acoplamentos) deixam de ter solução; o último valor possível é ${unit(reached)}. O solver não encontrou configuração a partir de ${r.trace.length} iterações (resíduo ${r.residual.toExponential(2)}); isto indica que o movimento está bloqueado pela geometria do laço, mas não é uma prova formal de impossibilidade.`, 'computed', { ...base, values: { ...base.values, resíduo: r.residual, iterações: r.trace.length } })] };
    const c = coll!.collisions[0]!; return { cause: 'collision', reachedValue: reached, attemptedValue: target, lastGood: last, statements: [st('collision', `Com «${jointId}» = ${unit(attemptedAt)} as caixas de «${c.a}» e «${c.b}» sobrepõem-se (penetração ${fmt(c.penetration)}); o movimento pára em ${unit(reached)}. Método: caixas orientadas — a colisão pode ser só das caixas, não das formas.`, 'computed', { ...base, components: [c.a, c.b] })] };
  }
  return { cause: 'movable', reachedValue: target, attemptedValue: target, lastGood: last, statements: [st('movable', `«${jointId}» pode ir de ${unit(start)} a ${unit(target)} sem violar limites, laços ${options.boxes ? 'nem colisões entre caixas' : '(colisões não verificadas: sem caixas)'} em ${n} passos de teste.${jointCategory(m, jointId) === 'user' ? '' : ' A conclusão assenta numa junta ainda não confirmada.'}`, 'computed', { joints: [jointId], values: { de: start, até: target }, source: 'solveMechanism' })] };
}

/** "What happens if I change this joint?": the solved consequence for every other part and joint, and whether it is valid. */
export function explainEffect(m: Mechanism, jointId: string, newValue: number, base: JointValues = {}): { status: SolveResult['status']; statements: Statement[]; result: SolveResult } {
  const before = solveMechanism(m, { inputs: base }), after = solveMechanism(m, { inputs: { ...base, [jointId]: newValue }, guess: before.q }), unit = m.joints.find((j) => j.id === jointId)?.kind === 'revolute' ? deg : fmt, out: Statement[] = [];
  out.push({ id: 'status', category: 'computed', text: after.status === 'solved' ? `Com «${jointId}» = ${unit(newValue)} a configuração é cinematicamente válida (resíduo ${after.residual.toExponential(1)}).` : after.status === 'limit_violated' ? `Com «${jointId}» = ${unit(newValue)} a configuração viola ${after.violations.length} limite(s): ${after.violations.map((v) => (v.kind === 'limit' ? `«${v.jointId}» ${fmt(v.value)} fora de [${fmt(v.min)}, ${fmt(v.max)}]` : v.detail)).join('; ')}.` : `Com «${jointId}» = ${unit(newValue)} não se encontrou configuração válida (${after.status}).`, refs: { joints: [jointId], values: { valor: newValue, resíduo: after.residual }, source: 'solveMechanism' } });
  for (const j of m.joints) if (j.kind !== 'fixed' && j.id !== jointId && Math.abs((after.q[j.id] ?? j.home) - (before.q[j.id] ?? j.home)) > 1e-9) out.push({ id: `follows-${j.id}`, category: 'computed', text: `«${j.id}» passa de ${(j.kind === 'revolute' ? deg : fmt)(before.q[j.id] ?? j.home)} para ${(j.kind === 'revolute' ? deg : fmt)(after.q[j.id] ?? j.home)} (acompanha «${jointId}» pelas restrições).`, refs: { joints: [jointId, j.id], values: { antes: before.q[j.id] ?? j.home, depois: after.q[j.id] ?? j.home } } });
  if (after.basis !== 'confirmed') out.push({ id: 'basis', category: 'hypothesis', text: `Previsão condicional: assenta em juntas ${after.basis === 'hypothesis' ? 'não confirmadas' : 'parcialmente confirmadas'}.`, refs: {} });
  out.push({ id: 'no-forces', category: 'unknown', text: 'Forças, velocidades e acelerações não se podem afirmar só pela cinemática: dependem de massas, inércias e actuadores.', refs: {} });
  return { status: after.status, statements: out, result: after };
}
