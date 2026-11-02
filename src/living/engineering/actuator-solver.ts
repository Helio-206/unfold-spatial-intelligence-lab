/**
 * Solver dos cilindros hidráulicos: a partir do curso (ou do ângulo do accionamento rotativo) calcula as juntas da montagem.
 *
 * Só aceita duas topologias, as da montagem do excavador, e recusa tudo o resto com `UNSUPPORTED_GEOMETRY`:
 *  - `direct_triangle`: a base do cilindro e o pino da haste estão num mesmo plano com a junta accionada. A forma é fechada:
 *    |R(θ)·r₂ − v_B|² = K, com K = L² − Δz². Dois ângulos no máximo; escolhe-se o mais próximo da referência.
 *  - `two_link_chain`: o cilindro acciona um balancé de duas barras (a barra do balancé fixa no braço e a barra de ligação
 *    na caçamba). A extremidade do balancé é a intersecção de dois círculos, para cada ângulo da caçamba; o ângulo da
 *    caçamba é a raiz de |J(θ) − base| = L, achada por amostragem e bissecção (controlado, sem aproximação silenciosa).
 *
 * As juntas passivas (bases dos cilindros, balancé, barra de ligação) saem da geometria e são verificadas depois pelo
 * fecho de laços da cinemática directa: o solver não dá uma pose como boa; o motor confirma-a.
 *
 * Quando a solução não existe, é ambígua ou singular, o resultado diz porquê. Nunca se devolve uma pose aproximada.
 */
import { EngineDomainError, applyRigid, composeRigid, quatConjugate, quatFromAxisAngle, rigidFromPose, rigidInverse, rotateVector } from './transform-math';
import type { Actuator, Assembly, HydraulicCylinder, Joint, Vec3 } from '../contracts/assembly.v1';
import { EngineInputError, referenceConfiguration, solveForwardKinematics, type Configuration, type KinematicState } from './forward-kinematics';

/** Tolerância numérica nos limites: um valor a 1e-9 do limite conta como no limite (a bissecção não chega a 1e-15). */
export const JOINT_WINDOW_TOLERANCE = 1e-9;
/** Abaixo deste |dg/dq| (m/rad) a caçamba quase não se mexe com o curso: singularidade. */
export const SINGULAR_SLOPE_M_PER_RAD = 1e-6;
/** Distância (m) abaixo da qual uma amostra da caçamba conta como raiz. Muito abaixo do fecho (1e-9 m) e acima do ruído (≈1e-15 m). */
export const ROOT_TOLERANCE_M = 1e-12;
/** Raízes mais próximas do que isto (rad) são a mesma raiz. */
const ROOT_MERGE_RAD = 1e-7;
const SAMPLES = 720;
const TWO_PI = 2 * Math.PI;

export type SolverWarning = { code: 'BRANCH_AMBIGUOUS' | 'SINGULAR_CONFIGURATION'; message: string; subjectIds: string[] };
export type SolveOutcome =
  | { ok: true; config: Configuration; warnings: SolverWarning[] }
  | { ok: false; code: string; message: string; subjectIds: string[] };

const norm = (v: readonly number[]) => Math.hypot(...(v as number[]));
const planeOf = (v: Vec3) => [v[0], v[1]] as [number, number];

/**
 * Ângulos da junta accionada para que |R(θ)·r₂ − v_B|² = K, com θ = sign·q. Devolve os valores de q (no intervalo (−π, π]),
 * e se a solução é singular (os dois ângulos coincidem: a trajectória do pino tangencia a base).
 * Lança `EngineDomainError` com código se não há solução (CYLINDER_UNREACHABLE) ou se a geometria é degenerada.
 */
