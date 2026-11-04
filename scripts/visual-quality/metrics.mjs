/** Measures explicitly registered binary masks only. A photograph alone does not establish camera registration. */
export function silhouetteIoU(a, b, registered) {
  if (!registered) return { status: 'not-comparable', reason: 'camera registration not established' };
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length || [...a, ...b].some(v => v !== 0 && v !== 1)) throw new Error('INVALID_MASK');
  let intersection = 0, union = 0;
  for (let i = 0; i < a.length; i++) { if (a[i] && b[i]) intersection++; if (a[i] || b[i]) union++; }
  return union ? { status: 'measured', value: intersection / union } : { status: 'not-comparable', reason: 'empty masks' };
}
/** Gate outcomes require reviewed captures; geometry counts are diagnostic, never quality proof. */
export function assessResult(result) {
  const required = ['front', 'side', 'threeQuarter'];
  if (!result || !required.every(k => result.captures?.[k]?.verified === true && typeof result.captures[k].sha256 === 'string') || !result.review?.reviewer || !result.review?.completed || typeof result.review.recognisable !== 'boolean' || typeof result.review.structurallyCoherent !== 'boolean' || typeof result.review.detailed !== 'boolean' || typeof result.review.seriousDefects !== 'boolean') return { status: 'NOT_EVALUATED', improvement: 'NOT_EVALUATED' };
  const r = result.review;
  const status = !r.recognisable || !r.structurallyCoherent || r.seriousDefects ? 'FAIL' : r.detailed ? 'PASS' : 'PARTIAL';
  const comparison = result.comparison;
  const improvement = comparison?.reviewer && comparison.completed && typeof comparison.betterThanV2 === 'boolean' && comparison.sameSource && comparison.comparableFraming ? (comparison.betterThanV2 ? 'YES' : 'NO') : 'NOT_EVALUATED';
  return { status, improvement };
}
/** Compare observed component IDs only after evaluator-supplied semantic mappings. */
export function completeness(expected, observed, mapping) {
  if (!Array.isArray(expected) || !Array.isArray(observed) || !mapping || !expected.length) return {status:'not-evaluated'};
  const present=expected.filter(name => (mapping[name] ?? []).some(id => observed.includes(id)));
  return {status:'mapped', present, missing:expected.filter(name=>!present.includes(name)), fraction:present.length/expected.length, caveat:'Mappings require visual review; IDs do not prove shape or function.'};
}
/** Conservative AABB proximity diagnostic. A gap is a review lead, never proof of disconnection. */
export function analyzeBounds(meshes, scene, relativeGap = .02) {
  if (!Array.isArray(meshes) || !scene || !Number.isFinite(relativeGap) || relativeGap < 0) throw Error('INVALID_BOUNDS_INPUT');
  const valid = b => Array.isArray(b.minimum) && Array.isArray(b.maximum) && b.minimum.length === 3 && b.maximum.length === 3 && b.minimum.every((n,i)=>Number.isFinite(n) && Number.isFinite(b.maximum[i]) && n <= b.maximum[i]);
  const bad=meshes.map((m,i)=>valid(m)?null:i).filter(i=>i!==null);
  if (!valid({minimum:scene.min,maximum:scene.max})) return {status:'invalid-scene-bounds',badMeshIndices:bad,possibleIsolated:[]};
  const span=Math.hypot(...scene.max.map((n,i)=>n-scene.min[i])), threshold=span*relativeGap;
  const candidates=meshes.map((m,i)=>({m,i})).filter(({m})=>valid(m));
  const gap=(a,b)=>Math.hypot(...a.minimum.map((n,k)=>Math.max(0,n-b.maximum[k],b.minimum[k]-a.maximum[k])));
  const isolated=candidates.filter(({m,i})=>candidates.length>1 && candidates.every(other=>other.i===i || gap(m,other.m)>threshold)).map(({m,i})=>({meshIndex:i,id:m.id??null}));
  const outside=candidates.filter(({m})=>m.minimum.some((n,i)=>n<scene.min[i]-1e-8 || m.maximum[i]>scene.max[i]+1e-8)).map(({i})=>i);
  return {status:'measured',threshold,possibleIsolated:isolated,badMeshIndices:bad,outsideSceneBounds:outside,caveat:'World-space AABB proximity is a heuristic; overlaps, semantic joints, occlusion and unitless scale need human review.'};
}
