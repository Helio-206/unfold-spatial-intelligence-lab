import { isValidShapeParametersV2 } from './contracts-v2';

/**
 * Field-level repair of one shape's parameters.
 *
 * PR #23 handled any invalid parameter by replacing the WHOLE shape with a fixed generic one (a 0.8 cube, a 0.3-radius cylinder, a straight 0.8 tube).
 * In the saved blind harp plan that is exactly what happened to the base, the strings, the pegs and the neck: a model-proposed long thin neck became a
 * fat 0.8 cube. Most of those failures were small (a count out of range, an alias such as `radius` for `radiusTop`, an extra key, a negative radius,
 * a self-crossing outline), and the proportions the model had chosen were perfectly usable.
 *
 * What this does and does not claim: every value it keeps was in the model's own output; every value it has to invent is listed in `defaulted`, and
 * every value it changes is listed in `repairs`. A caller must turn that into provenance (`design_approximation`) and an `unknown`; nothing here makes
 * a repaired value more certain than it was. If nothing geometric can be kept the result is generic, scaled by the size of the rest of the assembly,
 * and `salvaged` is false.
 */
export const OPERATORS_V2 = ['box', 'rounded_box', 'sphere', 'ellipsoid', 'cylinder', 'cone', 'torus', 'extrude', 'tube', 'revolve', 'loft'] as const;
export type OperatorV2 = (typeof OPERATORS_V2)[number];
export type RepairContext = { characteristicSize?: number };
export type RepairResult = { parameters: Record<string, unknown>; repairs: string[]; defaulted: string[]; salvaged: boolean };

const MAX = 1_000;
const KEYS: Record<OperatorV2, string[]> = {
  box: ['dimensions'], rounded_box: ['dimensions', 'bevelM', 'segments'], sphere: ['radius', 'widthSegments', 'heightSegments'], ellipsoid: ['radii', 'widthSegments', 'heightSegments'],
  cylinder: ['radiusTop', 'radiusBottom', 'height', 'radialSegments'], cone: ['radius', 'height', 'radialSegments'], torus: ['majorRadius', 'tubeRadius', 'radialSegments', 'tubularSegments'],
  extrude: ['profile', 'depth', 'bevelM', 'curveSegments'], tube: ['points', 'radius', 'tubularSegments', 'radialSegments'], revolve: ['profile', 'segments'], loft: ['profile', 'sections', 'capEnds'],
};
const ALIASES: Record<string, string[]> = { radialSegments: ['segments', 'radial_segments'], widthSegments: ['segments', 'width_segments'], heightSegments: ['height_segments'], height: ['length'], depth: ['thickness'], points: ['path'] };

export function defaultShapeParameters(operator: OperatorV2, size = 0.8): Record<string, unknown> {
  const s = size;
  switch (operator) {
    case 'box': return { dimensions: [s, s, s] };
    case 'rounded_box': return { dimensions: [s, s, s], bevelM: 0.075 * s, segments: 3 };
    case 'sphere': return { radius: 0.5 * s, widthSegments: 24, heightSegments: 16 };
    case 'ellipsoid': return { radii: [0.625 * s, 0.44 * s, 0.5 * s], widthSegments: 24, heightSegments: 16 };
    case 'cylinder': return { radiusTop: 0.375 * s, radiusBottom: 0.375 * s, height: 0.875 * s, radialSegments: 24 };
    case 'cone': return { radius: 0.44 * s, height: 0.875 * s, radialSegments: 24 };
    case 'torus': return { majorRadius: 0.5 * s, tubeRadius: 0.1 * s, radialSegments: 16, tubularSegments: 48 };
    case 'extrude': return { profile: [[-0.5 * s, -0.31 * s], [0.5 * s, -0.31 * s], [0.5 * s, 0.31 * s], [-0.5 * s, 0.31 * s]], depth: 0.19 * s, bevelM: 0.025 * s, curveSegments: 4 };
    case 'tube': return { points: [[-0.5 * s, 0, 0], [0.5 * s, 0, 0]], radius: 0.075 * s, tubularSegments: 24, radialSegments: 8 };
    case 'revolve': return { profile: [[0.25 * s, -0.44 * s], [0.44 * s, -0.25 * s], [0.44 * s, 0.25 * s], [0.25 * s, 0.44 * s]], segments: 24 };
    case 'loft': return { profile: [[-0.5 * s, -0.375 * s], [0.5 * s, -0.375 * s], [0.5 * s, 0.375 * s], [-0.5 * s, 0.375 * s]], sections: [[0, 1, 1], [0.75 * s, 0.7, 0.7]], capEnds: [true, true] };
  }
}

const isObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const turn = (a: number[], b: number[], c: number[]) => (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);

export function repairShapeParameters(operator: string, raw: unknown, context: RepairContext = {}): RepairResult {
  if (!(OPERATORS_V2 as readonly string[]).includes(operator)) throw new Error('SPATIAL_V2_REPAIR_OPERATOR_UNKNOWN');
  const op = operator as OperatorV2, size = context.characteristicSize && Number.isFinite(context.characteristicSize) && context.characteristicSize > 0 ? context.characteristicSize : 0.8;
  const defaults = defaultShapeParameters(op, size), repairs: string[] = [], defaulted: string[] = []; let kept = 0;
  const source: Record<string, unknown> = isObject(raw) ? { ...raw } : {};
  const consumed = new Set<string>();
  const take = (name: string): unknown => {
    for (const key of [name, ...(ALIASES[name] ?? [])]) if (Object.hasOwn(source, key) && source[key] !== undefined && source[key] !== null) { consumed.add(key); if (key !== name) repairs.push(`${key} read as ${name}`); return source[key]; }
    return undefined;
  };
  const num = (value: unknown, name: string): number | undefined => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) { repairs.push(`${name}: numeric string coerced`); return Number(value); }
    return undefined;
  };
  const positive = (name: string, fallback: number, value: unknown = take(name)): number => {
    const n = num(value, name);
    if (n === undefined || n === 0) { defaulted.push(name); return fallback; }
    kept++;
    if (n < 0) { repairs.push(`${name}: negative magnitude made positive`); return Math.min(MAX, -n); }
    if (n > MAX) { repairs.push(`${name}: clamped to ${MAX}`); return MAX; }
    return n;
  };
  const integer = (name: string, min: number, max: number, fallback: number): number => {
    const n = num(take(name), name);
    if (n === undefined) { defaulted.push(name); return fallback; }
    const rounded = Math.min(max, Math.max(min, Math.round(n)));
    if (rounded !== n) repairs.push(`${name}: ${n} moved into ${min}..${max}`);
    return rounded;
  };
  const triple = (name: string, fallback: number[], aliases: string[] = []): number[] => {
    let value = take(name);
    if (value === undefined) for (const alias of aliases) { if (Object.hasOwn(source, alias)) { consumed.add(alias); value = source[alias]; repairs.push(`${alias} read as ${name}`); break; } }
    if (typeof value === 'number' || typeof value === 'string') { const n = num(value, name); if (n !== undefined && n > 0) { kept++; repairs.push(`${name}: single value applied to all three axes`); return [Math.min(n, MAX), Math.min(n, MAX), Math.min(n, MAX)]; } }
    if (Array.isArray(value) && value.length === 3) {
      const parts = value.map((entry, i) => num(entry, `${name}[${i}]`));
      if (parts.every((n) => n !== undefined && n !== 0)) { kept++; return parts.map((n) => { const m = Math.abs(n!); if (m !== n) repairs.push(`${name}: negative magnitude made positive`); return Math.min(m, MAX); }); }
    }
    defaulted.push(name); return fallback;
  };
  const polygon = (name: string, fallback: number[][]): number[][] => {
    const value = take(name);
    if (Array.isArray(value)) {
      const clean: number[][] = [];
      for (const entry of value) if (Array.isArray(entry) && entry.length >= 2) { const x = num(entry[0], name), y = num(entry[1], name); if (x !== undefined && y !== undefined && Math.abs(x) <= MAX && Math.abs(y) <= MAX) { const last = clean[clean.length - 1]; if (!last || last[0] !== x || last[1] !== y) clean.push([x, y]); } }
      if (clean.length > 1) { const first = clean[0]!, last = clean[clean.length - 1]!; if (first[0] === last[0] && first[1] === last[1]) clean.pop(); }
      if (clean.length >= 3) {
        kept++;
        if (isValidShapeParametersV2(op, { ...defaults, profile: clean })) return clean;
        const cx = clean.reduce((a, p) => a + p[0]!, 0) / clean.length, cy = clean.reduce((a, p) => a + p[1]!, 0) / clean.length;
        const ordered = [...clean].sort((a, b) => Math.atan2(a[1]! - cy, a[0]! - cx) - Math.atan2(b[1]! - cy, b[0]! - cx) || Math.hypot(a[0]! - cx, a[1]! - cy) - Math.hypot(b[0]! - cx, b[1]! - cy));
        const area = ordered.reduce((a, p, i) => { const q = ordered[(i + 1) % ordered.length]!; return a + p[0]! * q[1]! - q[0]! * p[1]!; }, 0);
        if (Math.abs(area) > 1e-8 && ordered.length >= 3 && Math.abs(turn(ordered[0]!, ordered[1]!, ordered[2]!)) >= 0) { repairs.push(`${name}: self-crossing outline re-ordered around its centre`); return ordered; }
        repairs.push(`${name}: degenerate outline replaced by its bounding rectangle`);
        const xs = clean.map((p) => p[0]!), ys = clean.map((p) => p[1]!), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys), w = Math.max(x1 - x0, 1e-3), h = Math.max(y1 - y0, 1e-3);
        return [[x0, y0], [x0 + w, y0], [x0 + w, y0 + h], [x0, y0 + h]];
      }
    }
    defaulted.push(name); return fallback;
  };

  let candidate: Record<string, unknown>;
  switch (op) {
    case 'box': {
      const given = ['width', 'height', 'depth'].map((key) => (Object.hasOwn(source, key) ? num(source[key], key) : undefined));
      if (!Object.hasOwn(source, 'dimensions') && !Object.hasOwn(source, 'size') && given.some((n) => n !== undefined && n > 0)) {
        for (const key of ['width', 'height', 'depth']) consumed.add(key);
        const known = given.filter((n): n is number => n !== undefined && n > 0), mean = known.reduce((a, n) => a + n, 0) / known.length;
        candidate = { dimensions: given.map((n, i) => { if (n !== undefined && n > 0) { kept++; return Math.min(n, MAX); } defaulted.push(`dimensions[${i}]`); return mean; }) }; repairs.push('width/height/depth read as dimensions');
      } else candidate = { dimensions: triple('dimensions', defaults.dimensions as number[], ['size']) };
      break;
    }
    case 'rounded_box': {
      const dimensions = triple('dimensions', defaults.dimensions as number[], ['size']), half = Math.min(...dimensions) / 2;
      const bevelRaw = num(take('bevelM'), 'bevelM'); let bevelM = bevelRaw ?? Math.min(0.08 * Math.min(...dimensions), half);
      if (bevelRaw === undefined) defaulted.push('bevelM'); else if (bevelRaw < 0 || bevelRaw > half) { bevelM = Math.min(Math.max(0, bevelRaw), half * 0.9); repairs.push('bevelM: clamped to the box'); }
      candidate = { dimensions, bevelM, segments: integer('segments', 1, 8, 3) }; break;
    }
    case 'sphere': candidate = { radius: positive('radius', defaults.radius as number), widthSegments: integer('widthSegments', 8, 128, 24), heightSegments: integer('heightSegments', 6, 64, 16) }; break;
    case 'ellipsoid': candidate = { radii: triple('radii', defaults.radii as number[]), widthSegments: integer('widthSegments', 8, 128, 24), heightSegments: integer('heightSegments', 6, 64, 16) }; break;
    case 'cylinder': {
      const shared = take('radius'), diameter = Object.hasOwn(source, 'diameter') ? num(source.diameter, 'diameter') : undefined; if (diameter !== undefined && diameter > 0) { consumed.add('diameter'); repairs.push('diameter read as radius'); }
      const radius = shared ?? (diameter !== undefined && diameter > 0 ? diameter / 2 : undefined);
      const top = Object.hasOwn(source, 'radiusTop') ? take('radiusTop') : radius, bottom = Object.hasOwn(source, 'radiusBottom') ? take('radiusBottom') : radius;
      const fallbackRadius = defaults.radiusTop as number;
      const radiusTop = positive('radiusTop', fallbackRadius, top), radiusBottom = positive('radiusBottom', fallbackRadius, bottom);
      candidate = { radiusTop, radiusBottom, height: positive('height', defaults.height as number), radialSegments: integer('radialSegments', 8, 128, 24) }; break;
    }
    case 'cone': candidate = { radius: positive('radius', defaults.radius as number), height: positive('height', defaults.height as number), radialSegments: integer('radialSegments', 8, 128, 24) }; break;
    case 'torus': {
      const majorRadius = positive('majorRadius', defaults.majorRadius as number); let tubeRadius = positive('tubeRadius', Math.min(defaults.tubeRadius as number, majorRadius * 0.4));
      if (tubeRadius >= majorRadius) { tubeRadius = majorRadius * 0.4; repairs.push('tubeRadius: larger than majorRadius, reduced to 40% of it'); }
      candidate = { majorRadius, tubeRadius, radialSegments: integer('radialSegments', 8, 128, 16), tubularSegments: integer('tubularSegments', 8, 256, 48) }; break;
    }
    case 'extrude': {
      const profile = polygon('profile', defaults.profile as number[][]), depth = positive('depth', defaults.depth as number);
      const bevelRaw = num(take('bevelM'), 'bevelM'); let bevelM = bevelRaw ?? Math.min(defaults.bevelM as number, depth / 4);
      if (bevelRaw === undefined) defaulted.push('bevelM'); else if (bevelRaw < 0 || bevelRaw > depth / 2) { bevelM = Math.min(Math.max(0, bevelRaw), depth / 2); repairs.push('bevelM: clamped to half the depth'); }
      candidate = { profile, depth, bevelM, curveSegments: integer('curveSegments', 1, 32, 4) }; break;
    }
    case 'tube': {
      const value = take('points'); let points: number[][] | undefined;
      if (Array.isArray(value)) {
        const clean: number[][] = [];
        for (const entry of value) if (Array.isArray(entry) && entry.length === 3) { const p = entry.map((n) => num(n, 'points')); if (p.every((n) => n !== undefined && Math.abs(n) <= MAX)) clean.push(p as number[]); }
        if (clean.length < value.length) repairs.push(`points: ${value.length - clean.length} invalid point(s) removed`);
        if (clean.length >= 2) { points = clean.slice(0, 64); if (clean.length > 64) repairs.push('points: truncated to 64'); kept++; }
      }
      if (!points) { defaulted.push('points'); points = defaults.points as number[][]; }
      candidate = { points, radius: positive('radius', Math.min(defaults.radius as number, 0.05 * Math.max(...points.flat().map(Math.abs), size))), tubularSegments: integer('tubularSegments', 8, 512, Math.min(512, Math.max(24, points.length * 12))), radialSegments: integer('radialSegments', 6, 64, 8) }; break;
    }
    case 'revolve': {
      const value = take('profile'); let profile: number[][] | undefined;
      if (Array.isArray(value)) {
        const clean: number[][] = [];
        for (const entry of value) if (Array.isArray(entry) && entry.length >= 2) { const r = num(entry[0], 'profile'), y = num(entry[1], 'profile'); if (r !== undefined && y !== undefined && Math.abs(r) <= MAX && Math.abs(y) <= MAX) { if (r < 0) repairs.push('profile: negative radius made positive'); clean.push([Math.abs(r), y]); } }
        if (clean.length >= 2) { profile = clean.slice(0, 128); kept++; }
      }
      if (!profile) { defaulted.push('profile'); profile = defaults.profile as number[][]; }
      candidate = { profile, segments: integer('segments', 8, 128, 32) }; break;
    }
    case 'loft': {
      const profile = polygon('profile', defaults.profile as number[][]); const value = take('sections'); let sections: number[][] | undefined;
      if (Array.isArray(value)) {
        const clean: number[][] = [];
        for (const entry of value) if (Array.isArray(entry) && entry.length === 3) { const p = entry.map((n) => num(n, 'sections')); if (p.every((n) => n !== undefined) && Math.abs(p[0]!) <= MAX && p[1]! > 0 && p[1]! <= MAX && p[2]! > 0 && p[2]! <= MAX) clean.push(p as number[]); }
        if (clean.length >= 2) { sections = clean.slice(0, 64); kept++; }
      }
      if (!sections) { defaulted.push('sections'); sections = defaults.sections as number[][]; }
      const caps = take('capEnds'); const capEnds = Array.isArray(caps) && caps.length === 2 && caps.every((flag) => typeof flag === 'boolean') ? caps : (defaulted.push('capEnds'), [true, true]);
      candidate = { profile, sections, capEnds }; break;
    }
  }
  for (const key of Object.keys(source)) if (!consumed.has(key) && !KEYS[op].includes(key)) repairs.push(`dropped unknown key ${key}`);
  if (!isValidShapeParametersV2(op, candidate)) { return { parameters: defaults, repairs: [...repairs, 'repaired candidate still invalid: generic defaults used'], defaulted: [...KEYS[op]], salvaged: false }; }
  return { parameters: candidate, repairs, defaulted, salvaged: kept > 0 };
}

