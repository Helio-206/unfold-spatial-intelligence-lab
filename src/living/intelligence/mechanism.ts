import { canonicalize, sha256Hex } from '../../core/canonical';

/**
 * The functional model of an object: which parts exist, which are joined and HOW, and what is known about it. It lives beside the Space (keyed by the plan's source hash),
 * never inside the Spatial Core, and every claim in it carries where it came from. Origin and verification are different things:
 *   origin        extracted  = detected from the geometry by a heuristic        user = a person stated it        ai = a model proposed it
 *   confirmation  a person's decision, recorded as its own EVENT (a proposal stays a proposal; accepting it does not rewrite who proposed it)
 *   computed      what the deterministic solver derives (mobility, reachability, collisions) — stored with experiments, never as an origin
 * Nothing here invents an internal mechanism: only joints someone proposed, extracted or stated exist, and unconfirmed ones are labelled hypotheses wherever they are used.
 */
export const MECHANISM_CONTRACT = 'unfold.mechanism.v1' as const;
export type Vec3 = [number, number, number];
export type ClaimOrigin = 'extracted' | 'user' | 'ai';
export type Claim = { origin: ClaimOrigin; evidence: string; /** model that proposed it, when origin is 'ai' */ model?: string; proposalId?: string };
export type JointKind = 'revolute' | 'prismatic' | 'fixed';
export type Joint = {
  id: string; kind: JointKind; parent: string; child: string;
  /** a point on the axis and the axis direction, in the Space's rest coordinates (the plan as it was built) */ origin: Vec3; axis: Vec3;
  /** radians (revolute) or length units (prismatic); absent = unlimited, which is itself a statement */ limits?: { min: number; max: number };
  /** value at the rest pose */ home: number;
  /** can a person or an actuator drive this joint? (a role, not a measurement) */ actuated?: boolean;
  label?: string; claim: Claim;
};
/** gear / belt coupling: child = ratio * parent (negative ratio = reversal). The ratio is a stated fact only when `claim.origin` is user. */
export type Coupling = { id: string; a: string; b: string; ratio: number; claim: Claim };
export type PartPhysics = { partId: string; massKg: number; /** centre of mass in rest coordinates */ com: Vec3; /** principal moments about the centre of mass, world axes at rest, kg m^2 */ inertia: Vec3; claim: Claim };
export type MechanismEvent = { kind: 'proposed' | 'accepted' | 'rejected' | 'edited'; target: string; by: 'extracted' | 'ai' | 'person'; at: number; note?: string };
export type Mechanism = {
  contract: typeof MECHANISM_CONTRACT; planSha256: string; units: 'm' | 'unitless'; ground: string; parts: string[];
  joints: Joint[]; couplings: Coupling[];
  physics: { gravity: Vec3 | null; parts: PartPhysics[] };
  /** ordered log; a joint is CONFIRMED only if an 'accepted' event by a person targets it (or its claim is the person's own) */ events: MechanismEvent[];
};

export class MechanismError extends Error { constructor(readonly code: string, detail: string) { super(`${code}: ${detail}`); } }
const ID = /^[a-z][a-z0-9-]{0,47}$/, finite3 = (v: unknown): v is Vec3 => Array.isArray(v) && v.length === 3 && v.every((x) => typeof x === 'number' && Number.isFinite(x));
const fail = (code: string, detail: string): never => { throw new MechanismError(code, detail); };

export function emptyMechanism(planSha256: string, ground: string, parts: string[], units: 'm' | 'unitless'): Mechanism {
  return { contract: MECHANISM_CONTRACT, planSha256, units, ground, parts: [...parts], joints: [], couplings: [], physics: { gravity: null, parts: [] }, events: [] };
}
const validClaim = (c: unknown): c is Claim => !!c && typeof c === 'object' && ['extracted', 'user', 'ai'].includes((c as Claim).origin) && typeof (c as Claim).evidence === 'string' && (c as Claim).evidence.trim().length > 0 && (c as Claim).evidence.length <= 400;

