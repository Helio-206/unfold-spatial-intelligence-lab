// Writes the coarse fixture plans as plan replies (the shape /api/spatial/v2/plan returns) so the browser flow can be driven without a Meta call.
import { mkdirSync, writeFileSync } from 'node:fs';
import * as plans from '../../src/living/universal-foundry/fixtures/plans';
const out = 'reports/product-integration/uvf/plans'; mkdirSync(out, { recursive: true });
for (const [name, make] of Object.entries(plans)) {
  if (typeof make !== 'function' || name === 'planOf') continue;
  const plan = (make as () => import('../../src/universal-spatial/contracts-v2').SpatialPlanV2)();
  writeFileSync(`${out}/${name}.json`, JSON.stringify({ contract: 'unfold.spatial-plan.v2', sessionId: '00000000-0000-4000-8000-000000000000', revision: 0, plan, sceneSummary: { componentCount: plan.components.length, geometryNodeCount: plan.components.length, operators: [...new Set(plan.components.map((c) => (c.geometry as { operator?: string }).operator ?? 'group'))], constraintReady: false }, constraintReport: { ok: true, results: [] }, constructionEvents: [], meta: { note: 'coarse stand-in plan authored by hand; not Meta output' }, limitations: [] }));
}
console.log('plans written');
