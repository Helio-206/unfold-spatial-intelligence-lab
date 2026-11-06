/**
 * Hand-authored COARSE plans standing in for what the interpretation step (Meta or the local reconstruction) returns for a picture: primitives with labels, positions
 * and colours, no detail. They are inputs, never models: the Foundry derives every detail from the roles and parameters. Each family has "development" plans (used while
 * building the generator) and "unseen" plans (written afterwards, used only for evaluation).
 */
import { validateSpatialPlanV2, type SpatialPlanV2 } from '../../../universal-spatial/contracts-v2';

type V3 = [number, number, number];
export type Part = { id: string; label: string; op: 'box' | 'cylinder' | 'ellipsoid' | 'sphere' | 'cone'; size: V3; pos: V3; rot?: V3; color?: string; profile?: 'neutral' | 'industrial' | 'organic' | 'glass' | 'rubber' | 'metal' | 'accent'; parent?: string | null };
const T = (position: V3, rotationRad: V3 = [0, 0, 0]) => ({ position, rotationRad, scale: [1, 1, 1] as V3 });
const geometryOf = (p: Part) => {
  const [x, y, z] = p.size;
  const parameters = p.op === 'box' ? { dimensions: [x, y, z] } : p.op === 'cylinder' ? { radiusTop: x / 2, radiusBottom: x / 2, height: y, radialSegments: 24 } : p.op === 'cone' ? { radius: x / 2, height: y, radialSegments: 24 } : p.op === 'sphere' ? { radius: x / 2, widthSegments: 24, heightSegments: 16 } : { radii: [x / 2, y / 2, z / 2], widthSegments: 24, heightSegments: 16 };
  return { type: 'shape' as const, key: `${p.id}-shape`, operator: p.op, parameters, transform: T([0, 0, 0]), repeat: null, material: { profile: p.profile ?? 'neutral', color: p.color ?? '#9aa0a6', roughness: 0.6, metalness: 0, clearcoat: 0 } };
};
export function planOf(title: string, parts: Part[], profile: SpatialPlanV2['presentationProfile'] = 'neutral', seed = 'f'): SpatialPlanV2 {
  return validateSpatialPlanV2({
    contract: 'unfold.spatial-plan.v2', source: { kind: 'text', sha256: seed.repeat(64).slice(0, 64) }, title, units: 'm', presentationProfile: profile,
    components: parts.map((p) => ({ id: p.id, label: p.label, parentId: p.parent ?? null, geometry: geometryOf(p), transform: T(p.pos, p.rot), provenance: { geometry: 'inferred', transform: 'inferred', material: 'inferred', evidence: 'coarse stand-in plan (fixture)' } })),
    relations: [], constraints: [], unknowns: ['exact proportions are estimated'],
  });
}
const wheels = (L: number, Wd: number, R: number, w: number, color = '#1b1b1d'): Part[] => [[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz], i) => ({ id: `wheel-${i}`, label: `Wheel ${i + 1}`, op: 'cylinder' as const, size: [R * 2, w, R * 2] as V3, pos: [sx! * L * 0.31, R, sz! * (Wd / 2 - w / 2 + 0.02)] as V3, rot: [Math.PI / 2, 0, 0] as V3, color }));

