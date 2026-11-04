import { createHash } from 'node:crypto';
import { validateSpatialPlanV2, type GeometryNodeV2, type MaterialV2, type SpatialPlanV2 } from '../../../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../../../src/universal-spatial/geometry-compiler-v2';
import { evaluateSpatialConstraintsV2 } from '../../../src/universal-spatial/constraints-v2';

/**
 * Hand-authored plans that stand in for a model response. They are INPUTS to the generic pipeline (contract, compiler, solver, stage), exactly where a
 * Muse Spark plan would enter. They were written by a person, not produced by Meta: the reply `meta` says so, and provenance is `design_approximation`
 * with that evidence. Nothing in `src/` knows about these objects; they exist to show what the pipeline does with a plan whose parameters are valid,
 * since the two saved Meta plans of PR #23 contain only generic placeholder shapes.
 */
type V3 = [number, number, number];
const mat = (profile: MaterialV2['profile'], color: string, roughness: number, metalness: number, clearcoat = 0): MaterialV2 => ({ profile, color, roughness, metalness, clearcoat });
const tf = (position: V3 = [0, 0, 0], rotationRad: V3 = [0, 0, 0], scale: V3 = [1, 1, 1]) => ({ position, rotationRad, scale });
type Shape = Extract<GeometryNodeV2, { type: 'shape' }>;
const shape = (key: string, operator: Shape['operator'], parameters: Record<string, unknown>, material: MaterialV2, transform = tf(), repeat: Shape['repeat'] = null): Shape => ({ type: 'shape', key, operator, parameters, transform, repeat, material });
const group = (key: string, children: GeometryNodeV2[], transform = tf()): GeometryNodeV2 => ({ type: 'group', key, transform, repeat: null, children });
const tube = (key: string, points: V3[], radius: number, material: MaterialV2, transform = tf()) => shape(key, 'tube', { points, radius, tubularSegments: Math.max(16, points.length * 12), radialSegments: 10 }, material, transform);
const component = (id: string, label: string, geometry: GeometryNodeV2, transform = tf(), evidence = 'Hand-authored fixture standing in for a model plan.', parentId: string | null = null) => ({ id, label, parentId, geometry, transform, provenance: { geometry: 'design_approximation' as const, transform: 'design_approximation' as const, material: 'design_approximation' as const, evidence } });

function finish(title: string, instruction: string, components: ReturnType<typeof component>[], unknowns: string[]): SpatialPlanV2 {
  return validateSpatialPlanV2({ contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: createHash('sha256').update(instruction).digest('hex') }, title, units: 'unitless', presentationProfile: 'neutral', components, relations: [], constraints: [], unknowns: ['Hand-authored fixture, not a Meta response.', 'Physical dimensions are unknown; proportions are conceptual.', ...unknowns] });
}

/** What the server returns for a plan, built locally so the harness can load it without any network or paid call. */
export function replyFromPlan(plan: SpatialPlanV2) {
  const compiled = compileSpatialPlanV2(plan); const constraintReport = evaluateSpatialConstraintsV2(plan, compiled.root); disposeCompiledSpatialPlan(compiled.root);
  const operators = new Set<string>(); let nodeCount = 0; const walk = (node: GeometryNodeV2) => { nodeCount++; if (node.type === 'group') node.children.forEach(walk); else operators.add(node.operator); }; plan.components.forEach((item) => walk(item.geometry));
  return {
    contract: 'unfold.spatial-plan.v2' as const, sessionId: '00000000-0000-4000-8000-000000000000', revision: 0, plan,
    sceneSummary: { componentCount: plan.components.length, geometryNodeCount: nodeCount, operators: [...operators], constraintReady: constraintReport.ready }, constraintReport,
    constructionEvents: [{ type: 'scene_created', at: 0 }, ...plan.components.map((item, index) => ({ type: 'component_placed', at: index + 1, entityId: item.id, transform: item.transform })), { type: 'assembly_ready', at: plan.components.length + 1 }, { type: 'scene_revealed', at: plan.components.length + 2 }],
    meta: { model: 'hand-authored-fixture', requestId: 'none', latencyMs: 0, estimatedCostUsd: 0 },
    limitations: ['Hand-authored fixture standing in for a model plan; not Meta output.'],
  };
}

