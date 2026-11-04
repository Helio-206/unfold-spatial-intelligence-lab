import { describe, it, expect } from 'vitest';
import { createOffsetBeam } from '../src/universal-spatial/parametric-e2a/offset-beam';
import { applySpatialOperationV2, validateSpatialPlanV2, type MaterialV2 } from '../src/universal-spatial/contracts-v2';
import { createAssembly, solveHingeTree, proposeAssembly } from '../src/universal-spatial/parametric-e2a/assembly';
const m: MaterialV2 = { profile:'industrial',color:'#aaaaaa',roughness:0.5,metalness:0.2,clearcoat:0 };
const d = { boomLength:4,stickLength:2.5,beamWidth:.5,beamHeight:.6,bucketWidth:1.5,bucketHeight:1,bucketDepth:1.2,plate:.12 };
describe('bounded hinge assembly', () => {
  it('closes a perturbed three-body chain without modifying input, geometry or rotations', () => {
    const a = createAssembly(d,m,[.2,-.8,.4]), input = structuredClone(a);
    input.bodies[1]!.position[1] += .3; input.bodies[2]!.position[2] -= .2;
    const snapshot = JSON.stringify(input), result = solveHingeTree(input.bodies,input.joints,1);
    expect(result.before.every(x => x.residual > .19)).toBe(true);
    expect(result.after.every(x => x.residual < 1e-10)).toBe(true);
    expect(result.bodies.map(b => b.rotationRad)).toEqual(input.bodies.map(b => b.rotationRad));
    expect(JSON.stringify(input)).toBe(snapshot);
  });
  it('rejects missing, duplicate and incompatible constraints, and excessive corrections', () => {
    const a = createAssembly(d,m,[0,.5,-.5]);
    expect(() => solveHingeTree(a.bodies,a.joints.slice(0,1),1)).toThrow();
    expect(() => solveHingeTree(a.bodies,[a.joints[0]!,a.joints[0]!],1)).toThrow();
    const bad = structuredClone(a.joints); bad[0]!.axisB=[0,1,0];
    expect(() => solveHingeTree(a.bodies,bad,1)).toThrow('INCOMPATIBLE_HINGE_AXES');
    a.bodies[1]!.position[0] += 2;
    expect(() => solveHingeTree(a.bodies,a.joints,1)).toThrow('CORRECTION_LIMIT');
  });
  it('validates non-mutating inferred V2 proposals with stable component and source identity', () => {
    const a = createAssembly(d,m,[.2,-.8,.4]);
    const p=validateSpatialPlanV2({contract:'unfold.spatial-plan.v2',source:{kind:'image',sha256:'a'.repeat(64)},title:'synthetic',units:'unitless',presentationProfile:'industrial',unknowns:[],constraints:[],relations:[],components:a.bodies.map(b=>({id:b.id,label:b.id,parentId:b.parentId,geometry:a.geometry[b.id],transform:{position:b.position,rotationRad:b.rotationRad,scale:[1,1,1]},provenance:{geometry:'unknown',transform:'unknown',material:'unknown',evidence:'synthetic'}}))});
    const snapshot=JSON.stringify(p), result=proposeAssembly(p,a,'Synthetic candidate; no physical measurement.');
    expect(result.operations).toHaveLength(6); expect(JSON.stringify(p)).toBe(snapshot);
    let next=p; for(const op of result.operations) next=applySpatialOperationV2(next,op,result.provenance);
    expect(next.source).toEqual(p.source); expect(next.components.map(c=>c.id)).toEqual(p.components.map(c=>c.id));
    expect(next.components.every(c=>c.provenance.geometry==='inferred' && c.provenance.transform==='inferred')).toBe(true);
    const scaled=structuredClone(p); scaled.components[0]!.transform.scale=[2,1,1];
    expect(()=>proposeAssembly(scaled,a,'candidate')).toThrow('NON_RIGID_PLAN_SCALE');
  });
  it('keeps distinct rigid body geometry and an explicit bucket opening', () => {
    const a = createAssembly(d,m,[0,0,0]);
    expect(Object.keys(a.geometry)).toEqual(['boom','stick','bucket']);
    expect(a.geometry.bucket?.type).toBe('group');
    if (a.geometry.bucket?.type === 'group') expect(a.geometry.bucket.children).toHaveLength(5);
    expect(a.bodies).toHaveLength(3);
  });
  it('builds bounded indexed offset beam surfaces with closed, paired edges', () => {
    const g=createOffsetBeam([{z:0,width:1,height:1,offsetX:0,offsetY:0},{z:2,width:.5,height:.8,offsetX:.2,offsetY:.3},{z:4,width:.4,height:.4,offsetX:.5,offsetY:.4}]);
    expect(g.getAttribute('position').count).toBe(12);
    const index=g.getIndex()!, edges=new Map<string,number>();
    for(let i=0;i<index.count;i+=3) for(const [a,b] of [[index.getX(i),index.getX(i+1)],[index.getX(i+1),index.getX(i+2)],[index.getX(i+2),index.getX(i)]]) { const k=[a,b].sort((x,y)=>x-y).join(':'); edges.set(k,(edges.get(k)??0)+1); }
    expect([...edges.values()].every(n=>n===2)).toBe(true);
    expect(Array.from(g.getAttribute('normal').array).every(Number.isFinite)).toBe(true);
    expect(()=>createOffsetBeam([{z:0,width:1,height:1,offsetX:0,offsetY:0},{z:0,width:1,height:1,offsetX:0,offsetY:0}])).toThrow();
    g.dispose();
  });
});
