import { Mesh } from 'three';
import { applySpatialOperationV2, type GeometryNodeV2, type SpatialOperationV2, type SpatialPlanV2 } from '../contracts-v2';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../geometry-compiler-v2';
import { meshWorldTriangles } from '../reconstruction/mesh-triangles';
import { maskIoU, rasterise, type Tri, type View } from '../reconstruction/silhouette';

export type FitView = { view: View; mask: Uint8Array; calibrated: boolean };
export type WidthFit = { status:'proposal'; operation:SpatialOperationV2; provenance:{origin:'inferred';evidence:string}; before:number; after:number; scale:number; evaluations:number; uncertainty: [number,number]; unresolved:string[] } | { status:'refused'; reason:string; evaluations:number };
/** Calibrated orthographic silhouette data only; never accepts reference geometry or held-out views. */
export function fitWidth(plan: SpatialPlanV2, componentId: string, views: FitView[], options: { maxEvaluations:number; maxMs:number; signal?:AbortSignal; bounds?:[number,number] }): WidthFit {
  let evaluations=0; const start=performance.now();
  const refuse=(reason:string):WidthFit=>({status:'refused',reason,evaluations});
  if (!Number.isSafeInteger(options.maxEvaluations) || options.maxEvaluations < 3 || options.maxEvaluations > 100 || !Number.isFinite(options.maxMs) || options.maxMs <= 0 || options.maxMs > 30000) return refuse('INVALID_BUDGET');
  if(options.signal?.aborted) return refuse('CANCELLED');
  const bounds = options.bounds ?? [0.5, 2.5];
  if(bounds.length!==2 || !bounds.every(Number.isFinite) || bounds[0]<0.1 || bounds[1]>4 || bounds[0]>=1 || bounds[1]<=1) return refuse('INVALID_BOUNDS');
  if(plan.components.length > 32 || views.length < 3 || views.length > 8) return refuse('VIEW_OR_COMPONENT_BUDGET');
  if(views.some(({view:v,mask,calibrated})=>!calibrated || !Number.isInteger(v.res) || v.res < 16 || v.res > 128 || !Number.isFinite(v.half) || v.half <= 0 || mask.length !== v.res*v.res || !mask.some(x=>x===1) || mask.some(x=>x!==0&&x!==1) || ![...v.direction.toArray(),...v.right.toArray(),...v.up.toArray(),...v.centre.toArray()].every(Number.isFinite))) return refuse('INVALID_EVIDENCE');
  if(views.some(({view:v}) => [v.direction,v.right,v.up].some(x=>Math.abs(x.length()-1)>1e-5) || Math.abs(v.direction.dot(v.right))>1e-5 || Math.abs(v.direction.dot(v.up))>1e-5 || Math.abs(v.right.dot(v.up))>1e-5)) return refuse('INVALID_CAMERA_FRAME');
  const dirs=views.map(x=>x.view.direction.clone().normalize());
  if(dirs.some(v=>v.lengthSq()<.99) || !dirs.some((a,i)=>dirs.some((b,j)=>j>i && dirs.some((c,k)=>k>j && Math.abs(a.clone().cross(b).dot(c))>.15)))) return refuse('INSUFFICIENT_VIEW_DIVERSITY');
  const component=plan.components.find(c=>c.id===componentId), node=component?.geometry;
  if(!component || !node || node.type!=='shape' || (node.operator!=='box' && node.operator!=='loft') || node.repeat!==null) return refuse('UNSUPPORTED_GEOMETRY');
  const initial=JSON.stringify(plan);
  function candidate(scale:number):GeometryNodeV2 {
    if(node!.type!=='shape') throw Error('UNSUPPORTED_GEOMETRY');
    const p=structuredClone(node!.parameters);
    if(node!.operator==='box') (p.dimensions as number[])[0]! *= scale;
    else for(const sec of p.sections as number[][]) sec[1]! *= scale;
    return {...node!,parameters:p};
  }
  const evidence='Experimental calibrated silhouette width search; inferred; other geometry and all hinge parameters unresolved.';
  const provenance={origin:'inferred' as const,evidence};
  const op=(scale:number):SpatialOperationV2=>({contract:'unfold.spatial-operation.v2',operationId:`visual-width-${componentId}`,kind:'set-geometry',componentId,nodeKey:node.key,value:candidate(scale)});
  function score(scale:number):number {
    if(options.signal?.aborted) throw Error('CANCELLED');
    if(evaluations>=options.maxEvaluations || performance.now()-start>options.maxMs) throw Error('BUDGET_EXHAUSTED');
    evaluations++;
    const next=applySpatialOperationV2(plan,op(scale),provenance), compiled=compileSpatialPlanV2(next), tris:Tri[]=[];
    try { compiled.root.updateMatrixWorld(true); compiled.root.traverse(o=>{if(o instanceof Mesh) tris.push(...meshWorldTriangles(o));}); return views.reduce((sum,v)=>sum+maskIoU(rasterise(tris,v.view),v.mask),0)/views.length; }
    finally { disposeCompiledSpatialPlan(compiled.root); }
  }
  try {
    const scores:Array<{scale:number;score:number}>=[];
    const evaluate = (s:number) => { if(!scores.some(x=>Math.abs(x.scale-s)<1e-10)) scores.push({scale:s,score:score(s)}); };
    const [lo,hi]=bounds;
    for(const s of [1,lo,(lo+1)/2,(1+hi)/2,hi]) evaluate(s);
    let step=(hi-lo)/4;
    for(let i=0;i<2;i++) {
      const best=[...scores].sort((a,b)=>b.score-a.score || Math.abs(a.scale-1)-Math.abs(b.scale-1))[0]!;
      step/=2;
      for(const s of [Math.max(lo,best.scale-step),Math.min(hi,best.scale+step)]) evaluate(s);
    }
    const before=scores[0]!.score, best=[...scores].sort((a,b)=>b.score-a.score || Math.abs(a.scale-1)-Math.abs(b.scale-1))[0]!;
    if(JSON.stringify(plan)!==initial) return refuse('INPUT_MUTATED');
    if(best.score-before<.02) return refuse('NO_SIGNIFICANT_IMPROVEMENT');
    const near=scores.filter(s=>best.score-s.score<=.01).map(s=>s.scale);
    return {status:'proposal',operation:op(best.scale),provenance,before,after:best.score,scale:best.scale,evaluations,uncertainty:[Math.min(...near),Math.max(...near)],unresolved:[...(best.scale===lo || best.scale===hi ? ['width optimum is at search boundary'] : []),...(Math.max(...near)-Math.min(...near)>step*2 ? ['width is ambiguous at tested resolution'] : []),'joint positions and axes','other dimensions and shape','physical scale','source and reviewer verification']};
  } catch(e) {return refuse(e instanceof Error?e.message:'FIT_FAILED');}
}
