import type { FitOutcome, FitOptions } from './articulated';
import { applySpatialOperationV2, type SpatialPlanV2 } from '../contracts-v2';
import type { FitRequest } from './worker-protocol';
function validResult(plan:SpatialPlanV2, options:FitOptions, result:FitOutcome):boolean {
 if(!result || !Number.isSafeInteger(result.evaluations) || result.evaluations<0 || result.evaluations>options.maxEvaluations)return false;
 if(result.status==='refused')return typeof result.reason==='string'&&result.reason.length>0&&result.reason.length<=200;
 if(result.status!=='proposal'||!Array.isArray(result.operations)||result.operations.length<1||result.operations.length>plan.components.length*2||result.provenance?.origin!=='inferred'||!Array.isArray(result.jointResiduals)||result.jointResiduals.some(n=>!Number.isFinite(n)||n<0||n>options.maxJointFraction)||!Number.isFinite(result.before)||!Number.isFinite(result.after)||result.before<0||result.after>1||result.after-result.before<.02)return false;
 try{let candidate=plan;for(const op of result.operations)candidate=applySpatialOperationV2(candidate,op,result.provenance);return JSON.stringify(candidate.source)===JSON.stringify(plan.source)&&candidate.components.every((c,i)=>c.id===plan.components[i]!.id&&c.parentId===plan.components[i]!.parentId);}catch{return false;}
}
/** A job owns one worker. Cancel/dispose terminate it and invalidate every queued message. */
export class ArticulatedWorkerClient {
 private worker:Worker|null=null; private generation=0; private disposed=false; private rejectJob:((e:Error)=>void)|null=null;
 constructor(private readonly create:()=>Worker,private readonly timeoutMs:number=30000){if(!Number.isFinite(timeoutMs)||timeoutMs<=0||timeoutMs>30000)throw Error('INVALID_TIMEOUT');}
 start(request:Omit<FitRequest,'id'>,onProgress?:(n:number)=>void):Promise<FitOutcome>{
  if(this.disposed)return Promise.reject(Error('DISPOSED'));this.cancel();const id=++this.generation,worker=this.create();this.worker=worker;
  return new Promise((resolve,reject)=>{let timer:ReturnType<typeof setTimeout>;const finish=()=>{clearTimeout(timer);if(this.worker===worker)this.worker=null;worker.terminate();this.rejectJob=null;};this.rejectJob=e=>{finish();reject(e);};
   timer=setTimeout(()=>{if(id===this.generation){this.generation++;this.rejectJob?.(Error('TIMEOUT'));}},this.timeoutMs);
   worker.onmessage=(event:MessageEvent<{id:number;type:string;evaluations?:number;result?:FitOutcome;error?:string}>)=>{if(id!==this.generation||event.data.id!==id)return;if(event.data.type==='progress'){onProgress?.(event.data.evaluations!);return;}if(event.data.type==='result'&&event.data.result){const value=event.data.result;finish();if(validResult(request.plan,request.options,value))resolve(value);else reject(Error('INVALID_WORKER_RESULT'));}else if(event.data.type==='error'){finish();reject(Error(event.data.error??'WORKER_ERROR'));}};
   worker.onerror=()=>{if(id===this.generation){finish();reject(Error('WORKER_ERROR'));}};worker.postMessage({type:'start',request:{...request,id}});
  });
 }
 cancel(){this.generation++;this.rejectJob?.(Error('CANCELLED'));this.worker?.terminate();this.worker=null;}
 dispose(){if(this.disposed)return;this.cancel();this.disposed=true;}
}
