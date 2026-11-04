import { readParts } from '../reconstruction/engine';
import { classifyRelations } from '../reconstruction/relations';
import type { SpatialPlanV2 } from '../contracts-v2';
/** Surface proximity is a hypothesis, not evidence of a hinge or human confirmation. */
export function jointCandidates(plan:SpatialPlanV2) {
 const result=readParts(plan);if(!result)return {status:'insufficient_evidence' as const,candidates:[]};
 const findings=classifyRelations(plan,result.parts.map(p=>({id:p.id,tris:p.tris})),{span:result.span,maxSamples:300});
 return {status:'hypotheses' as const,candidates:findings.map(f=>({a:f.a,b:f.b,relationId:f.id,status:f.status==='declared_contradicted'?'contradictory' as const:'ambiguous' as const,gapFraction:f.gap/result.span,anchorWorld:f.anchor.toArray(),axis:null,source:'plan_geometry_only' as const,verified:false as const}))};
}