export function planarCircleAngles(input: { r2: [number, number]; vB: [number, number]; K: number; sign: 1 | -1 }): { candidates: number[]; singular: boolean } {
  const { r2, vB, K, sign } = input;
  const lr = Math.hypot(r2[0], r2[1]); const lb = Math.hypot(vB[0], vB[1]);
  if (lr < 1e-12 || lb < 1e-12) throw new EngineDomainError('UNSUPPORTED_GEOMETRY', 'O pino ou a base estão sobre o eixo da junta: a distância não depende do ângulo.');
  const c = (lr * lr + lb * lb - K) / (2 * lr * lb);
  if (Math.abs(c) > 1 + 1e-12) {
    const reachMin = Math.abs(lr - lb); const reachMax = lr + lb;
    throw new EngineDomainError('CYLINDER_UNREACHABLE', `Comprimento fora do alcance geométrico [${reachMin.toFixed(6)}, ${reachMax.toFixed(6)}] no plano da junta.`);
  }
  // A classificação (singular ou não) não altera os ângulos: os dois são sempre −δ ± acos(c), com o acos verdadeiro.
  // Perto do alcance máximo (c ≈ −1, acos ≈ π) e perto da tangência (c ≈ 1) o cálculo continua a ser exacto.
  const singular = Math.abs(c) >= 1 - 1e-9;
  const cc = Math.max(-1, Math.min(1, c));
  const delta = Math.atan2(r2[1], r2[0]) - Math.atan2(vB[1], vB[0]);
  const alpha = Math.acos(cc);
  const wrap = (t: number) => { const w = Math.atan2(Math.sin(t), Math.cos(t)); return w === -Math.PI ? Math.PI : w; };
  const wrapped: number[] = [];
  for (const t of [-delta + alpha, -delta - alpha].map(wrap)) {
    // Dois ângulos iguais módulo 2π (α ≈ 0 ou α ≈ π) contam como um só.
    if (!wrapped.some((u) => Math.abs(u - t) < 1e-12 || Math.abs(Math.abs(u - t) - 2 * Math.PI) < 1e-12)) wrapped.push(t);
  }
  return { candidates: wrapped.map((t) => sign * t), singular };
}

/** Sinal do eixo da junta (+1 ou −1 em torno de Z da origem). Recusa eixos fora do plano da origem. */
function planarSign(joint: Joint): 1 | -1 {
  const origin = rigidFromPose(joint.origin);
  const axis = rotateVector(quatConjugate(origin.q), joint.axis);
  if (Math.abs(axis[0]) > 1e-9 || Math.abs(axis[1]) > 1e-9 || Math.abs(Math.abs(axis[2]) - 1) > 1e-9) {
    throw new EngineDomainError('UNSUPPORTED_GEOMETRY', `A junta ${joint.id} não roda em torno de um eixo normal ao plano da sua origem.`);
  }
  return axis[2] > 0 ? 1 : -1;
}

/** Valor de uma junta revolute para que o eixo X do filho aponte na direcção dada (no referencial do pai). */
function valueFor(joint: Joint, direction: Vec3): number {
  const origin = rigidFromPose(joint.origin);
  const d = rotateVector(quatConjugate(origin.q), direction);
  const n = norm(d);
  if (!(n > 0)) throw new EngineDomainError('UNSUPPORTED_GEOMETRY', `Direcção nula para a junta ${joint.id}.`);
  if (Math.abs(d[2]) > 1e-9 * n) throw new EngineDomainError('UNSUPPORTED_GEOMETRY', `A junta ${joint.id} tem de ficar no plano da sua origem.`);
  return planarSign(joint) * Math.atan2(d[1], d[0]);
}

/** Ângulo accionado que fica dentro dos limites, com tolerância; `null` se nenhum (inclui o das voltas de 2π). */
export function insideWindow(q: number, min: number, max: number): number | null {
  for (let k = -2; k <= 2; k += 1) {
    const v = q + k * TWO_PI;
    if (v >= min - JOINT_WINDOW_TOLERANCE && v <= max + JOINT_WINDOW_TOLERANCE) return Math.min(max, Math.max(min, v));
  }
  return null;
}

type Fail = { ok: false; code: string; message: string; subjectIds: string[] };
const fail = (code: string, message: string, subjectIds: string[]): Fail => ({ ok: false, code, message, subjectIds });

function jointById(assembly: Assembly, id: string): Joint {
  const joint = assembly.joints.find((item) => item.id === id);
  if (!joint) throw new EngineInputError('ENGINE_UNKNOWN_JOINT', `A junta ${id} não existe na montagem.`);
  return joint;
}

