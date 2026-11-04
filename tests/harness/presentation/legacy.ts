/**
 * The workspace exactly as PR #25 shows a space: real `SpatialWorkspace` + `PlanSpaceLayer`, the layer's own timed reveal, no Director.
 * It imports nothing from the presentation module, so it also runs unchanged on a checkout of the PR #25 commit (that is how the "before" evidence is captured).
 * Query: fixture=<name> (JSON under /reports/visual-recovery/fixtures), mode=excavator for the Foundry reference.
 */
import '../../../src/brand.css';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../../src/living/contracts/fixtures/excavator.assembly.v1';
import { createStudioEnvironment } from '../../../src/living/cinema/studio-environment';
import { SpatialWorkspace } from '../../../src/living/workspace-design/workspace';
import { PlanSpaceLayer } from '../../../src/living/spatial-space/layer';
import { validateSpatialPlanV2 } from '../../../src/universal-spatial/contracts-v2';

const q = new URLSearchParams(location.search);
document.body.style.margin = '0';
const ws = new SpatialWorkspace(document.querySelector<HTMLElement>('#app')!, { assembly: EXCAVATOR_ASSEMBLY_V1, agent: { mode: 'fixture' }, reducedMotion: q.get('rm') === '1', preserveDrawingBuffer: true, look: 'premium', premiumEnvironment: createStudioEnvironment, startEmpty: Boolean(q.get('fixture')) });
ws.renderNow();
const api: { ws: SpatialWorkspace; layer: PlanSpaceLayer | null; ready: Promise<void> } = { ws, layer: null, ready: Promise.resolve() };
Object.assign(window, { __present: api });
const fixture = q.get('fixture');
if (fixture) {
  api.ready = (async () => {
    const reply = await (await fetch(`/reports/visual-recovery/fixtures/${fixture}.json`)).json();
    const plan = validateSpatialPlanV2(reply.plan);
    const layer = new PlanSpaceLayer(plan, { changed: () => ws.spaceChanged(), redraw: () => ws.redraw(), notify: () => undefined });
    api.layer = layer; ws.showSpace(layer, { brandLabel: `espaço · ${plan.title}`, notices: [{ id: 'fixture', text: 'Fixture manual (não é saída da Meta)' }] });
    layer.reveal(true);
  })();
}
