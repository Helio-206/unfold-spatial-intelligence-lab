import {applySpatialOperationV2,validateSpatialPlanV2,type SpatialPlanV2} from '../contracts-v2';
import {validateBinding,type ProposalBinding} from './proposal';
import type {ConstrainedOutcome} from './constrained-fit';
export async function planFingerprint(plan:SpatialPlanV2):Promise<string>{const bytes=new TextEncoder().encode(JSON.stringify(plan));const hash=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(hash),x=>x.toString(16).padStart(2,'0')).join('');}
const same=(a:ProposalBinding,b:ProposalBinding)=>validateBinding(a)&&validateBinding(b)&&a.sourceSha256===b.sourceSha256&&a.planSha256===b.planSha256&&a.planRevision===b.planRevision&&a.reviewId===b.reviewId&&a.reviewRevision===b.reviewRevision;
/** Experimental local preview gate, not an E0 transaction or a verified identity. */
export class ConstrainedPreviewFence {
 private generation=0;private disposed=false;private candidate:{binding:ProposalBinding;result:Extract<ConstrainedOutcome,{status:'proposal'}>}|null=null;
 capture(binding:ProposalBinding,result:ConstrainedOutcome){if(this.disposed)throw Error('DISPOSED');if(!validateBinding(binding)||result.status!=='proposal'||result.provenance.origin!=='inferred')throw Error('INVALID_PROPOSAL');this.generation++;this.candidate=structuredClone({binding,result});}
 invalidate(){this.generation++;this.candidate=null;}
 dispose(){this.invalidate();this.disposed=true;}
 async preview(plan:SpatialPlanV2,current:()=>ProposalBinding):Promise<SpatialPlanV2>{if(this.disposed||!this.candidate)throw Error('STALE_PROPOSAL');const g=this.generation,c=this.candidate,snapshot=JSON.stringify(plan),binding=current();if(!same(c.binding,binding)||plan.source.sha256!==binding.sourceSha256)throw Error('STALE_PROPOSAL');const hash=await planFingerprint(plan);if(this.disposed||g!==this.generation||!same(c.binding,current())||JSON.stringify(plan)!==snapshot||hash!==binding.planSha256)throw Error('STALE_PROPOSAL');let copy=validateSpatialPlanV2(JSON.parse(snapshot));for(const op of c.result.operations)copy=applySpatialOperationV2(copy,op,c.result.provenance);return copy;}
}
