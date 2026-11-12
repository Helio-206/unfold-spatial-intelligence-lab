import type { SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import { solveMechanism } from './kinematics';
import { emptyMechanism, type Joint, type Mechanism, type Vec3 } from './mechanism';
import { allGeometry, type ComponentGeometry } from './plan-geometry';

/**
 * Functional intelligence from geometry alone: which joints a plan's shapes SUGGEST, and what follows from a given set of joints (fixed vs movable parts, dependencies,
 * which joints are enough to drive the mechanism). Every joint produced here has origin 'extracted' (a heuristic reading of the geometry) and is a HYPOTHESIS until a
 * person confirms it: nothing is inferred about internal mechanisms that the geometry does not show, and parts are never given functions here — only geometric descriptors
 * ("cylindrical, 0.6 long"). Function names come from people or from a model's proposals, which keep their own origin.
 */
const EXTRACT = (evidence: string) => ({ origin: 'extracted' as const, evidence: evidence.slice(0, 400) });
const gap = (a: ComponentGeometry, b: ComponentGeometry): number => { if (!a.box || !b.box) return Infinity; const d = [0, 1, 2].map((i) => Math.max(a.box!.center[i]! - a.box!.half[i]! - (b.box!.center[i]! + b.box!.half[i]!), b.box!.center[i]! - b.box!.half[i]! - (a.box!.center[i]! + a.box!.half[i]!), 0)); return Math.hypot(d[0]!, d[1]!, d[2]!); };
const volume = (g: ComponentGeometry) => (g.box ? 8 * g.box.half[0] * g.box.half[1] * g.box.half[2] : 0);
const norm = (v: Vec3): Vec3 => { const l = Math.hypot(...v) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

export type InferenceOptions = { ground?: string; contactTolerance?: number; /** also propose 'fixed' joints between touching parts with no articulation clue */ includeFixed?: boolean };
export type InferenceResult = { mechanism: Mechanism; notes: string[]; descriptors: Record<string, string> };
export function proposeMechanism(plan: SpatialPlanV2, options: InferenceOptions = {}): InferenceResult {
  const planSha256 = plan.source.sha256, geo = allGeometry(plan), byId = new Map(geo.map((g) => [g.id, g])), notes: string[] = [];
  const ground = options.ground && byId.has(options.ground) ? options.ground : [...geo].sort((a, b) => volume(b) - volume(a) || (a.id < b.id ? -1 : 1))[0]!.id;
  if (!options.ground) notes.push(`Chão assumido: «${ground}» (a maior parte). Indique outro se não for o suporte.`);
  const m = emptyMechanism(planSha256, ground, plan.components.map((c) => c.id), plan.units), tol = options.contactTolerance ?? 0.02 * Math.max(1, ...geo.map((g) => (g.box ? Math.max(...g.box.half) : 0))), joints: Joint[] = [], pairs = new Set<string>();
  const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`), descriptors: Record<string, string> = {};
  for (const g of geo) { const c = g.clues.find((x) => x.axis); descriptors[g.id] = g.radialRepeat ? `repetição radial (${g.radialRepeat.count}×) em torno de um eixo` : c ? `forma ${c.operator === 'cylinder' ? 'cilíndrica' : c.operator === 'torus' ? 'toroidal' : c.operator === 'cone' ? 'cónica' : 'de revolução'}${c.radius ? `, raio ${c.radius.toFixed(3)}` : ''}` : g.unbounded ? 'forma sem limites simples (não analisada)' : 'forma prismática/compacta'; }
  const add = (a: ComponentGeometry, b: ComponentGeometry, kind: Joint['kind'], axis: Vec3, why: string, origin?: Vec3) => {
    const k = key(a.id, b.id); if (pairs.has(k)) return; pairs.add(k);
    const o = origin ?? (a.box && b.box ? ([0, 1, 2].map((i) => (a.box!.center[i]! + b.box!.center[i]!) / 2) as Vec3) : ([0, 0, 0] as Vec3));
    joints.push({ id: `j-${a.id}-${b.id}`.slice(0, 48), kind, parent: a.id, child: b.id, origin: o, axis: norm(axis), home: 0, claim: EXTRACT(why), ...(kind === 'revolute' ? { label: `Articulação ${a.id}–${b.id}` } : {}) });
  };
  const sorted = [...geo].sort((a, b) => (a.id < b.id ? -1 : 1));
  // R1: a declared coaxial constraint says two parts share an axis: the classic pin/hinge/bearing situation (a rotation about that axis is possible)
  for (const c of plan.constraints) if (c.kind === 'coaxial' && c.componentIds.length >= 2) { const a = byId.get(c.componentIds[0]!), b = byId.get(c.componentIds[1]!); if (a && b) { const ax = c.axis ? ([...{ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[c.axis]] as Vec3) : ([0, 1, 0] as Vec3); add(a, b, 'revolute', ax, `Restrição coaxial declarada entre ${a.id} e ${b.id} (eixo ${c.axis ?? 'y'}): os dois podem rodar em torno do eixo comum; a rotação não foi observada.`); } }
  // R2: an axis-shaped part (pin, shaft, wheel hub) touching other parts suggests a hinge about its own axis. A pin between TWO parts is one hinge between them (the pin rides
  // with the larger one); touching one part it is a hinge with that part; touching more, a hinge with the largest and rigid with the rest. Never two hinges in series on one axis.
  for (const g of sorted) { const clue = g.clues.find((c) => c.axis) ?? null, axis = g.radialRepeat?.axis ?? clue?.axis; if (!axis) continue;
    const touched = sorted.filter((o) => o.id !== g.id && gap(g, o) <= tol && !pairs.has(key(g.id, o.id))).sort((a, b) => volume(b) - volume(a) || (a.id < b.id ? -1 : 1)); if (!touched.length) continue; const centre = g.box ? g.box.center : ([0, 0, 0] as Vec3);
    const why = (o: string) => `${g.id} tem forma de eixo (${descriptors[g.id]}) e toca em ${o}: hipótese de rotação em torno do eixo da forma. A forma não prova que roda.`;
    if (touched.length >= 2 && !g.radialRepeat) { for (const o of touched) pairs.add(key(g.id, o.id)); /* every pin contact is accounted for below: no stray rigid joint may close a loop against the hinge */ const [a, b] = touched as [ComponentGeometry, ComponentGeometry]; add(a, b, 'revolute', axis as Vec3, `${g.id} (${descriptors[g.id]}) atravessa ${a.id} e ${b.id}: hipótese de dobradiça entre os dois em torno do eixo da forma. A forma não prova que roda.`, centre); pairs.delete(key(g.id, a.id)); add(a, g, 'fixed', [0, 1, 0], `${g.id} assumido solidário com ${a.id} (o pino acompanha uma das partes que liga); hipótese.`); for (const o of touched.slice(2)) add(a, o, 'fixed', [0, 1, 0], `${o.id} toca no mesmo pino: movimento relativo desconhecido, tratado como rígido.`); }
    else add(g, touched[0]!, 'revolute', axis as Vec3, why(touched[0]!.id), centre); }
  // R3: remaining touching pairs that the plan relates (or that touch): rigid unless someone says otherwise
  if (options.includeFixed !== false) for (let i = 0; i < sorted.length; i++) for (let j = i + 1; j < sorted.length; j++) { const a = sorted[i]!, b = sorted[j]!; if (pairs.has(key(a.id, b.id))) continue; const related = plan.relations.some((r) => key(r.fromId, r.toId) === key(a.id, b.id)); if (related || gap(a, b) <= tol) add(a, b, 'fixed', [0, 1, 0], `${a.id} e ${b.id} ${related ? 'estão relacionados no plano' : 'estão em contacto'} sem indício de articulação: movimento relativo DESCONHECIDO, tratado como rígido até alguém indicar o contrário.`); }
  // orient every joint so that parent is the side nearer the ground (deterministic BFS); joints that close a loop keep their orientation
  const adj = new Map<string, Joint[]>(); for (const j of joints) for (const p of [j.parent, j.child]) (adj.get(p) ?? adj.set(p, []).get(p)!).push(j);
  const seen = new Set<string>([ground]), q = [ground], oriented: Joint[] = []; const used = new Set<string>();
  while (q.length) { const p = q.shift()!; for (const j of (adj.get(p) ?? []).sort((a, b) => (a.id < b.id ? -1 : 1))) { if (used.has(j.id)) continue; const other = j.parent === p ? j.child : j.parent; if (seen.has(other)) continue; used.add(j.id); seen.add(other); oriented.push(j.parent === p ? j : { ...j, parent: j.child, child: j.parent }); q.push(other); } }
  for (const j of joints) if (!used.has(j.id)) oriented.push(j);
  const unlinked = plan.components.map((c) => c.id).filter((id) => !seen.has(id)); if (unlinked.length) notes.push(`Sem indício de ligação ao resto: ${unlinked.join(', ')}.`);
  return { mechanism: { ...m, joints: oriented.sort((a, b) => (a.id < b.id ? -1 : 1)) }, notes, descriptors };
}

export type FunctionalAnalysis = {
  fixedParts: string[]; movableParts: string[]; unlinkedParts: string[];
  dependencies: Array<{ joint: string; moves: string[] }>;
  /** smallest sets of joints that, when driven, leave no freedom (rank test at the rest pose): a possibility, not a statement about what drives the real object */
  actuatorSets: string[][]; mobility: number;
  loops: number; notes: string[];
};
export function analyseFunction(m: Mechanism): FunctionalAnalysis {
  const r = solveMechanism(m), movable = m.joints.filter((j) => j.kind !== 'fixed'), children = new Map<string, string[]>();
  for (const j of m.joints) (children.get(j.parent) ?? children.set(j.parent, []).get(j.parent)!).push(j.child);
  const below = (id: string, seen = new Set<string>()): string[] => { for (const c of children.get(id) ?? []) if (!seen.has(c)) { seen.add(c); below(c, seen); } return [...seen]; };
  const connected = new Set<string>([m.ground]); let grew = true; while (grew) { grew = false; for (const j of m.joints) { if (connected.has(j.parent) && !connected.has(j.child)) { connected.add(j.child); grew = true; } if (connected.has(j.child) && !connected.has(j.parent)) { connected.add(j.parent); grew = true; } } }
  const moving = new Set<string>(); for (const j of movable) { moving.add(j.child); below(j.child).forEach((p) => moving.add(p)); }
  // a part reached only through fixed joints from the ground is fixed; one below a movable joint is movable
  const movableParts = m.parts.filter((p) => moving.has(p) && p !== m.ground), fixedParts = m.parts.filter((p) => connected.has(p) && !moving.has(p));
  const dependencies = movable.map((j) => ({ joint: j.id, moves: [j.child, ...below(j.child)].filter((p, i, a) => a.indexOf(p) === i) }));
  const mobility = r.mobility.numerical, sets: string[][] = [];
  if (mobility > 0 && movable.length <= 14) { const idx = movable.map((j) => j.id); const comb = (k: number, start: number, cur: string[]) => { if (cur.length === k) { const inputs = Object.fromEntries(cur.map((id) => [id, m.joints.find((j) => j.id === id)!.home])), s = solveMechanism(m, { inputs }); if (s.status === 'solved' && s.freeDofAtSolution === 0) sets.push([...cur]); return; } for (let i = start; i < idx.length && sets.length < 6; i++) comb(k, i + 1, [...cur, idx[i]!]); }; comb(mobility, 0, []); }
  const loops = m.joints.length - (connected.size - 1);
  return { fixedParts, movableParts, unlinkedParts: m.parts.filter((p) => !connected.has(p)), dependencies, actuatorSets: sets, mobility, loops: Math.max(0, loops), notes: [`Mobilidade ${mobility} (Grübler ${r.mobility.gruebler.value}); ${r.mobility.note}`, 'Conjuntos accionáveis são possibilidades de cálculo (juntas que bastam para determinar o movimento), não afirmações sobre o actuador real.'] };
}