/** Vehicles. Development: sedan. Unseen: red hatchback, tall green SUV. */
export const sedan = () => planOf('Sedan', [{ id: 'body', label: 'Car body', op: 'box', size: [4.5, 1.45, 1.8], pos: [0, 0.78, 0], color: '#5b7aa6' }, ...wheels(4.5, 1.8, 0.33, 0.24)]);
export const hatchback = () => planOf('Compact hatchback', [{ id: 'body', label: 'Hatchback body', op: 'box', size: [3.7, 1.42, 1.7], pos: [0, 0.76, 0], color: '#b3302a' }, ...wheels(3.7, 1.7, 0.3, 0.2)], 'neutral', 'a');
export const suv = () => planOf('Family SUV', [{ id: 'body', label: 'SUV body', op: 'box', size: [4.8, 1.8, 1.95], pos: [0, 0.98, 0], color: '#43604a' }, ...wheels(4.8, 1.95, 0.4, 0.28)], 'neutral', 'b');
/** Furniture. Development: chair. Unseen: dining table, sofa. */
export const chair = () => planOf('Chair', [
  { id: 'seat', label: 'Seat cushion', op: 'box', size: [0.46, 0.1, 0.46], pos: [0, 0.45, 0], color: '#7c8794' }, { id: 'back', label: 'Backrest', op: 'box', size: [0.46, 0.5, 0.07], pos: [0, 0.77, -0.2], color: '#7c8794' },
  ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz], i): Part => ({ id: `leg-${i}`, label: `Leg ${i + 1}`, op: 'box', size: [0.05, 0.4, 0.05], pos: [sx! * 0.2, 0.2, sz! * 0.2], color: '#8a5a33' })),
], 'neutral', 'c');
export const table = () => planOf('Dining table', [
  { id: 'top', label: 'Table top', op: 'box', size: [1.8, 0.05, 0.9], pos: [0, 0.75, 0], color: '#a87444' }, { id: 'apron', label: 'Apron frame', op: 'box', size: [1.6, 0.09, 0.7], pos: [0, 0.675, 0], color: '#a87444' },
  ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz], i): Part => ({ id: `leg-${i}`, label: `Leg ${i + 1}`, op: 'box', size: [0.08, 0.72, 0.08], pos: [sx! * 0.82, 0.36, sz! * 0.37], color: '#8a5a33' })),
], 'neutral', 'd');
export const sofa = () => planOf('Three-seat sofa', [
  { id: 'seat-a', label: 'Seat cushion left', op: 'box', size: [0.7, 0.18, 0.8], pos: [-0.7, 0.34, 0.05], color: '#4a5d70' }, { id: 'seat-b', label: 'Seat cushion middle', op: 'box', size: [0.7, 0.18, 0.8], pos: [0, 0.34, 0.05], color: '#4a5d70' }, { id: 'seat-c', label: 'Seat cushion right', op: 'box', size: [0.7, 0.18, 0.8], pos: [0.7, 0.34, 0.05], color: '#4a5d70' },
  { id: 'back', label: 'Backrest', op: 'box', size: [2.2, 0.5, 0.22], pos: [0, 0.68, -0.36], color: '#4a5d70' }, { id: 'arm-l', label: 'Arm left', op: 'box', size: [0.2, 0.3, 0.9], pos: [-1.18, 0.5, 0], color: '#4a5d70' }, { id: 'arm-r', label: 'Arm right', op: 'box', size: [0.2, 0.3, 0.9], pos: [1.18, 0.5, 0], color: '#4a5d70' },
  ...[[1, 1], [1, -1], [-1, 1], [-1, -1]].map(([sx, sz], i): Part => ({ id: `leg-${i}`, label: `Leg ${i + 1}`, op: 'box', size: [0.06, 0.16, 0.06], pos: [sx! * 1.1, 0.08, sz! * 0.4], color: '#2c2a28' })),
], 'neutral', 'e');