function pointOn(assembly: Assembly, constraintId: string, partId: string): Vec3 {
  const constraint = assembly.constraints.find((item) => item.id === constraintId);
  if (!constraint) throw new EngineDomainError('UNSUPPORTED_GEOMETRY', `Restrição ${constraintId} em falta.`);
  const side = constraint.a.partId === partId ? constraint.a : constraint.b.partId === partId ? constraint.b : null;
  if (!side) throw new EngineDomainError('UNSUPPORTED_GEOMETRY', `A restrição ${constraintId} não tem nenhum ponto em ${partId}.`);
  const part = assembly.parts.find((item) => item.id === partId)!;
  return part.points.find((item) => item.id === side.pointId)!.positionM;
}

type Solved = { ok: true; values: Configuration; warnings: SolverWarning[] } | Fail;

function solveDirectTriangle(assembly: Assembly, cylinder: HydraulicCylinder, value: number, reference: Configuration): Solved {
  const driven = jointById(assembly, cylinder.drives.jointId);
  const slide = jointById(assembly, cylinder.slideJointId);
  if (driven.type !== 'revolute' || !driven.limits) return fail('UNSUPPORTED_GEOMETRY', `A junta ${driven.id} tem de ser revolute com limites.`, [driven.id]);
  const base = assembly.joints.find((joint) => joint.childPartId === cylinder.barrelPartId);
  if (!base || base.type !== 'revolute' || base.parentPartId !== driven.parentPartId) return fail('UNSUPPORTED_GEOMETRY', `O cilindro ${cylinder.id} não tem a base no mesmo referencial da junta accionada.`, [cylinder.id]);
  const rodPin = pointOn(assembly, cylinder.drives.constraintIds[0]!, driven.childPartId);

  const closed = norm(slide.origin.translationM);
  const L = closed + value;
  const origin = rigidFromPose(driven.origin);
  const sign = planarSign(driven);
  const B = applyRigid(rigidInverse(origin), base.origin.translationM);
  // Um cilindro planar (base com eixo na junta) só roda no plano da junta: um pino fora dele não se consegue alcançar.
  if (Math.abs(rodPin[2] - B[2]) > 1e-9) return fail('UNSUPPORTED_GEOMETRY', `O pino de ${cylinder.id} está fora do plano da junta: a base não o pode orientar.`, [cylinder.id]);
  const K = L * L;
  let angles: { candidates: number[]; singular: boolean };
  try {
    angles = planarCircleAngles({ r2: planeOf(rodPin), vB: planeOf(B), K, sign });
  } catch (error) {
    if (error instanceof EngineDomainError) return fail(error.code, error.message, [cylinder.id]);
    throw error;
  }
  const inside = angles.candidates.map((q) => insideWindow(q, driven.limits!.min.value, driven.limits!.max.value)).filter((q): q is number => q !== null);
  const unique = [...new Set(inside.map((q) => Number(q.toFixed(12))))];
  if (unique.length === 0) return fail('CYLINDER_OUT_OF_JOINT_RANGE', `O curso pede um ângulo de ${driven.id} fora dos limites [${driven.limits.min.value}, ${driven.limits.max.value}].`, [driven.id, cylinder.id]);
  const warnings: SolverWarning[] = [];
  const refQ = reference[driven.id]!;
  const chosen = unique.length === 1 ? unique[0]! : unique.reduce((best, q) => (Math.abs(q - refQ) < Math.abs(best - refQ) ? q : best));
  if (unique.length > 1) warnings.push({ code: 'BRANCH_AMBIGUOUS', message: `Dois ângulos de ${driven.id} alcançam o curso; escolhido o mais próximo da referência.`, subjectIds: [driven.id] });
  if (angles.singular) warnings.push({ code: 'SINGULAR_CONFIGURATION', message: `Configuração singular de ${driven.id}: os dois ângulos coincidem.`, subjectIds: [driven.id] });

  // Juntas passivas: a base do cilindro aponta ao pino da haste, no referencial do pai.
  const pinInParent = applyRigid(composeRigid(origin, { t: [0, 0, 0], q: quatFromAxisAngle(driven.axis, chosen) }), rodPin);
  const barrelValue = valueFor(base, [pinInParent[0] - base.origin.translationM[0], pinInParent[1] - base.origin.translationM[1], pinInParent[2] - base.origin.translationM[2]]);
  return { ok: true, values: { [driven.id]: chosen, [base.id]: barrelValue, [slide.id]: value }, warnings };
}

