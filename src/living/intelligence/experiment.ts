import { canonicalize, sha256Hex } from '../../core/canonical';
import { checkCollisions, type Collision, type PartBox } from './collision';
import { dynamicsRequirements, simulate } from './dynamics';
import { solveMechanism, sweepJoint, type JointValues } from './kinematics';
import { basisOf, mechanismHash, type Mechanism, type Vec3 } from './mechanism';

/**
 * An experiment is a reproducible computation on a specific version of an object: its inputs, its initial conditions, the parameters it used, the object version it ran on
 * (plan hash + mechanism hash), its results and its limitations. Running it again on the same version gives byte-identical results (the result hash proves it); on a
 * different version it refuses to claim reproduction. An experiment that needs physical parameters nobody gave does not run as physics: it offers to complete the
 * parameters, or to run as an explicitly HYPOTHETICAL experiment on parameters the person assumed (and says so on every result).
 */
export const EXPERIMENT_CONTRACT = 'unfold.experiment.v1' as const;
export type ExperimentSpec =
  | { kind: 'pose'; inputs: JointValues }
  | { kind: 'sweep'; joint: string; from: number; to: number; steps: number; others?: JointValues; markers?: Array<{ id: string; part: string; local: Vec3 }> }
  | { kind: 'dynamics'; q0: JointValues; qd0?: JointValues; torques?: JointValues; damping?: JointValues; duration: number; dt: number; sampleEvery?: number };
export type ExperimentResult = { status: string; summary: Record<string, number | string | boolean | null>; series: Array<Record<string, number | string>>; collisions: Array<Pick<Collision, 'a' | 'b' | 'penetration'>>; violations: string[]; missing: string[]; };
export type Experiment = {
  contract: typeof EXPERIMENT_CONTRACT; id: string; name: string; spec: ExperimentSpec;
  /** parameters were assumed by the person for this run (physics not given by the object): every result is hypothetical */ hypothetical: boolean;
  objectVersion: { planSha256: string; planFingerprint: string; mechanismHash: string };
  basis: 'confirmed' | 'hypothesis' | 'mixed'; physicsParameters: Mechanism['physics'] | null; boxesUsed: boolean;
  result: ExperimentResult; resultHash: string; limitations: string[]; createdAt: number;
};
const round = (v: number) => Math.round(v * 1e9) / 1e9;
export const HYPOTHETICAL_PREFIX = 'HIPOTÉTICO:';
export const isHypotheticalPhysics = (m: Mechanism) => m.physics.parts.some((p) => p.claim.evidence.startsWith(HYPOTHETICAL_PREFIX));

/** the ways to continue when a dynamic experiment lacks parameters */
export function parameterOptions(m: Mechanism): { ok: boolean; missing: string[]; options: string[] } {
  const r = dynamicsRequirements(m); if (r.ok) return { ok: true, missing: [], options: [] };
  return { ok: false, missing: r.missing, options: ['Indicar os parâmetros em falta (massa, centro de massa, inércia, gravidade, unidades em metros) e correr uma experiência física sob esses parâmetros.', `Correr uma experiência HIPOTÉTICA com parâmetros que assume agora: o resultado fica marcado «${HYPOTHETICAL_PREFIX}» e não é uma previsão sobre o objecto real.`, 'Correr só a cinemática (poses, trajectórias, limites, colisões), que não precisa de massas nem forças.'] };
}

