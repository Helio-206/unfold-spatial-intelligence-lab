import {applySpatialOperationV2,type SpatialPlanV2} from '../contracts-v2';
import type {ConstrainedOutcome} from './constrained-fit';
import type {ConstrainedRequest} from './constrained-worker-protocol';
/** A single-use-per-job worker; no result is an approved edit. */
export class ConstrainedWorkerClient {
 private worker:Worker|null=null;private generation=0;private disposed=false;private rejectJob:((e:Error)=>void)|null=null;
 constructor(private readonly factory:()=>Worker,private readonly timeoutMs=30000){if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>30000)throw Error('INVALID_TIMEOUT');}
 start(request:Omit<ConstrainedRequest,'id'>,onProgress?:(n:number)=>void):Promise<ConstrainedOutcome>{if(this.disposed)return Promise.reject(Error('DISPOSED'));this.cancel();const id=++this.generation,w=this.factory();this.worker=w;
 return new Promise((resolve,reject)=>{let timer:ReturnType<typeof setTimeout>;const finish=()=>{clearTimeout(timer);if(this.worker===w)this.worker=null;w.terminate();this.rejectJob=null;};this.rejectJob=e=>{finish();reject(e);};timer=setTimeout(()=>{if(id===this.generation){this.generation++;this.rejectJob?.(Error('TIMEOUT'));}},this.timeoutMs);
 w.onmessage=(event:MessageEvent<{id:number;type:string;evaluations?:number;result?:ConstrainedOutcome;error?:string}>)=>{if(id!==this.generation||event.data.id!==id)return;if(event.data.type==='progress'){onProgress?.(event.data.evaluations!);return;}if(event.data.type==='error'){finish();reject(Error(event.data.error??'WORKER_ERROR'));return;}if(event.data.type==='result'&&event.data.result){const r=event.data.result;finish();if(validateWorkerResult(request.plan,request.options.maxEvaluations,r))resolve(r);else reject(Error('INVALID_WORKER_RESULT'));}};
 w.onerror=()=>{if(id===this.generation){finish();reject(Error('WORKER_ERROR'));}};w.postMessage({type:'start',request:{...request,id}});});}
 cancel(){this.generation++;this.rejectJob?.(Error('CANCELLED'));this.worker?.terminate();this.worker=null;}
 dispose(){if(this.disposed)return;this.cancel();this.disposed=true;}
}
function validateWorkerResult(plan:SpatialPlanV2,max:number,r:ConstrainedOutcome):boolean{if(!r||!Number.isSafeInteger(r.evaluations)||r.evaluations<0||r.evaluations>max)return false;if(r.status==='refused')return typeof r.reason==='string'&&r.reason.length>0&&r.reason.length<201;if(r.status!=='proposal'||r.provenance?.origin!=='inferred'||!Number.isFinite(r.maxGapFraction)||r.maxGapFraction<0||r.maxGapFraction>.005||!Number.isFinite(r.before)||!Number.isFinite(r.after)||r.before<0||r.after>1||r.after-r.before<.02||!Array.isArray(r.operations)||r.operations.length!==plan.components.length*2)return false;try{let p=plan;for(const op of r.operations)p=applySpatialOperationV2(p,op,r.provenance);return JSON.stringify(p.source)===JSON.stringify(plan.source)&&p.components.every((c,i)=>c.id===plan.components[i]!.id&&c.parentId===plan.components[i]!.parentId);}catch{return false;}}
