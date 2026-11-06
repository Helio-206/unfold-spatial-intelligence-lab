import { describe, expect, it } from 'vitest';
import { FoundryGeometry, type EvidenceBinding } from '../src/living/universal-foundry/provider';
import { hatchback, suv } from '../src/living/universal-foundry/fixtures/plans';
import type { ImageEvidence } from '../src/living/universal-foundry/evidence';
import { spatialPlanFingerprintV2 } from '../src/universal-spatial/api-client';
import type { SpatialPlanV2 } from '../src/universal-spatial/contracts-v2';
const evidence = (hex: string): ImageEvidence => ({width:2,height:2,foregroundRatio:1,bbox:{x0:0,y0:0,x1:1,y1:1},aspect:1,symmetry:1,colours:[{hex,share:1}],mask:new Uint8Array([1,1,1,1])});
const imagePlan=(p:SpatialPlanV2):SpatialPlanV2=>({...p,source:{...p.source,kind:'image'}});
const binding=async(plan:SpatialPlanV2):Promise<EvidenceBinding>=>({plan,planFingerprint:await spatialPlanFingerprintV2(plan),sourceSha256:plan.source.sha256,originalSha256:'c'.repeat(64),preparedSha256:plan.source.sha256,preparation:'identity:image/jpeg',generationId:'space-1',recipeVersion:1});
describe('image evidence isolation',()=>{
 it('does not reuse B evidence when reopening A after dispose',async()=>{
  const provider=new FoundryGeometry(null);const a=imagePlan(hatchback()),b=imagePlan(suv());
  await provider.setEvidence(evidence('#ff0000'),await binding(a));provider.compile(a);expect(provider.recipe?.evidence.used).toBe(true);provider.dispose();
  await provider.setEvidence(evidence('#0000ff'),await binding(b));provider.compile(b);expect(provider.recipe?.evidence.used).toBe(true);provider.dispose();
  provider.compile(a);expect(provider.recipe?.evidence.used).toBe(false);expect(provider.recipe?.unknowns.join(' ')).toContain('indisponível');
 });
 it('rejects evidence bound to another plan or prepared source',async()=>{const p=new FoundryGeometry(null),a=imagePlan(hatchback()),b=imagePlan(suv());await p.setEvidence(evidence('#ff0000'),await binding(a));p.compile(b);expect(p.recipe?.evidence.used).toBe(false);await p.setEvidence(evidence('#ff0000'),{...await binding(a),preparedSha256:'d'.repeat(64)});p.compile(a);expect(p.recipe?.evidence.used).toBe(false)});
 it('invalidates A evidence when plans change even without dispose',async()=>{const p=new FoundryGeometry(null),a=imagePlan(hatchback()),b=imagePlan(suv());await p.setEvidence(evidence('#ff0000'),await binding(a));p.compile(a);p.compile(b);p.compile(a);expect(p.recipe?.evidence.used).toBe(false)});
 it('rejects late evidence after cancellation or dispose',async()=>{const p=new FoundryGeometry(null),a=imagePlan(hatchback()),b=await binding(a),controller=new AbortController();const pending=p.setEvidence(evidence('#ff0000'),b,controller.signal);controller.abort();await pending;p.compile(a);expect(p.recipe?.evidence.used).toBe(false);const pending2=p.setEvidence(evidence('#ff0000'),b);p.dispose();await pending2;p.compile(a);expect(p.recipe?.evidence.used).toBe(false)});
 it('rejects an incorrect plan fingerprint',async()=>{const p=new FoundryGeometry(null),a=imagePlan(hatchback()),b=await binding(a);await p.setEvidence(evidence('#ff0000'),{...b,planFingerprint:'f'.repeat(64)});p.compile(a);expect(p.recipe?.evidence.used).toBe(false)});
 it('does not carry parameter overrides across different plans even when source hash matches',()=>{
  const p=new FoundryGeometry(null),a=hatchback(),b={...suv(),source:{...a.source}};
  p.compile(a);p.set(a,{cabinHeight:0.55});p.compile(b);
  expect(p.values.cabinHeight).not.toBe(0.55);
 });
});