/** "Build an aircraft engine": a high-bypass turbofan, axis along +X. Revolved cowl and core, radially repeated fan blades and guide vanes, a pylon. */
export function jetEngineReply() {
  const cowl = mat('industrial', '#c4cad1', 0.38, 0.35, 0.5), lip = mat('metal', '#e4e7eb', 0.22, 0.9), blade = mat('metal', '#a9b2bc', 0.28, 0.9), core = mat('metal', '#59616b', 0.34, 0.9), hot = mat('metal', '#3a4046', 0.4, 0.85), pylon = mat('industrial', '#8a9199', 0.45, 0.3, 0.3), vane = mat('metal', '#79828c', 0.35, 0.88), spinner = mat('accent', '#d8dce1', 0.25, 0.1, 0.7);
  const axisX: V3 = [0, 0, -Math.PI / 2];
  const components = [
    component('nacelle', 'Nacelle (cowl)', shape('nacelle-shell', 'revolve', { profile: [[1.5, -3.8], [1.64, -3.55], [1.76, -2.8], [1.76, 1.0], [1.42, 3.4], [1.22, 3.85], [1.12, 3.85], [1.3, 3.4], [1.52, 1.0], [1.52, -2.8], [1.4, -3.55], [1.5, -3.8]], segments: 96 }, cowl), tf([0, 0, 0], axisX)),
    component('inlet-lip', 'Inlet lip', shape('inlet-lip-ring', 'torus', { majorRadius: 1.5, tubeRadius: 0.1, radialSegments: 16, tubularSegments: 96 }, lip, tf([-3.78, 0, 0], [0, Math.PI / 2, 0]))),
    component('spinner', 'Fan spinner', shape('spinner-body', 'revolve', { profile: [[0, -4.05], [0.18, -3.9], [0.4, -3.45], [0.54, -2.95], [0.56, -2.55], [0, -2.55]], segments: 64 }, spinner), tf([0, 0, 0], axisX)),
    // A repeated GROUP, so each blade keeps its own pitch (a repeated shape's transform moves the whole ring, not each blade).
    component('fan-blades', 'Fan blades', { type: 'group', key: 'fan-blade-ring', transform: tf([-2.75, 0, 0]), repeat: { kind: 'radial', count: 18, axis: 'x', spacingOrRadius: 0.5 }, children: [
      shape('fan-blade', 'extrude', { profile: [[-0.3, -0.12], [0.26, -0.08], [0.34, 0.55], [0.24, 0.92], [-0.1, 0.9], [-0.22, 0.45]], depth: 0.05, bevelM: 0.012, curveSegments: 3 }, blade, tf([0, 0, 0], [0, 0.95, 0])),
    ] }),
    component('bypass-vanes', 'Outlet guide vanes', shape('guide-vane', 'box', { dimensions: [0.55, 0.75, 0.04] }, vane, tf([1.5, 0, 0]), { kind: 'radial', count: 14, axis: 'x', spacingOrRadius: 1.13 })),
    component('core', 'Engine core', shape('core-casing', 'revolve', { profile: [[0.46, -2.55], [0.72, -1.9], [0.84, -0.6], [0.84, 1.2], [0.7, 2.8], [0.5, 3.3], [0.0, 3.3]], segments: 80 }, core), tf([0, 0, 0], axisX)),
    component('exhaust-cone', 'Exhaust cone', shape('exhaust-cone-body', 'revolve', { profile: [[0.52, 3.2], [0.4, 3.55], [0.22, 4.05], [0, 4.45], [0, 3.2]], segments: 64 }, hot), tf([0, 0, 0], axisX)),
    component('pylon', 'Pylon', shape('pylon-plate', 'extrude', { profile: [[-1.7, 1.45], [1.9, 1.45], [1.3, 3.0], [-0.7, 3.1]], depth: 0.28, bevelM: 0.03, curveSegments: 3 }, pylon, tf([0, 0, -0.14]))),
  ];
  return replyFromPlan(finish('Turbofan engine (hand-authored fixture)', 'Build an aircraft engine.', components, ['Blade twist, internal compressor and turbine stages are not modelled.']));
}