/** Ponto de J (extremidade do balancé) para um ângulo da caçamba: intersecção de dois círculos, ramo fixado pela referência. */
function circleIntersection(A: [number, number], r1: number, E: [number, number], r2: number, sigma: 1 | -1): [number, number] | null {
  const dx = E[0] - A[0]; const dy = E[1] - A[1];
  const d = Math.hypot(dx, dy);
  if (!(d > 0) || d > r1 + r2 || d < Math.abs(r1 - r2)) return null;
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  if (h2 < 0) return null;
  const h = Math.sqrt(h2);
  const px = A[0] + (a * dx) / d; const py = A[1] + (a * dy) / d;
  const perp: [number, number] = [-dy / d, dx / d];
  return [px + sigma * h * perp[0], py + sigma * h * perp[1]];
}

function solveTwoLinkChain(assembly: Assembly, cylinder: HydraulicCylinder, value: number, reference: Configuration, referenceState: KinematicState): Solved {
  const [idlerPart, linkPart] = cylinder.drives.linkPartIds as [string, string];
  const driven = jointById(assembly, cylinder.drives.jointId);
  if (driven.type !== 'revolute' || !driven.limits) return fail('UNSUPPORTED_GEOMETRY', `A junta ${driven.id} tem de ser revolute com limites.`, [driven.id]);
  const stick = driven.parentPartId;
  const idler = assembly.joints.find((joint) => joint.childPartId === idlerPart && joint.parentPartId === stick);
  const linkPin = assembly.joints.find((joint) => joint.childPartId === linkPart && joint.parentPartId === idlerPart);
  const base = assembly.joints.find((joint) => joint.childPartId === cylinder.barrelPartId && joint.parentPartId === stick);
  if (!idler || idler.type !== 'revolute' || !linkPin || linkPin.type !== 'revolute' || !base || base.type !== 'revolute') {
    return fail('UNSUPPORTED_GEOMETRY', `A cadeia do cilindro ${cylinder.id} não tem a forma balancé → barra → caçamba.`, [cylinder.id]);
  }
  const slide = jointById(assembly, cylinder.slideJointId);
  const rodOnIdler = pointOn(assembly, cylinder.drives.constraintIds[0]!, idlerPart);
  const pinOnBucket = pointOn(assembly, cylinder.drives.constraintIds[1]!, driven.childPartId);
  const linkEnd = pointOn(assembly, cylinder.drives.constraintIds[1]!, linkPart);
  const LI = norm(linkPin.origin.translationM);
  const LH = norm(linkEnd);
  if (norm([rodOnIdler[0] - linkPin.origin.translationM[0], rodOnIdler[1] - linkPin.origin.translationM[1], rodOnIdler[2] - linkPin.origin.translationM[2]]) > 1e-9) {
    return fail('UNSUPPORTED_GEOMETRY', `O pino da haste de ${cylinder.id} não coincide com a ponta do balancé.`, [cylinder.id]);
  }
  const A = idler.origin.translationM; const BKT = base.origin.translationM;
  for (const p of [A, BKT]) if (Math.abs(p[2]) > 1e-9) return fail('UNSUPPORTED_GEOMETRY', `Os pivôs de ${cylinder.id} não estão no plano do braço.`, [cylinder.id]);
  const bucketOrigin = rigidFromPose(driven.origin);
  planarSign(driven); // a caçamba tem de rodar no plano do braço
  const Lcyl = norm(slide.origin.translationM) + value;

  // Ponto do pino da caçamba no referencial do braço, para um ângulo da caçamba.
  const pinAt = (qb: number): Vec3 => applyRigid(composeRigid(bucketOrigin, { t: [0, 0, 0], q: quatFromAxisAngle(driven.axis, qb) }), pinOnBucket);
  const stickWorld = referenceState.parts.get(stick)!;
  const jointRef = referenceState.joints.get(linkPin.id)!;
  const Jref = applyRigid(rigidInverse(stickWorld), jointRef.t);
  const qbRef = reference[driven.id]!;
  const Eref = pinAt(qbRef);
  const crossRef = (Eref[0] - A[0]) * (Jref[1] - A[1]) - (Eref[1] - A[1]) * (Jref[0] - A[0]);
  if (Math.abs(crossRef) < 1e-12) return fail('UNSUPPORTED_GEOMETRY', `Ramo do balancé de ${cylinder.id} indefinido na referência.`, [cylinder.id]);
  const sigma: 1 | -1 = crossRef > 0 ? 1 : -1;
  const pinPlanar = (qb: number): [number, number] | null => {
    const E = pinAt(qb); if (Math.abs(E[2]) > 1e-9) return null;
    return circleIntersection(planeOf(A), LI, planeOf(E), LH, sigma);
  };
  const g = (qb: number): number | null => {
    const J = pinPlanar(qb); if (!J) return null;
    return Math.hypot(J[0] - BKT[0], J[1] - BKT[1]) - Lcyl;
  };

  const lo = driven.limits.min.value; const hi = driven.limits.max.value;
  // Os extremos da grelha são exactamente os limites: um valor a zero no limite é uma raiz no limite.
  const grid = Array.from({ length: SAMPLES + 1 }, (_, i) => (i === 0 ? lo : i === SAMPLES ? hi : lo + ((hi - lo) * i) / SAMPLES));
  const values = grid.map((q) => g(q));
  if (values.every((v) => v === null)) return fail('CYLINDER_UNREACHABLE', `Nenhuma posição da caçamba alcança este curso de ${cylinder.id}.`, [cylinder.id, driven.id]);
  const roots: number[] = [];
  const addRoot = (q: number) => { if (!roots.some((r) => Math.abs(r - q) < ROOT_MERGE_RAD)) roots.push(q); };
  // Raízes em amostras (incluindo os extremos): |g| dentro da tolerância de raiz.
  for (let i = 0; i <= SAMPLES; i += 1) {
    const v = values[i];
    if (v !== null && v !== undefined && Math.abs(v) <= ROOT_TOLERANCE_M) addRoot(grid[i]!);
  }
  // Mudanças de sinal entre amostras vizinhas: bissecção.
  for (let i = 0; i < SAMPLES; i += 1) {
    const a = values[i]; const b = values[i + 1];
    if (a === null || b === null || a === undefined || b === undefined) continue;
    if (a * b < 0) {
      let left = grid[i]!; let right = grid[i + 1]!; let fl = a;
      for (let iter = 0; iter < 200 && right - left > 1e-14; iter += 1) {
        const mid = (left + right) / 2; const fm = g(mid);
        if (fm === null) break;
        if (fm === 0) { left = right = mid; break; }
        if (Math.sign(fm) === Math.sign(fl)) { left = mid; fl = fm; } else right = mid;
      }
      addRoot((left + right) / 2);
    }
  }
  if (roots.length === 0) return fail('CYLINDER_OUT_OF_JOINT_RANGE', `O curso pede uma caçamba fora dos limites [${lo}, ${hi}].`, [driven.id, cylinder.id]);
  const warnings: SolverWarning[] = [];
  const chosenRoot = roots.length === 1 ? roots[0]! : roots.reduce((best, q) => (Math.abs(q - qbRef) < Math.abs(best - qbRef) ? q : best));
  // Uma raiz dentro da tolerância pode cair ligeiramente fora do limite por arredondamento: fixa-se no limite.
  const qb = Math.min(hi, Math.max(lo, chosenRoot));
  if (roots.length > 1) warnings.push({ code: 'BRANCH_AMBIGUOUS', message: `Mais de uma posição da caçamba alcança o curso de ${cylinder.id}; escolhida a mais próxima da referência.`, subjectIds: [driven.id] });
  const h = 1e-7;
  const up = g(qb + h); const down = g(qb - h);
  if (up !== null && down !== null && Math.abs((up - down) / (2 * h)) < SINGULAR_SLOPE_M_PER_RAD) {
    warnings.push({ code: 'SINGULAR_CONFIGURATION', message: `Configuração singular: o curso quase não move ${driven.id}.`, subjectIds: [driven.id, cylinder.id] });
  }

  const J = pinPlanar(qb);
  if (!J) return fail('CYLINDER_UNREACHABLE', `Posição final de ${cylinder.id} sem solução.`, [cylinder.id]);
  const E = pinAt(qb);
  const toA = [J[0] - A[0], J[1] - A[1], 0] as Vec3;
  const idlerValue = valueFor(idler, toA);
  const idlerFrame = composeRigid(rigidFromPose(idler.origin), { t: [0, 0, 0], q: quatFromAxisAngle(idler.axis, idlerValue) });
  const linkDir = rotateVector(quatConjugate(idlerFrame.q), [E[0] - J[0], E[1] - J[1], E[2]]);
  const linkValue = valueFor(linkPin, linkDir);
  const baseValue = valueFor(base, [J[0] - BKT[0], J[1] - BKT[1], 0]);
  return { ok: true, values: { [driven.id]: qb, [idler.id]: idlerValue, [linkPin.id]: linkValue, [base.id]: baseValue, [slide.id]: value }, warnings };
}

