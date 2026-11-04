import { readFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { Mesh, Vector3 } from 'three';
import { validateSpatialPlanV2, applySpatialOperationV2, type SpatialPlanV2 } from '../../../src/universal-spatial/contracts-v2';
import { fitWidth, type FitView } from '../../../src/universal-spatial/visual-reconstruction/fit';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../../../src/universal-spatial/geometry-compiler-v2';
import { meshWorldTriangles } from '../../../src/universal-spatial/reconstruction/mesh-triangles';
import { makeView, maskIoU, rasterise, type Tri } from '../../../src/universal-spatial/reconstruction/silhouette';
import { referenceCases } from './references';
const mat={profile:'industrial',color:'#cc9900',roughness:.5,metalness:.2,clearcoat:0},tr=(position:number[])=>({position,rotationRad:[0,0,0],scale:[1,1,1]});
const conceptual = ():SpatialPlanV2 => validateSpatialPlanV2({contract:'unfold.spatial-plan.v2',source:{kind:'text',sha256:'b'.repeat(64)},title:'conceptual',units:'unitless',presentationProfile:'industrial',unknowns:['dimensions and hinges'],constraints:[],relations:[],components:[
 {id:'boom',position:[0,0,0],d:[.5,.8,3]}, {id:'stick',position:[0,0,3],d:[.55,.7,2]}, {id:'bucket',position:[0,0,5],d:[1.2,.8,1]},
].map(c=>({id:c.id,label:c.id,parentId:null,geometry:{type:'shape',key:`${c.id}-body`,operator:'box',parameters:{dimensions:c.d},transform:tr([0,0,0]),repeat:null,material:mat},transform:tr(c.position),provenance:{geometry:'inferred',transform:'inferred',material:'inferred',evidence:'conceptual starting plan'}}))});
function geometry(p:SpatialPlanV2):Tri[]{const c=compileSpatialPlanV2(p);const tris:Tri[]=[];try {c.root.updateMatrixWorld(true);c.root.traverse(o=>{if(o instanceof Mesh) tris.push(...meshWorldTriangles(o));});return tris;}finally{disposeCompiledSpatialPlan(c.root);}}
const results=[]; const boards=[];
for(const ref of referenceCases){
 const raw=JSON.parse(readFileSync(`reports/fidelity-v4/e2-visual/${ref.name}-evidence.json`,'utf8')) as {views:Array<{partition:string;direction:[number,number,number];centre:[number,number,number];half:number;resolution:number;mask:number[]}>};
 const convert=(v:typeof raw.views[number]):FitView=>({view:makeView(new Vector3(...v.direction),new Vector3(...v.centre),v.half,v.resolution),mask:Uint8Array.from(v.mask),calibrated:true});
 const fitting=raw.views.filter(v=>v.partition==='fit').map(convert), held=raw.views.filter(v=>v.partition==='held-out').map(convert), p=conceptual(), before=geometry(p); const t=performance.now();
 const result=fitWidth(p,'boom',fitting,{maxEvaluations:9,maxMs:30000}); const ms=performance.now()-t;
 const next=result.status==='proposal'?applySpatialOperationV2(p,result.operation,result.provenance):p, after=geometry(next);
 const iou=(tris:Tri[])=>held.reduce((a,v)=>a+maskIoU(rasterise(tris,v.view),v.mask),0)/held.length;
 boards.push({name:ref.name, views:[fitting[0]!,held[0]!].map(v=>({reference:Array.from(v.mask),before:Array.from(rasterise(before,v.view)),after:Array.from(rasterise(after,v.view))}))});
 const recovered=result.status==='proposal'?.5*result.scale:.5;
 results.push({name:ref.name,status:result.status,reason:result.status==='refused'?result.reason:null,fitBefore:result.status==='proposal'?result.before:null,fitAfter:result.status==='proposal'?result.after:null,heldBefore:iou(before),heldAfter:iou(after),selectedWidth:{baseline:.5,recovered,groundTruth:ref.width,baselineError:Math.abs(.5-ref.width),finalError:Math.abs(recovered-ref.width)},ms,evaluations:result.evaluations,uncertainty:result.status==='proposal'?result.uncertainty:null});
}
writeFileSync('reports/fidelity-v4/e2-visual/mask-board.json',JSON.stringify(boards)+'\n');
writeFileSync('reports/fidelity-v4/e2-visual/metrics.json',JSON.stringify({warning:'independent primitives; no mechanical inference; only one width parameter fitted',results},null,2)+'\n'); console.log(JSON.stringify(results,null,2));