/** A different kind of object on purpose (thin tubular frame, wheels with spokes, repeated elements): nothing in the pipeline was written for it. */
export function bicycleReply() {
  const frame = mat('industrial', '#b3261e', 0.3, 0.3, 0.6), rubber = mat('rubber', '#1b1d20', 0.9, 0), metal = mat('metal', '#b8bec6', 0.25, 0.9), seat = mat('organic', '#3b2a20', 0.7, 0), rim = mat('metal', '#9aa3ad', 0.25, 0.9);
  const wheel = (id: string, label: string, x: number) => component(id, label, group(`${id}-parts`, [
    shape(`${id}-tyre`, 'torus', { majorRadius: 0.33, tubeRadius: 0.035, radialSegments: 14, tubularSegments: 72 }, rubber),
    shape(`${id}-rim`, 'torus', { majorRadius: 0.292, tubeRadius: 0.012, radialSegments: 10, tubularSegments: 72 }, rim),
    shape(`${id}-spoke`, 'tube', { points: [[0, 0.02, 0], [0, 0.29, 0]], radius: 0.003, tubularSegments: 8, radialSegments: 6 }, metal, tf(), { kind: 'radial', count: 28, axis: 'z', spacingOrRadius: 0.001 }),
    shape(`${id}-hub`, 'cylinder', { radiusTop: 0.025, radiusBottom: 0.025, height: 0.1, radialSegments: 20 }, metal, tf([0, 0, 0], [Math.PI / 2, 0, 0])),
  ]), tf([x, 0.36, 0]));
  const components = [
    wheel('rear-wheel', 'Rear wheel', -0.52), wheel('front-wheel', 'Front wheel', 0.52),
    component('frame', 'Frame', group('frame-tubes', [
      tube('top-tube', [[-0.12, 0.8, 0], [0.4, 0.82, 0]], 0.016, frame), tube('down-tube', [[0.0, 0.3, 0], [0.42, 0.64, 0]], 0.019, frame), tube('seat-tube', [[0.0, 0.3, 0], [-0.12, 0.84, 0]], 0.016, frame),
      tube('head-tube', [[0.42, 0.62, 0], [0.4, 0.86, 0]], 0.024, frame),
      tube('chain-stay', [[0.0, 0.3, -0.05], [-0.52, 0.36, -0.05]], 0.011, frame), tube('chain-stay-r', [[0.0, 0.3, 0.05], [-0.52, 0.36, 0.05]], 0.011, frame),
      tube('seat-stay', [[-0.12, 0.8, -0.04], [-0.52, 0.36, -0.05]], 0.009, frame), tube('seat-stay-r', [[-0.12, 0.8, 0.04], [-0.52, 0.36, 0.05]], 0.009, frame),
    ])),
    component('fork', 'Fork and steering', group('fork-parts', [
      tube('fork-leg', [[0.42, 0.64, -0.04], [0.5, 0.36, -0.05]], 0.012, metal), tube('fork-leg-r', [[0.42, 0.64, 0.04], [0.5, 0.36, 0.05]], 0.012, metal),
      tube('stem', [[0.4, 0.86, 0], [0.37, 0.96, 0]], 0.014, metal), tube('handlebar', [[0.4, 0.97, -0.24], [0.34, 0.97, -0.12], [0.34, 0.97, 0.12], [0.4, 0.97, 0.24]], 0.013, rubber),
    ])),
    component('saddle', 'Saddle', group('saddle-parts', [
      tube('seat-post', [[-0.12, 0.8, 0], [-0.14, 0.9, 0]], 0.014, metal), shape('saddle-pad', 'ellipsoid', { radii: [0.15, 0.03, 0.075], widthSegments: 24, heightSegments: 12 }, seat, tf([-0.15, 0.93, 0])),
    ])),
    component('drivetrain', 'Crank and pedals', group('drivetrain-parts', [
      shape('chainring', 'cylinder', { radiusTop: 0.09, radiusBottom: 0.09, height: 0.01, radialSegments: 32 }, metal, tf([0, 0.3, 0.07], [Math.PI / 2, 0, 0])),
      tube('crank-arm', [[0, 0.3, 0.09], [0.1, 0.18, 0.09]], 0.01, metal), tube('crank-arm-l', [[0, 0.3, -0.09], [-0.1, 0.42, -0.09]], 0.01, metal),
      shape('pedal', 'box', { dimensions: [0.1, 0.014, 0.05] }, rubber, tf([0.1, 0.18, 0.13])), shape('pedal-l', 'box', { dimensions: [0.1, 0.014, 0.05] }, rubber, tf([-0.1, 0.42, -0.13])),
    ])),
  ];
  return replyFromPlan(finish('Bicycle (hand-authored fixture)', 'Build a bicycle.', components, ['Chain, brakes, cables and gears are not modelled.']));
}

