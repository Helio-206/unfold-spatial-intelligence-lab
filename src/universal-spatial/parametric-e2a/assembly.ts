import { Euler, Matrix4, Vector3 } from 'three';
import { applySpatialOperationV2, type GeometryNodeV2, type MaterialV2, type SpatialOperationV2, type SpatialPlanV2 } from '../contracts-v2';
import { measureJointClosure, taperedBeam, type BodyFrame, type Joint, type Vec3 } from './index';

export type Hinge = Joint & { axisA: Vec3; axisB: Vec3 };
export type Assembly = { bodies: BodyFrame[]; joints: Hinge[]; geometry: Record<string, GeometryNodeV2> };
export type AssemblyDimensions = { boomLength: number; stickLength: number; beamWidth: number; beamHeight: number; bucketWidth: number; bucketHeight: number; bucketDepth: number; plate: number };
const ID = /^[a-z][a-z0-9-]{0,47}$/;
const identity = () => ({ position: [0,0,0] as Vec3, rotationRad: [0,0,0] as Vec3, scale: [1,1,1] as Vec3 });
const validVector = (v: Vec3) => Array.isArray(v) && v.length === 3 && v.every(n => Number.isFinite(n) && Math.abs(n) <= 1000);
const rotation = (v: Vec3) => new Matrix4().makeRotationFromEuler(new Euler(...v));

/** Fixed rotations, translating only children to close a connected parent-child hinge tree. */
export function solveHingeTree(input: BodyFrame[], joints: Hinge[], maxCorrection: number, axisTolerance = 1e-6): { bodies: BodyFrame[]; before: ReturnType<typeof measureJointClosure>; after: ReturnType<typeof measureJointClosure> } {
  if (!Number.isFinite(maxCorrection) || maxCorrection < 0 || maxCorrection > 1000 || !Number.isFinite(axisTolerance) || axisTolerance < 0 || axisTolerance > 0.1 || input.length < 2 || input.length > 64 || joints.length !== input.length - 1) throw new Error('UNDERCONSTRAINED_OR_BUDGET');
  const before = measureJointClosure(input, joints);
  const byId = new Map(input.map(b => [b.id, b]));
  const roots = input.filter(b => b.parentId === null);
  if (roots.length !== 1 || byId.size !== input.length) throw new Error('INVALID_HIERARCHY');
  const incoming = new Map<string, Hinge>();
  for (const j of joints) {
    if (!ID.test(j.id) || !byId.has(j.a) || !byId.has(j.b) || byId.get(j.b)!.parentId !== j.a || incoming.has(j.b)) throw new Error('CONTRADICTORY_JOINTS');
    if (!validVector(j.axisA) || !validVector(j.axisB)) throw new Error('INVALID_AXIS');
    const a = new Vector3(...j.axisA), b = new Vector3(...j.axisB);
    if (Math.abs(a.length() - 1) > 1e-6 || Math.abs(b.length() - 1) > 1e-6 || 1 - Math.abs(a.dot(b.applyMatrix4(rotation(byId.get(j.b)!.rotationRad)))) > axisTolerance) throw new Error('INCOMPATIBLE_HINGE_AXES');
    incoming.set(j.b, j);
  }
  const bodies = input.map(b => ({ ...b, position: [...b.position] as Vec3, rotationRad: [...b.rotationRad] as Vec3 }));
  const result = new Map(bodies.map(b => [b.id, b]));
  for (const b of bodies) {
    if (b.parentId === null) continue;
    const j = incoming.get(b.id); if (!j) throw new Error('UNDERCONSTRAINED_OR_BUDGET');
    const target = new Vector3(...j.anchorA).sub(new Vector3(...j.anchorB).applyMatrix4(rotation(b.rotationRad)));
    if (target.distanceTo(new Vector3(...b.position)) > maxCorrection || !validVector(target.toArray() as Vec3)) throw new Error('CORRECTION_LIMIT');
    result.get(b.id)!.position = target.toArray() as Vec3;
  }
  const after = measureJointClosure(bodies, joints);
  if (after.some(x => x.residual > 1e-7)) throw new Error('CLOSURE_FAILED');
  return { bodies, before, after };
}