export function validateMechanism(value: unknown): Mechanism {
  const m = value as Partial<Mechanism> | null;
  if (!m || m.contract !== MECHANISM_CONTRACT) return fail('MECHANISM_CONTRACT', 'unknown contract');
  if (typeof m.planSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(m.planSha256)) fail('MECHANISM_PLAN', 'planSha256');
  if (!Array.isArray(m.parts) || !m.parts.length || m.parts.length > 128 || m.parts.some((p) => typeof p !== 'string' || !ID.test(p)) || new Set(m.parts).size !== m.parts.length) fail('MECHANISM_PARTS', 'parts');
  if (typeof m.ground !== 'string' || !m.parts!.includes(m.ground)) fail('MECHANISM_GROUND', 'ground must be one of the parts');
  if (!Array.isArray(m.joints) || m.joints.length > 256) fail('MECHANISM_JOINTS', 'joints');
  const ids = new Set<string>();
  for (const j of m.joints!) {
    if (!j || !ID.test(j.id) || ids.has(j.id)) fail('MECHANISM_JOINT_ID', String(j?.id)); ids.add(j.id);
    if (!['revolute', 'prismatic', 'fixed'].includes(j.kind)) fail('MECHANISM_JOINT_KIND', j.id);
    if (!m.parts!.includes(j.parent) || !m.parts!.includes(j.child) || j.parent === j.child) fail('MECHANISM_JOINT_PARTS', j.id);
    if (!finite3(j.origin) || !finite3(j.axis)) fail('MECHANISM_JOINT_GEOMETRY', j.id);
    if (j.kind !== 'fixed' && Math.hypot(...j.axis) < 1e-9) fail('MECHANISM_JOINT_AXIS', j.id);
    if (j.limits && (!Number.isFinite(j.limits.min) || !Number.isFinite(j.limits.max) || j.limits.min > j.limits.max)) fail('MECHANISM_JOINT_LIMITS', j.id);
    if (!Number.isFinite(j.home) || (j.limits && (j.home < j.limits.min - 1e-12 || j.home > j.limits.max + 1e-12))) fail('MECHANISM_JOINT_HOME', j.id);
    if (!validClaim(j.claim) || (j.claim.origin === 'ai' && !j.claim.model)) fail('MECHANISM_JOINT_CLAIM', j.id);
  }
  for (const c of m.couplings ?? []) {
    const a = m.joints!.find((j) => j.id === c.a), b = m.joints!.find((j) => j.id === c.b);
    if (!ID.test(c.id) || !a || !b || a.kind !== b.kind || a.kind === 'fixed' || c.a === c.b || !Number.isFinite(c.ratio) || c.ratio === 0 || !validClaim(c.claim)) fail('MECHANISM_COUPLING', String(c?.id));
  }
  if (m.physics) {
    if (m.physics.gravity !== null && !finite3(m.physics.gravity)) fail('MECHANISM_GRAVITY', 'gravity');
    for (const p of m.physics.parts) if (!m.parts!.includes(p.partId) || !(p.massKg > 0) || !finite3(p.com) || !finite3(p.inertia) || p.inertia.some((x) => !(x >= 0)) || !validClaim(p.claim)) fail('MECHANISM_PHYSICS', String(p?.partId));
  } else fail('MECHANISM_PHYSICS', 'missing');
  if (!Array.isArray(m.events)) fail('MECHANISM_EVENTS', 'events');
  return m as Mechanism;
}

/** The hash identifies what the SOLVER sees (parts, ground, joints, couplings, physics), not the provenance log (and, for purely kinematic experiments, not the physical parameters they never read): confirming a joint or undoing a structural edit does not make the same computation a different one. */
export const mechanismHash = (m: Mechanism, options: { physics?: boolean } = {}): string => sha256Hex(canonicalize({ ...m, units: options.physics === false ? null : m.units, events: [], joints: m.joints.map(({ claim: _c, ...rest }) => rest), couplings: m.couplings.map(({ claim: _c, ...rest }) => rest), physics: options.physics === false ? null : { gravity: m.physics.gravity, hypothetical: m.physics.parts.some((p) => p.claim.evidence.startsWith('HIPOTÉTICO:')), parts: m.physics.parts.map(({ claim: _c, ...rest }) => rest) } }));
/** A joint is confirmed when a person stated it, or a person accepted it after it was proposed/extracted — and no later rejection/edit undid that. */
export function isConfirmed(m: Mechanism, jointId: string): boolean {
  const j = m.joints.find((x) => x.id === jointId); if (!j) return false;
  let confirmed = j.claim.origin === 'user';
  for (const e of m.events) if (e.target === jointId) { if (e.kind === 'accepted' && e.by === 'person') confirmed = true; else if (e.kind === 'rejected' || (e.kind === 'edited' && j.claim.origin !== 'user')) confirmed = false; }
  return confirmed;
}
/** What a result depends on: 'confirmed' only if every moving joint it uses is confirmed; otherwise it rests on hypotheses and must say so. */
export function basisOf(m: Mechanism, jointIds?: string[]): 'confirmed' | 'hypothesis' | 'mixed' {
  const ids = (jointIds ?? m.joints.map((j) => j.id)); /* a joint assumed RIGID is a hypothesis too: unconfirmed rigidity is as unconfirmed as an unconfirmed hinge */ if (!ids.length) return 'confirmed';
  const c = ids.filter((id) => isConfirmed(m, id)).length; return c === ids.length ? 'confirmed' : c === 0 ? 'hypothesis' : 'mixed';
}
export function withEvent(m: Mechanism, e: Omit<MechanismEvent, 'at'>, at = Date.now()): Mechanism { return { ...m, events: [...m.events, { ...e, at }] }; }