/**
 * A pendulum clock built ONLY from what the real Meta run of PR #25 contained: 8 components (case, crown, base, two pairs of feet, dial, hands,
 * pendulum), the operators rounded_box, sphere, cylinder and tube, flat orange-brown wood colours, and the visible fault that the feet float off the plinth.
 * That run's normalised plan was not committed, so this is a hand-authored reproduction to give the new presentation layer a comparable, primitive-only input.
 * It is NOT the Meta output.
 */
export function clockLikeReply() {
  const evidence = 'Hand-authored fixture that reproduces the component list, operators and visible faults of the real Meta run of PR #25 (its plan was not kept). Not Meta output.';
  const wood = mat('organic', '#c9581f', 0.7, 0), dark = mat('organic', '#5c3b25', 0.7, 0), dialMat = mat('neutral', '#d9d9d6', 0.5, 0), black = mat('neutral', '#101010', 0.5, 0), brass = mat('metal', '#b8892b', 0.3, 0.9);
  const rot = (x: number): V3 => [x, 0, 0];
  const components = [
    component('clock-case', 'tall wooden case body', shape('case-body', 'rounded_box', { dimensions: [1.5, 4.2, 1.0], bevelM: 0.05, segments: 3 }, wood), tf([0, 3.4, 0]), evidence),
    component('clock-crown', 'top crown pediment', shape('crown-shape', 'rounded_box', { dimensions: [1.8, 0.45, 1.2], bevelM: 0.05, segments: 3 }, dark), tf([0, 2.3, 0]), evidence, 'clock-case'),
    component('clock-base', 'bottom plinth base', shape('base-shape', 'rounded_box', { dimensions: [1.9, 0.5, 1.3], bevelM: 0.05, segments: 3 }, dark), tf([0, -1.95, 0]), evidence, 'clock-case'),
    component('feet-front', 'front bun feet pair', shape('foot-front-shape', 'sphere', { radius: 0.15, widthSegments: 24, heightSegments: 16 }, dark, tf(), { kind: 'linear', count: 2, axis: 'x', spacingOrRadius: 1.3 }), tf([0, -2.5, 0.45]), evidence, 'clock-case'),
    component('feet-back', 'back bun feet pair', shape('foot-back-shape', 'sphere', { radius: 0.15, widthSegments: 24, heightSegments: 16 }, dark, tf(), { kind: 'linear', count: 2, axis: 'x', spacingOrRadius: 1.3 }), tf([0, -2.5, -0.45]), evidence, 'clock-case'),
    component('clock-dial', 'round clock dial', shape('dial-shape', 'cylinder', { radiusTop: 0.55, radiusBottom: 0.55, height: 0.08, radialSegments: 48 }, dialMat, tf([0, 0, 0], rot(Math.PI / 2))), tf([0, 1.3, 0.52]), evidence, 'clock-case'),
    component('clock-hands', 'dial hands set', group('hands', [
      shape('hour-hand', 'tube', { points: [[0, 0, 0.06], [0.12, 0.25, 0.06]], radius: 0.022, tubularSegments: 8, radialSegments: 8 }, black),
      shape('minute-hand', 'tube', { points: [[0, 0, 0.08], [-0.05, 0.4, 0.08]], radius: 0.016, tubularSegments: 8, radialSegments: 8 }, black),
      shape('hand-pin', 'sphere', { radius: 0.04, widthSegments: 16, heightSegments: 12 }, black, tf([0, 0, 0.08])),
    ]), tf(), evidence, 'clock-dial'),
    component('clock-pendulum', 'brass pendulum rod and disc', group('pendulum', [
      shape('pendulum-rod', 'tube', { points: [[0, 0.7, 0.58], [0, -1.5, 0.58]], radius: 0.02, tubularSegments: 8, radialSegments: 8 }, brass),
      shape('pendulum-bob', 'cylinder', { radiusTop: 0.28, radiusBottom: 0.28, height: 0.06, radialSegments: 40 }, brass, tf([0, -1.55, 0.58], rot(Math.PI / 2))),
    ]), tf(), evidence, 'clock-case'),
  ];
  return replyFromPlan(finish('grandfather pendulum clock - conceptual (hand-authored reproduction)', 'A grandfather pendulum clock: tall wooden case, round dial with hands, brass pendulum disc, and feet.', components, ['The real Meta plan of PR #25 was not kept; this reproduces its structure.']));
}
