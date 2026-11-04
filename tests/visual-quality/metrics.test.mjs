import {describe,it,expect} from 'vitest';
import {silhouetteIoU, assessResult, completeness, analyzeBounds} from '../../scripts/visual-quality/metrics.mjs';
describe('independent visual gate',()=>{
 it('refuses unregistered or empty masks',()=>{expect(silhouetteIoU([1],[1],false).status).toBe('not-comparable');expect(silhouetteIoU([0],[0],true).status).toBe('not-comparable');expect(()=>silhouetteIoU([1],[2],true)).toThrow();expect(silhouetteIoU([1,1,0],[1,0,1],true).value).toBeCloseTo(1/3)});
 it('never passes an uncaptured or unreviewed result',()=>{expect(assessResult({review:{completed:true}}).status).toBe('NOT_EVALUATED');expect(assessResult({captures:{front:'x',side:'x',threeQuarter:'x'}}).status).toBe('NOT_EVALUATED')});
 it('uses human judgement, never triangle count, and demands matched comparison',()=>{let r={captures:{front:{verified:true,sha256:'a'},side:{verified:true,sha256:'b'},threeQuarter:{verified:true,sha256:'c'}},review:{reviewer:'human',completed:true,recognisable:true,structurallyCoherent:true,detailed:true,seriousDefects:false}};expect(assessResult(r)).toEqual({status:'PASS',improvement:'NOT_EVALUATED'});r.review.detailed=false;expect(assessResult(r).status).toBe('PARTIAL');r.review.seriousDefects=true;expect(assessResult(r).status).toBe('FAIL')});
 it('needs explicit component mappings',()=>{expect(completeness(['wheel'],['a'],null).status).toBe('not-evaluated');expect(completeness(['wheel','cab'],['a'],{wheel:['a']}).missing).toEqual(['cab'])});
});

it('flags potentially isolated and invalid bounds without claiming disconnected truth',()=>{const r=analyzeBounds([{id:'a',minimum:[0,0,0],maximum:[1,1,1]},{id:'b',minimum:[9,0,0],maximum:[10,1,1]},{id:'bad',minimum:[NaN,0,0],maximum:[1,1,1]}],{min:[0,0,0],max:[10,1,1]});expect(r.possibleIsolated.map(x=>x.id)).toEqual(['a','b']);expect(r.badMeshIndices).toEqual([2]);expect(r.caveat).toMatch(/heuristic/)})
