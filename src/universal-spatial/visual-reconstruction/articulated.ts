import { Matrix4, Mesh, Vector3 } from 'three';
import { applySpatialOperationV2, type SpatialOperationV2, type SpatialPlanV2 } from '../contracts-v2';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../geometry-compiler-v2';
import { meshWorldTriangles } from '../reconstruction/mesh-triangles';
import { maskIoU, rasterise, type Tri } from '../reconstruction/silhouette';
import type { FitView } from './fit';

export type JointPrior = { parent:string; child:string; anchorParent:[number,number,number]; anchorChild:[number,number,number] };
export type FitOptions = { maxEvaluations:number; maxMs:number; span:number; maxJointFraction:number };
export type FitOutcome = { status:'proposal'; operations:SpatialOperationV2[]; provenance:{origin:'inferred';evidence:string}; before:number; after:number; jointResiduals:number[]; evaluations:number; unresolved:string[] } | { status:'refused'; reason:string; evaluations:number };
type State={id:string; width:number; length:number; dz:number; rx:number};
const evidence='Experimental silhouette fit with caller-supplied hypothetical attachment priors; no relationship is confirmed.';
const provenance={origin:'inferred' as const,evidence};

/** One generator step is one complete scene evaluation; the caller controls scheduling and cancellation. */
export function* fitArticulated(plan:SpatialPlanV2, views:FitView[], priors:JointPrior[], options:FitOptions):Generator<number,FitOutcome,void> {
 let evaluations=0;const started=performance.now();const refuse=(reason:string):FitOutcome=>({status:'refused',reason,evaluations});
 if(!Number.isSafeInteger(options.maxEvaluations)||options.maxEvaluations<2||options.maxEvaluations>120||!Number.isFinite(options.maxMs)||options.maxMs<=0||options.maxMs>30000||!Number.isFinite(options.span)||options.span<=0||options.span>1000||!Number.isFinite(options.maxJointFraction)||options.maxJointFraction<=0||options.maxJointFraction>0.2)return refuse('INVALID_BUDGET');
 if(plan.components.length<2||plan.components.length>3||views.length<3||views.length>8||priors.length!==plan.components.length-1)return refuse('INSUFFICIENT_STRUCTURE');
 if(views.some(({view:v,mask,calibrated})=>!calibrated||!Number.isInteger(v.res)||v.res<16||v.res>128||!Number.isFinite(v.half)||v.half<=0||mask.length!==v.res*v.res||!mask.some(x=>x===1)||mask.some(x=>x!==0&&x!==1)||[v.direction,v.right,v.up,v.centre].some(a=>!a.toArray().every(Number.isFinite))||[v.direction,v.right,v.up].some(a=>Math.abs(a.length()-1)>1e-5)||Math.abs(v.direction.dot(v.right))>1e-5||Math.abs(v.direction.dot(v.up))>1e-5||Math.abs(v.right.dot(v.up))>1e-5))return refuse('INVALID_EVIDENCE');
 const directions=views.map(v=>v.view.direction);if(!directions.some((a,i)=>directions.some((b,j)=>j>i&&directions.some((c,k)=>k>j&&Math.abs(a.clone().cross(b).dot(c))>.15))))return refuse('INSUFFICIENT_VIEWS');
 if(plan.components.some(c=>c.geometry.type!=='shape'||c.geometry.operator!=='box'||c.geometry.repeat!==null||c.transform.scale.some(n=>n!==1)))return refuse('UNSUPPORTED_GEOMETRY');
 const ids=new Set(plan.components.map(c=>c.id)), children=new Set<string>();
 for(const j of priors){if(!ids.has(j.parent)||!ids.has(j.child)||j.parent===j.child||children.has(j.child)||!Array.isArray(j.anchorParent)||!Array.isArray(j.anchorChild)||j.anchorParent.length!==3||j.anchorChild.length!==3||![...j.anchorParent,...j.anchorChild].every(n=>Number.isFinite(n)&&Math.abs(n)<=1000)||plan.components.find(c=>c.id===j.child)?.parentId!==j.parent)return refuse('INVALID_JOINT_PRIOR');children.add(j.child);}
 if(plan.components.filter(c=>c.parentId===null).length!==1||plan.components.filter(c=>c.parentId!==null).some(c=>!children.has(c.id)))return refuse('INSUFFICIENT_STRUCTURE');
 const state:State[]=plan.components.map(c=>({id:c.id,width:1,length:1,dz:0,rx:0}));
 function operations(s:State[]):SpatialOperationV2[]{return s.flatMap(v=>{const c=plan.components.find(x=>x.id===v.id)!;if(c.geometry.type!=='shape')throw Error('UNSUPPORTED_GEOMETRY');const dimensions=[...(c.geometry.parameters.dimensions as number[])];dimensions[0]!*=v.width;dimensions[2]!*=v.length;return [{contract:'unfold.spatial-operation.v2' as const,operationId:`fit-g-${v.id}`,kind:'set-geometry' as const,componentId:v.id,nodeKey:c.geometry.key,value:{...c.geometry,parameters:{dimensions}}},{contract:'unfold.spatial-operation.v2' as const,operationId:`fit-t-${v.id}`,kind:'set-transform' as const,componentId:v.id,nodeKey:null,value:{...c.transform,position:[c.transform.position[0],c.transform.position[1],c.transform.position[2]+v.dz],rotationRad:[c.transform.rotationRad[0]+v.rx,c.transform.rotationRad[1],c.transform.rotationRad[2]]}}];});}
 function evaluate(s:State[]){if(evaluations>=options.maxEvaluations||performance.now()-started>options.maxMs)throw Error('BUDGET_EXHAUSTED');evaluations++;
  let next=plan;for(const op of operations(s))next=applySpatialOperationV2(next,op,provenance);
  const c=compileSpatialPlanV2(next),tris:Tri[]=[],world=new Map<string,Matrix4>();
  try {c.root.updateMatrixWorld(true);c.root.traverse(o=>{if(o.userData.spatialComponentRoot)world.set(o.userData.spatialEntityId,o.matrixWorld.clone());if(o instanceof Mesh)tris.push(...meshWorldTriangles(o));});
   const visual=views.reduce((sum,v)=>sum+maskIoU(rasterise(tris,v.view),v.mask),0)/views.length;
   const residuals=priors.map(j=>new Vector3(...j.anchorParent).applyMatrix4(world.get(j.parent)!).distanceTo(new Vector3(...j.anchorChild).applyMatrix4(world.get(j.child)!))/options.span);
   const deviation=s.reduce((sum,x)=>sum+(x.width-1)**2+(x.length-1)**2+(x.dz/options.span)**2+x.rx**2,0)/s.length;
   // Unitless objective: visual IoU minus joint gap squared and a small normalised deviation prior.
   return {visual,residuals,score:visual-.5*residuals.reduce((a,b)=>a+b*b,0)-.01*deviation};
  }finally{disposeCompiledSpatialPlan(c.root);}}
 try {
  const initial=evaluate(state);yield evaluations;let best=initial;
  for(const factor of [1,.5])for(const entry of state)for(const key of ['width','length','dz','rx'] as const)for(const sign of [-1,1]){
   const previous=entry[key],delta=(key==='dz'?.08*options.span:key==='rx'?.2:.2)*factor;entry[key]=previous+sign*delta;
   if((key==='width'||key==='length')&&(entry[key]<.6||entry[key]>1.6)||key==='dz'&&Math.abs(entry[key])>.25*options.span||key==='rx'&&Math.abs(entry[key])>.5){entry[key]=previous;continue;}
   const candidate=evaluate(state);yield evaluations;
   if(candidate.score>best.score+1e-5)best=candidate;else entry[key]=previous;
  }
  if(best.visual-initial.visual<.02)return refuse('NO_SIGNIFICANT_IMPROVEMENT');
  if(best.residuals.some(x=>x>options.maxJointFraction))return refuse('JOINT_GAP_EXCEEDED');
  return {status:'proposal',operations:operations(state),provenance,before:initial.visual,after:best.visual,jointResiduals:best.residuals,evaluations,unresolved:['attachment priors are hypotheses, not verified joints','hinge axes and occlusion not inferred','physical scale and uncertainty unverified']};
 }catch(e){return refuse(e instanceof Error?e.message:'FIT_FAILED');}
}