export function runExperiment(m: Mechanism, spec: ExperimentSpec, meta: { id: string; name: string; planFingerprint: string; boxes?: PartBox[]; createdAt?: number }): Experiment {
  const limitations: string[] = ['Cinemática de corpos rígidos; juntas ideais sem folga nem atrito.'], series: ExperimentResult['series'] = [], summary: ExperimentResult['summary'] = {}, violations: string[] = [], collisions: ExperimentResult['collisions'] = []; let status = 'solved', missing: string[] = [];
  const col = (q: JointValues) => { if (!meta.boxes) return; for (const c of checkCollisions(m, q, meta.boxes).collisions) collisions.push({ a: c.a, b: c.b, penetration: round(c.penetration) }); };
  if (spec.kind === 'pose') {
    const r = solveMechanism(m, { inputs: spec.inputs }); status = r.status; summary.dof = r.mobility.numerical; summary.residual = r.residual < 1e-12 ? 0 : Number(r.residual.toExponential(3)); summary.freeDofAtSolution = r.freeDofAtSolution; summary.singular = r.singular;
    series.push(Object.fromEntries(Object.entries(r.q).map(([k, v]) => [k, round(v)]))); violations.push(...r.violations.map((v) => (v.kind === 'limit' ? `limite de ${v.jointId}: ${round(v.value)} fora de [${v.min}, ${v.max}]` : v.detail))); if (r.status !== 'no_solution_found') col(r.q); limitations.push(...r.notes);
  } else if (spec.kind === 'sweep') {
    const s = sweepJoint(m, spec.joint, spec.from, spec.to, spec.steps, spec.others ?? {}, spec.markers ?? []); const bad = s.filter((x) => x.status !== 'solved'); status = bad.length ? (bad.some((x) => x.status === 'no_solution_found') ? 'no_solution_found' : 'limit_violated') : 'solved'; summary.samples = s.length; summary.invalidSamples = bad.length; summary.firstInvalidAt = bad.length ? round(bad[0]!.value) : null;
    for (const x of s) { series.push({ value: round(x.value), status: x.status, ...Object.fromEntries(Object.entries(x.markers).flatMap(([k, p]) => [[`${k}.x`, round(p[0])], [`${k}.y`, round(p[1])], [`${k}.z`, round(p[2])]])) }); if (x.status !== 'no_solution_found') col(x.q); }
    if (bad.length) violations.push(`${bad.length} de ${s.length} posições inválidas (${[...new Set(bad.map((b) => b.status))].join(', ')})`);
  } else {
    const req = dynamicsRequirements(m); if (!req.ok) { status = 'insufficient_parameters'; missing = req.missing; limitations.push('Sem os parâmetros físicos a dinâmica não corre: complete-os ou corra uma experiência hipotética identificada.'); }
    else { const r = simulate(m, spec), step = Math.max(1, Math.floor(r.samples.length / 200)); status = r.status; summary.energyDrift = Number(r.energyDrift.toExponential(3)); summary.finalTime = r.samples.at(-1)?.t ?? 0; r.samples.forEach((x, i) => { if (i % step === 0 || i === r.samples.length - 1) series.push({ t: round(x.t), total: round(x.total), ...Object.fromEntries(r.ids.map((id, k) => [id, round(x.q[k]!)])) }); }); limitations.push(...r.limitations); if (r.samples.length) col(Object.fromEntries(r.ids.map((id, k) => [id, r.samples.at(-1)!.q[k]!]))); }
  }
  const hypothetical = isHypotheticalPhysics(m) && spec.kind === 'dynamics'; if (hypothetical) limitations.unshift(`${HYPOTHETICAL_PREFIX} parâmetros assumidos para esta experiência; o resultado não é uma previsão sobre o objecto real.`);
  const result: ExperimentResult = { status, summary, series, collisions: collisions.filter((c, i, a) => a.findIndex((d) => d.a === c.a && d.b === c.b) === i), violations, missing };
  return { contract: EXPERIMENT_CONTRACT, id: meta.id, name: meta.name, spec, hypothetical, objectVersion: { planSha256: m.planSha256, planFingerprint: meta.planFingerprint, mechanismHash: mechanismHash(m, { physics: spec.kind === 'dynamics' }) }, basis: basisOf(m), physicsParameters: spec.kind === 'dynamics' ? m.physics : null, boxesUsed: !!meta.boxes, result, resultHash: sha256Hex(canonicalize(result)), limitations: [...new Set(limitations)], createdAt: meta.createdAt ?? Date.now() };
}
export type Reproduction = { reproduced: true } | { reproduced: false; reason: 'object_changed' | 'result_differs'; detail: string };
/** Runs the stored experiment again on `m` and says whether it reproduces: only on the same object version, and only if the result hash is identical. */
export function reproduce(exp: Experiment, m: Mechanism, planFingerprint: string, boxes?: PartBox[]): Reproduction {
  if (exp.objectVersion.planSha256 !== m.planSha256 || exp.objectVersion.planFingerprint !== planFingerprint || exp.objectVersion.mechanismHash !== mechanismHash(m, { physics: exp.spec.kind === 'dynamics' })) return { reproduced: false, reason: 'object_changed', detail: 'O objecto (plano ou mecanismo) mudou desde a experiência: não é uma reprodução, é outra experiência.' };
  const again = runExperiment(m, exp.spec, { id: exp.id, name: exp.name, planFingerprint, ...(exp.boxesUsed ? { boxes: boxes ?? [] } : {}), createdAt: exp.createdAt });
  return again.resultHash === exp.resultHash ? { reproduced: true } : { reproduced: false, reason: 'result_differs', detail: `hash ${again.resultHash.slice(0, 12)} ≠ ${exp.resultHash.slice(0, 12)}` };
}
export type Comparison = { a: string; b: string; sameObjectVersion: boolean; rows: Array<{ metric: string; a: number | string | boolean | null; b: number | string | boolean | null }>; notes: string[] };
export function compareExperiments(a: Experiment, b: Experiment): Comparison {
  const keys = [...new Set([...Object.keys(a.result.summary), ...Object.keys(b.result.summary)])].sort(), same = a.objectVersion.mechanismHash === b.objectVersion.mechanismHash && a.objectVersion.planFingerprint === b.objectVersion.planFingerprint;
  return { a: a.id, b: b.id, sameObjectVersion: same, rows: [{ metric: 'estado', a: a.result.status, b: b.result.status }, { metric: 'colisões entre caixas', a: a.result.collisions.length, b: b.result.collisions.length }, { metric: 'violações', a: a.result.violations.length, b: b.result.violations.length }, ...keys.map((k) => ({ metric: k, a: a.result.summary[k] ?? null, b: b.result.summary[k] ?? null }))], notes: [...(same ? [] : ['As experiências correram em versões diferentes do objecto: a comparação mistura o efeito dos parâmetros com o da mudança do objecto.']), ...(a.hypothetical || b.hypothetical ? ['Pelo menos uma experiência é hipotética (parâmetros assumidos).'] : [])] };
}