/** Five closed plate solids around an explicit open mouth; seams are not boolean-unioned. */
export function bucketShell(key: string, d: AssemblyDimensions, material: MaterialV2): GeometryNodeV2 {
  if (!ID.test(key) || key.length > 38 || Object.values(d).some(n => !Number.isFinite(n) || n <= 0 || n > 1000) || 2*d.plate >= Math.min(d.bucketWidth, d.bucketHeight, d.bucketDepth)) throw new Error('INVALID_BUCKET');
  const w=d.bucketWidth, h=d.bucketHeight, z=d.bucketDepth, t=d.plate;
  const box = (name: string, dimensions: Vec3, position: Vec3): GeometryNodeV2 => ({ type:'shape', key:`${key}-${name}`, operator:'box', parameters:{ dimensions }, transform:{ ...identity(), position }, repeat:null, material:{ ...material } });
  return { type:'group', key, transform:identity(), repeat:null, children:[
    box('floor', [w,t,z], [0,t/2,z/2]), box('back', [w,h,t], [0,h/2,t/2]),
    box('left', [t,h,z], [-(w-t)/2,h/2,z/2]), box('right', [t,h,z], [(w-t)/2,h/2,z/2]),
    box('mount', [w*0.35,t*2,t*2], [0,h,t*1.5]),
  ] };
}

/** Dimensions and pose are supplied hypotheses; no defaults or source-image inferences. */
export function createAssembly(d: AssemblyDimensions, material: MaterialV2, angles: [number, number, number]): Assembly {
  if (Object.values(d).some(n => !Number.isFinite(n) || n <= 0 || n > 1000) || !validVector(angles)) throw new Error('INVALID_ASSEMBLY');
  const beam = (key:string, length:number) => taperedBeam(key, [{z:0,width:d.beamWidth,height:d.beamHeight},{z:length*0.55,width:d.beamWidth*0.8,height:d.beamHeight*0.8},{z:length,width:d.beamWidth*0.65,height:d.beamHeight*0.65}], material);
  const bodies: BodyFrame[] = [
    {id:'boom',parentId:null,position:[0,0,0],rotationRad:[angles[0],0,0]},
    {id:'stick',parentId:'boom',position:[0,0,d.boomLength],rotationRad:[angles[1],0,0]},
    {id:'bucket',parentId:'stick',position:[0,0,d.stickLength],rotationRad:[angles[2],0,0]},
  ];
  const joints: Hinge[] = [
    {id:'boom-stick',a:'boom',b:'stick',anchorA:[0,0,d.boomLength],anchorB:[0,0,0],axisA:[1,0,0],axisB:[1,0,0]},
    {id:'stick-bucket',a:'stick',b:'bucket',anchorA:[0,0,d.stickLength],anchorB:[0,d.bucketHeight,d.plate*1.5],axisA:[1,0,0],axisB:[1,0,0]},
  ];
  const solved = solveHingeTree(bodies, joints, 1000);
  return { bodies: solved.bodies, joints, geometry:{ boom:beam('boom-shape',d.boomLength), stick:beam('stick-shape',d.stickLength), bucket:bucketShell('bucket-shape',d,material) } };
}

/** Proposed operations only; caller must bind revision/source and seek human approval. */
export function proposeAssembly(plan: SpatialPlanV2, assembly: Assembly, evidence: string): { operations: SpatialOperationV2[]; provenance: { origin: 'inferred'; evidence: string } } {
  if (!evidence.trim() || evidence.length > 500 || assembly.bodies.length > 16) throw new Error('INVALID_PROPOSAL');
  solveHingeTree(assembly.bodies, assembly.joints, 1e-7);
  let candidate = plan;
  const provenance = { origin:'inferred' as const, evidence }, operations: SpatialOperationV2[] = [];
  for (const body of assembly.bodies) {
    const c = candidate.components.find(x => x.id === body.id), geometry = assembly.geometry[body.id];
    if (!c || !geometry || c.parentId !== body.parentId || c.geometry.key !== geometry.key) throw new Error('IDENTITY_OR_HIERARCHY_MISMATCH');
    if (c.transform.scale.some(x => x !== 1)) throw new Error('NON_RIGID_PLAN_SCALE');
    const ops: SpatialOperationV2[] = [
      {contract:'unfold.spatial-operation.v2', operationId:`assembly-geometry-${body.id}`,kind:'set-geometry',componentId:body.id,nodeKey:geometry.key,value:geometry},
      {contract:'unfold.spatial-operation.v2', operationId:`assembly-transform-${body.id}`,kind:'set-transform',componentId:body.id,nodeKey:null,value:{position:body.position,rotationRad:body.rotationRad,scale:[1,1,1]}},
    ];
    for (const op of ops) { candidate = applySpatialOperationV2(candidate, op, provenance); operations.push(op); }
  }
  return { operations, provenance };
}
