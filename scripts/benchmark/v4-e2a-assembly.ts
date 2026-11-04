import { Mesh, Vector3 } from 'three';
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { validateSpatialPlanV2, type MaterialV2 } from '../../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../../src/universal-spatial/geometry-compiler-v2';
import { createAssembly, solveHingeTree, type Assembly, type AssemblyDimensions } from '../../src/universal-spatial/parametric-e2a/assembly';
import { meshWorldTriangles } from '../../src/universal-spatial/reconstruction/mesh-triangles';
import { makeView, maskIoU, rasterise, type Tri } from '../../src/universal-spatial/reconstruction/silhouette';
const m: MaterialV2 = {profile:'industrial',color:'#d9a02e',roughness:.5,metalness:.2,clearcoat:0};
const cases: Array<{name:string;d:AssemblyDimensions;angles:[number,number,number]}> = [
 {name:'long-arm',d:{boomLength:4,stickLength:2.7,beamWidth:.45,beamHeight:.65,bucketWidth:1.5,bucketHeight:1,bucketDepth:1.2,plate:.1},angles:[.65,-1.2,.55]},
 {name:'compact',d:{boomLength:2.8,stickLength:1.9,beamWidth:.7,beamHeight:.8,bucketWidth:1.8,bucketHeight:.8,bucketDepth:1.5,plate:.12},angles:[.9,-.55,-.35]},
];
function triangles(a:Assembly) {
 const p=validateSpatialPlanV2({contract:'unfold.spatial-plan.v2',source:{kind:'text',sha256:'a'.repeat(64)},title:'synthetic',units:'unitless',presentationProfile:'industrial',unknowns:['physical scale'],constraints:[],relations:[],components:a.bodies.map(b=>({id:b.id,label:b.id,parentId:b.parentId,geometry:a.geometry[b.id],transform:{position:b.position,rotationRad:b.rotationRad,scale:[1,1,1]},provenance:{geometry:'inferred',transform:'inferred',material:'inferred',evidence:'synthetic'}}))});
 const c=compileSpatialPlanV2(p); c.root.updateMatrixWorld(true); const out:Tri[]=[]; let vertices=0, meshes=0;
 c.root.traverse(o=>{if(o instanceof Mesh){meshes++; vertices+=o.geometry.getAttribute('position').count; out.push(...meshWorldTriangles(o));}}); disposeCompiledSpatialPlan(c.root); return {tris:out,vertices,meshes};
}
const dirs=[[1,0,0],[1,.3,.7],[.5,.8,1],[-.4,.7,1],[-1,.2,.4],[.7,-.7,1],[.3,1,.2],[-.8,-.3,1]];
const views=dirs.map(d=>makeView(new Vector3(...d as [number,number,number]),new Vector3(0,0,2),8,80));
const results=[];
for(const {name,d,angles} of cases){
 const truth=createAssembly(d,m,angles), before=createAssembly({...d,beamWidth:d.beamWidth*1.2},m,angles);
 before.bodies[1]!.position[1]+=.6;before.bodies[2]!.position[2]-=.5;
 const snap=JSON.stringify(before); const t=triangles(truth), b=triangles(before); const masks=views.map(v=>rasterise(t.tris,v));
 for(let i=0;i<10;i++) solveHingeTree(before.bodies,before.joints,1);
 const heapStart=process.memoryUsage().heapUsed, timings:number[]=[]; let solved=solveHingeTree(before.bodies,before.joints,1);
 for(let i=0;i<20;i++){const s=performance.now();solved=solveHingeTree(before.bodies,before.joints,1);timings.push(performance.now()-s);}
 const heapDelta=process.memoryUsage().heapUsed-heapStart, after={...before,bodies:solved.bodies}, f=triangles(after);
 const scores=(tris:Tri[])=>views.map((v,i)=>maskIoU(masks[i]!,rasterise(tris,v)));
 const bscore=scores(b.tris),fscore=scores(f.tris), mean=(x:number[])=>x.reduce((a,b)=>a+b,0)/x.length;
 timings.sort((a,b)=>a-b);
 results.push({name,baselineResiduals:solved.before,finalResiduals:solved.after,baselineFitIoU:mean(bscore.slice(0,4)),finalFitIoU:mean(fscore.slice(0,4)),baselineHeldIoU:mean(bscore.slice(4)),finalHeldIoU:mean(fscore.slice(4)),widthErrorBefore:.2,widthErrorAfter:.2,rigidRotationsPreserved:JSON.stringify(before.bodies.map(x=>x.rotationRad))===JSON.stringify(after.bodies.map(x=>x.rotationRad)),inputUnchanged:JSON.stringify(before)===snap,meshes:f.meshes,vertices:f.vertices,triangles:f.tris.length,solverMs:{n:timings.length,min:timings[0],median:timings[10],max:timings[19]},heapDeltaBytes:heapDelta});
}
writeFileSync('reports/fidelity-v4/e2a-1/metrics.json',JSON.stringify({protocol:'synthetic only; no fitting; known supplied joints; width intentionally perturbed',results},null,2)+'\n'); console.log(JSON.stringify(results,null,2));