/**
 * Resolve as juntas da montagem para os valores pedidos aos actuadores. `values` tem um valor por actuador: curso (m) para
 * cilindros, ângulo (rad) para accionamentos rotativos. Erros de entrada lançam `EngineInputError`; caso de geometria
 * sem solução devolve `{ ok: false, code }`. O resultado é verificado depois pela cinemática directa (fecho dos laços).
 */
export function solveActuatorConfiguration(assembly: Assembly, values: Record<string, number>): SolveOutcome {
  const reference = referenceConfiguration(assembly);
  const referenceState = solveForwardKinematics(assembly, reference);
  const known = new Set(assembly.actuators.map((actuator) => actuator.id));
  for (const id of Object.keys(values)) if (!known.has(id)) throw new EngineInputError('ENGINE_UNKNOWN_ACTUATOR', `O actuador ${id} não existe na montagem.`);
  for (const actuator of assembly.actuators) {
    const value = values[actuator.id];
    if (value === undefined) throw new EngineInputError('ENGINE_MISSING_ACTUATOR_VALUE', `Falta o valor do actuador ${actuator.id}.`);
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new EngineInputError('ENGINE_NON_FINITE_VALUE', `Valor não finito para ${actuator.id}.`);
  }

  const config: Configuration = {};
  const warnings: SolverWarning[] = [];
  for (const actuator of assembly.actuators) {
    const value = values[actuator.id]!;
    let outcome: Solved;
    try {
      outcome = actuatorOutcome(assembly, actuator, value, reference, referenceState);
    } catch (error) {
      // Geometria que o solver não cobre (eixo fora do plano, pivô sobre o eixo): recusa explícita, nunca uma pose aproximada.
      if (error instanceof EngineDomainError) return fail(error.code, error.message, [actuator.id]);
      throw error;
    }
    if (!outcome.ok) return outcome;
    Object.assign(config, outcome.values);
    warnings.push(...outcome.warnings);
  }
  const uncovered = assembly.joints.filter((joint) => joint.type !== 'fixed' && !(joint.id in config)).map((joint) => joint.id);
  if (uncovered.length > 0) return fail('UNCOVERED_JOINT', `Juntas sem actuador nem geometria que as determine: ${uncovered.join(', ')}.`, uncovered);
  return { ok: true, config, warnings };
}

function actuatorOutcome(assembly: Assembly, actuator: Actuator, value: number, reference: Configuration, referenceState: KinematicState): Solved {
  if (actuator.kind === 'rotary_drive') {
    const joint = jointById(assembly, actuator.jointId);
    if (joint.type !== 'revolute') return fail('UNSUPPORTED_GEOMETRY', `O accionamento ${actuator.id} precisa de uma junta revolute.`, [actuator.id]);
    return { ok: true, values: { [joint.id]: value }, warnings: [] };
  }
  if (value < actuator.stroke.min.value || value > actuator.stroke.max.value) {
    return fail('STROKE_OUT_OF_RANGE', `O curso ${value} m de ${actuator.id} está fora de [${actuator.stroke.min.value}, ${actuator.stroke.max.value}] m.`, [actuator.id]);
  }
  return actuator.drives.transmission === 'direct_triangle'
    ? solveDirectTriangle(assembly, actuator, value, reference)
    : solveTwoLinkChain(assembly, actuator, value, reference, referenceState);
}