/** What `repairModelPlanShapes` did to one node. */
export type PlanRepairEntry = { componentId: string; key: string; operator: string; salvaged: boolean; repairs: string[]; defaulted: string[] };

type LooseNode = { type?: unknown; key?: unknown; operator?: unknown; parameters?: unknown; children?: unknown };
type LooseComponent = { id?: unknown; label?: unknown; transform?: { position?: unknown }; geometry?: unknown; provenance?: Record<string, unknown> };

/**
 * Repairs every invalid shape node of a model plan IN PLACE, before contract validation, so one wrong number never costs the whole shape.
 * A repaired component is marked `design_approximation` (never promoted to observed or inferred-with-evidence), the specifics are appended to its
 * evidence and to the plan-level `unknowns`. Valid nodes, and plans without any invalid node, are not modified at all.
 */
export function repairModelPlanShapes(plan: { components?: unknown; unknowns?: unknown }): PlanRepairEntry[] {
  const components = Array.isArray(plan.components) ? (plan.components as LooseComponent[]) : [];
  const positions = components.flatMap((component) => { const p = component?.transform?.position; return Array.isArray(p) && p.length === 3 && p.every((n) => typeof n === "number" && Number.isFinite(n)) ? [p as number[]] : []; });
  let span = 0; for (let axis = 0; axis < 3; axis++) { const values = positions.map((p) => p[axis]!); if (values.length) span = Math.max(span, Math.max(...values) - Math.min(...values)); }
  const characteristicSize = span > 0 ? span * 0.25 : undefined;
  const report: PlanRepairEntry[] = [];
  const unknowns = Array.isArray(plan.unknowns) ? (plan.unknowns as string[]) : undefined;
  for (const component of components) {
    if (!component || typeof component !== "object") continue;
    const touched: PlanRepairEntry[] = [];
    const walk = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const loose = node as LooseNode;
      if (loose.type === "group" && Array.isArray(loose.children)) { loose.children.forEach(walk); return; }
      if (loose.type !== "shape" || typeof loose.operator !== "string" || !(OPERATORS_V2 as readonly string[]).includes(loose.operator)) return;
      if (isValidShapeParametersV2(loose.operator, loose.parameters)) return;
      const result = repairShapeParameters(loose.operator, loose.parameters, { characteristicSize });
      loose.parameters = result.parameters;
      touched.push({ componentId: String(component.id), key: String(loose.key), operator: loose.operator, salvaged: result.salvaged, repairs: result.repairs, defaulted: result.defaulted });
    };
    walk(component.geometry);
    if (!touched.length) continue;
    report.push(...touched);
    const provenance = component.provenance;
    const detail = touched.map((entry) => `${entry.key} (${entry.operator}): ${entry.salvaged ? "kept the model values, " : "nothing usable, generic shape, "}${[...entry.repairs, ...entry.defaulted.map((name) => `${name} assumed`)].join("; ") || "replaced"}`).join(" | ");
    if (provenance) { provenance.geometry = "design_approximation"; provenance.evidence = `${String(provenance.evidence ?? "")} Parameter repair: ${detail}.`.slice(0, 500); }
    if (unknowns) for (const entry of touched) { const note = `Parameters of ${entry.key} (${entry.operator}) were ${entry.salvaged ? "partly repaired" : "invalid and replaced by a generic shape"}; the resulting proportions are a design approximation.`; if (!unknowns.includes(note)) { if (unknowns.length < 100) unknowns.push(note); else unknowns[99] = note; } }
  }
  return report;
}