/** Electronics. Development: laptop. Unseen: desktop monitor. */
export const laptop = () => planOf('Laptop computer', [
  { id: 'base', label: 'Keyboard base', op: 'box', size: [0.33, 0.018, 0.23], pos: [0, 0.009, 0], color: '#a9adb3' },
  { id: 'screen', label: 'Display lid', op: 'box', size: [0.33, 0.22, 0.012], pos: [0, 0.128, -0.115], rot: [-0.18, 0, 0], color: '#a9adb3' },
  { id: 'hinge', label: 'Hinge', op: 'cylinder', size: [0.012, 0.28, 0.012], pos: [0, 0.018, -0.118], rot: [0, 0, Math.PI / 2], color: '#55585d' },
], 'neutral', 'f');
export const monitor = () => planOf('Desktop monitor', [
  { id: 'screen', label: 'Monitor display', op: 'box', size: [0.62, 0.37, 0.025], pos: [0, 0.34, 0], color: '#202226' },
  { id: 'neck', label: 'Stand neck', op: 'box', size: [0.07, 0.16, 0.03], pos: [0, 0.075, -0.03], color: '#202226' },
  { id: 'foot', label: 'Stand foot', op: 'box', size: [0.3, 0.015, 0.2], pos: [0, 0.0075, -0.02], color: '#202226' },
], 'neutral', '1');
/** Appliances. Development: fridge. Unseen: front-loading washing machine. */
export const fridge = () => planOf('Refrigerator', [
  { id: 'body', label: 'Fridge cabinet', op: 'box', size: [0.6, 1.8, 0.65], pos: [0, 0.9, 0], color: '#e9ecee' },
  { id: 'door-top', label: 'Freezer door', op: 'box', size: [0.58, 0.55, 0.04], pos: [0, 1.5, 0.34], color: '#e9ecee' },
  { id: 'door-bottom', label: 'Fridge door', op: 'box', size: [0.58, 1.1, 0.04], pos: [0, 0.65, 0.34], color: '#e9ecee' },
], 'neutral', '2');
export const washer = () => planOf('Washing machine', [
  { id: 'body', label: 'Washer cabinet', op: 'box', size: [0.6, 0.85, 0.6], pos: [0, 0.425, 0], color: '#f1f2f3' },
  { id: 'door', label: 'Washer door', op: 'box', size: [0.46, 0.46, 0.05], pos: [0, 0.42, 0.32], color: '#f1f2f3' },
  { id: 'panel', label: 'Control panel', op: 'box', size: [0.58, 0.1, 0.03], pos: [0, 0.78, 0.31], color: '#2a2c30' },
], 'neutral', '3');
/** Architecture. Development: house. Unseen: open pavilion with columns. */
export const house = () => planOf('House', [
  { id: 'slab', label: 'Foundation slab', op: 'box', size: [7.4, 0.3, 5.4], pos: [0, 0.15, 0], color: '#8d8e8a' },
  { id: 'wall-front', label: 'Front wall', op: 'box', size: [7, 2.8, 0.25], pos: [0, 1.7, 2.5], color: '#e8e1d2' }, { id: 'wall-back', label: 'Back wall', op: 'box', size: [7, 2.8, 0.25], pos: [0, 1.7, -2.5], color: '#e8e1d2' },
  { id: 'wall-left', label: 'Left wall', op: 'box', size: [0.25, 2.8, 5], pos: [-3.5, 1.7, 0], color: '#e8e1d2' }, { id: 'wall-right', label: 'Right wall', op: 'box', size: [0.25, 2.8, 5], pos: [3.5, 1.7, 0], color: '#e8e1d2' },
  { id: 'roof', label: 'Pitched roof', op: 'box', size: [7.8, 1.6, 6], pos: [0, 3.9, 0], color: '#6b4a3f' },
  { id: 'window-a', label: 'Window left', op: 'box', size: [1.2, 1.2, 0.12], pos: [-1.9, 1.9, 2.55], color: '#9fc3d4' }, { id: 'window-b', label: 'Window right', op: 'box', size: [1.2, 1.2, 0.12], pos: [1.9, 1.9, 2.55], color: '#9fc3d4' },
  { id: 'door', label: 'Front door', op: 'box', size: [1, 2.1, 0.12], pos: [0, 1.35, 2.56], color: '#6b4a2a' },
], 'neutral', '4');
export const pavilion = () => planOf('Garden pavilion', [
  { id: 'floor', label: 'Floor slab', op: 'box', size: [6, 0.25, 4], pos: [0, 0.125, 0], color: '#a9a8a2' },
  ...[[1, 1], [1, -1], [-1, 1], [-1, -1], [0, 1], [0, -1]].map(([sx, sz], i): Part => ({ id: `column-${i}`, label: `Column ${i + 1}`, op: 'cylinder', size: [0.3, 3, 0.3], pos: [sx! * 2.6, 1.75, sz! * 1.6], color: '#d8d4c8' })),
  { id: 'roof', label: 'Flat roof slab', op: 'box', size: [6.4, 0.35, 4.4], pos: [0, 3.425, 0], color: '#8b8c88' },
], 'neutral', '5');
/** Tools. Development: hammer. Unseen: open-end spanner. */
export const hammer = () => planOf('Claw hammer', [
  { id: 'handle', label: 'Handle', op: 'cylinder', size: [0.032, 0.32, 0.032], pos: [0, 0.16, 0], rot: [0, 0, Math.PI / 2], color: '#b9482f' },
  { id: 'head', label: 'Hammer head', op: 'box', size: [0.035, 0.035, 0.17], pos: [0.17, 0.16, 0], color: '#8d9096' },
], 'neutral', '6');
export const wrench = () => planOf('Open-end spanner', [
  { id: 'handle', label: 'Wrench handle', op: 'box', size: [0.2, 0.022, 0.008], pos: [0, 0, 0], color: '#a8acb2' },
  { id: 'head', label: 'Wrench head', op: 'box', size: [0.05, 0.05, 0.008], pos: [0.12, 0, 0], color: '#a8acb2' },
], 'neutral', '7');
/** Organic. Development: vase. Unseen: apple, potted plant. */
export const vase = () => planOf('Ceramic vase', [{ id: 'body', label: 'Vase body', op: 'ellipsoid', size: [0.18, 0.34, 0.18], pos: [0, 0.17, 0], color: '#3f6c8f' }], 'organic', '8');
export const apple = () => planOf('Apple', [{ id: 'body', label: 'Apple fruit', op: 'ellipsoid', size: [0.08, 0.072, 0.08], pos: [0, 0.036, 0], color: '#b52a2a' }, { id: 'stem', label: 'Apple stem', op: 'cylinder', size: [0.006, 0.02, 0.006], pos: [0, 0.075, 0], color: '#5b4025' }], 'organic', '9');
export const plant = () => planOf('Potted plant', [
  { id: 'pot', label: 'Plant pot', op: 'cylinder', size: [0.2, 0.18, 0.2], pos: [0, 0.09, 0], color: '#b5593a' },
  { id: 'stem', label: 'Stem', op: 'cylinder', size: [0.02, 0.35, 0.02], pos: [0, 0.35, 0], color: '#5f7f3e' },
  { id: 'leaf-a', label: 'Leaf left', op: 'ellipsoid', size: [0.26, 0.012, 0.11], pos: [-0.13, 0.5, 0], rot: [0, 0, 0.4], color: '#4f7a3c' }, { id: 'leaf-b', label: 'Leaf right', op: 'ellipsoid', size: [0.26, 0.012, 0.11], pos: [0.13, 0.42, 0], rot: [0, 0, -0.4], color: '#4f7a3c' },
], 'organic', 'a');
/** Construction. Unseen: mini wheel-less crawler excavator composed from roles only (no excavator model is reused). */
export const miniExcavator = () => planOf('Mini excavator', [
  { id: 'track-l', label: 'Left track', op: 'box', size: [1.9, 0.5, 0.45], pos: [0, 0.25, -0.75], color: '#2a2c30' }, { id: 'track-r', label: 'Right track', op: 'box', size: [1.9, 0.5, 0.45], pos: [0, 0.25, 0.75], color: '#2a2c30' },
  { id: 'house', label: 'Upper body house', op: 'box', size: [1.7, 0.7, 1.5], pos: [-0.1, 0.85, 0], color: '#d9a21b' }, { id: 'cab', label: 'Operator cab', op: 'box', size: [0.9, 1.1, 0.8], pos: [0.2, 1.75, 0.25], color: '#d9a21b' },
  { id: 'boom', label: 'Boom', op: 'box', size: [2.3, 0.35, 0.3], pos: [1.5, 1.4, -0.35], rot: [0, 0, 0.35], color: '#d9a21b' }, { id: 'stick', label: 'Stick arm', op: 'box', size: [1.4, 0.25, 0.25], pos: [2.7, 1.2, -0.35], rot: [0, 0, -0.9], color: '#d9a21b' },
  { id: 'bucket', label: 'Bucket', op: 'box', size: [0.55, 0.45, 0.5], pos: [3.2, 0.6, -0.35], color: '#4a4d52' }, { id: 'cyl-boom', label: 'Boom hydraulic cylinder', op: 'cylinder', size: [0.12, 1.2, 0.12], pos: [1, 1.5, -0.1], rot: [0, 0, 1.2], color: '#cfd2d6' },
], 'industrial', 'b');
