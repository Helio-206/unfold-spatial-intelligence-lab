import { validateAssembly, type Assembly } from '../contracts';
import type { SessionState } from './reconstruction-session';
import { visualCapacityIssues } from './visual-capacity';
import type { ReconstructionFailure, ReviewedReconstruction } from './types';

export type ProvenanceTone = 'model' | 'unverified' | 'synthetic';
export type ProvenanceNote = { id: string; tone: ProvenanceTone; text: string };

/** What the workspace may do with a reviewed reconstruction. Moving the machine is never part of it. */
export type WorkspaceCandidate = {
  assembly: Assembly;
  bucketWidthM: { before: number; after: number };
  notes: ProvenanceNote[];
  limitations: string[];
  /** Always false. Adopting a candidate does not authorise motion; that goes through the Engineering Engine. */
  motionAuthorized: false;
};

export type AdoptionResult = { ok: true; candidate: WorkspaceCandidate } | { ok: false; reasons: string[] };

const PROMOTED = new Set(['verified', 'corrected']);

function promotedPaths(assembly: Assembly): string[] {
  const out: string[] = [];
  const check = (path: string, value: { provenance?: { validation?: string } } | undefined) => { if (value?.provenance?.validation && PROMOTED.has(value.provenance.validation)) out.push(path); };
  check('assembly', assembly);
  assembly.parts.forEach((part, i) => { check(`parts[${i}]`, part); part.shapes.forEach((shape, j) => check(`parts[${i}].shapes[${j}]`, shape as never)); });
  assembly.joints.forEach((joint, i) => check(`joints[${i}]`, joint as never));
  assembly.actuators.forEach((actuator, i) => check(`actuators[${i}]`, actuator as never));
  return out;
}

export function provenanceNotes(result: ReviewedReconstruction): ProvenanceNote[] {
  const p = result.provenance;
  return [
    { id: 'observation', tone: p.observation.source === 'meta_model' ? 'model' : 'synthetic', text: p.observation.source === 'meta_model' ? 'Observação descrita pelo modelo; não é medição.' : 'Observação gerada por fixture offline; não é interpretação visual.' },
    { id: 'review', tone: 'unverified', text: 'A revisão foi submetida pelo cliente; a identidade do revisor e a participação humana não são verificadas.' },
    { id: 'width', tone: 'unverified', text: `Largura da caçamba fornecida pelo utilizador (${p.bucketWidth.basis}); não é uma medição verificada.` },
    { id: 'geometry', tone: 'synthetic', text: 'A restante geometria vem de uma montagem sintética; não representa dimensões recuperadas da fotografia.' },
    { id: 'validation', tone: 'unverified', text: 'Contrato válido: estrutura verificada, sem cálculo de engenharia, segurança mecânica ou autorização de movimento.' },
  ];
}

/**
 * The only door from a reconstruction to the workspace. Fails closed: the session must be `reviewed`,
 * the assembly must validate again here, the canonical bucket shape must agree with the reported summary,
 * and nothing may have been promoted to verified.
 */
export function adoptReviewed(state: SessionState): AdoptionResult {
  if (state.phase !== 'reviewed') return { ok: false, reasons: [`a sessão não está revista (${state.phase})`] };
  const { result } = state;
  const reasons: string[] = [];
  if (result.status !== 'contract_valid' || result.validation !== 'contract_valid') reasons.push('contrato não validado');
  const validation = validateAssembly(result.assembly);
  if (!validation.ok) reasons.push(...validation.issues.slice(0, 5).map((i) => `${i.path}: ${i.code}`));
  const bucket = result.assembly.parts.find((part) => part.role === 'bucket');
  const box = bucket?.shapes.find((shape) => shape.kind === 'box');
  if (!box || box.kind !== 'box') reasons.push('geometria da caçamba ausente');
  else if (Math.abs(box.halfExtentsM[2] * 2 - result.geometry.bucketWidthAfterM) > 1e-9) reasons.push('largura reportada não corresponde à forma canónica da caçamba');
  if (result.geometry.bucketWidthAfterM !== result.review.bucketWidthM) reasons.push('largura aplicada difere da submetida');
  // the lab must not take what the Foundry cannot build; this runs before the engine is ever asked
  reasons.push(...visualCapacityIssues(result.assembly));
  const promoted = promotedPaths(result.assembly);
  if (promoted.length) reasons.push(`proveniência promovida sem evidência: ${promoted.join(', ')}`);
  if (reasons.length) return { ok: false, reasons };
  return { ok: true, candidate: {
    assembly: structuredClone(result.assembly), bucketWidthM: { before: result.geometry.bucketWidthBeforeM, after: result.geometry.bucketWidthAfterM },
    notes: provenanceNotes(result), limitations: [...result.limitations], motionAuthorized: false,
  } };
}

/** Portuguese text for each failure, written for the person, not for a log. */
export function describeFailure(failure: ReconstructionFailure): string {
  switch (failure.kind) {
    case 'invalid_input': return `Entrada inválida: ${failure.reasons.join('; ')}.`;
    case 'blocked': return `Bloqueado: ${failure.reasons.join('; ')}.`;
    case 'session_expired': return 'A sessão expirou ou o servidor foi reiniciado. Volte a enviar a fonte.';
    case 'rate_limited': return 'Demasiados pedidos. Aguarde um minuto.';
    case 'budget_exhausted': return 'O orçamento de chamadas ao modelo esgotou-se; nada foi executado.';
    case 'capacity': return 'O servidor atingiu o limite de sessões. Tente mais tarde.';
    case 'guard_rejected': return `Pedido recusado pelo servidor local (${failure.code}).`;
    case 'upstream': return `O servidor não conseguiu concluir (${failure.code}).`;
    case 'network': return `Sem ligação ao servidor (${failure.message}).`;
    case 'aborted': return 'Pedido cancelado.';
    case 'bad_response': return 'A resposta do servidor não cumpre o contrato e foi descartada.';
  }
}
