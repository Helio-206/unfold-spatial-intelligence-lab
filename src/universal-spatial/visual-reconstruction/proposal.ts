import type { SpatialOperationV2 } from '../contracts-v2';
export type ProposalBinding = { sourceSha256:string; planSha256:string; planRevision:number; reviewId:string; reviewRevision:number };
export type ExperimentalProposal = { contract:'unfold.visual-reconstruction-proposal.v1'; binding:ProposalBinding; selectedComponentIds:string[]; operations:SpatialOperationV2[]; origin:'inferred'; evidenceRefs:string[]; uncertainty:string[]; diagnostics:{before:number;after:number} };
const hash=(s:string)=>/^[a-f0-9]{64}$/.test(s);
export function validateBinding(value:ProposalBinding):boolean {return !!value && hash(value.sourceSha256) && hash(value.planSha256) && Number.isSafeInteger(value.planRevision) && value.planRevision>=0 && /^[a-zA-Z0-9._:-]{1,128}$/.test(value.reviewId) && Number.isSafeInteger(value.reviewRevision) && value.reviewRevision>=0;}
/** Comparison of caller-supplied fingerprints only: caller must independently verify bytes and reviewer. */
export function isCurrentProposal(proposal:ExperimentalProposal, current:ProposalBinding):boolean {
 return !!proposal && proposal.contract==='unfold.visual-reconstruction-proposal.v1' && proposal.origin==='inferred' && validateBinding(proposal.binding) && validateBinding(current) && (Object.keys(current) as Array<keyof ProposalBinding>).length===5 && (Object.keys(current) as Array<keyof ProposalBinding>).every(k=>current[k]===proposal.binding[k]);
}
