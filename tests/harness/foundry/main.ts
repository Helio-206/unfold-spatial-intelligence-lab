/**
 * REFERENCE HOST for the Universal Foundry evidence (test only). It mounts the real SpatialWorkspace and the real PlanSpaceLayer and varies ONE thing: the geometry
 * route passed through the layer's `compile` seam (v2 | foundry). The camera is computed once from the V2 box, so only the geometry differs between captures.
 * Query: plan=<fixture name>, route=v2|foundry, az=<deg>, el=<deg>, p.<param>=<value> (recipe overrides).
 */
import '../../../src/brand.css';
import { Mesh, Vector3, type Box3 } from 'three';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../../src/living/contracts/fixtures/excavator.assembly.v1';
import { createStudioEnvironment } from '../../../src/living/cinema/studio-environment';
import { SpatialWorkspace } from '../../../src/living/workspace-design/workspace';
import { PlanSpaceLayer } from '../../../src/living/spatial-space/layer';
import { compileSpatialPlanV2 } from '../../../src/universal-spatial/geometry-compiler-v2';
import { compileFoundry, type FoundryResult } from '../../../src/living/universal-foundry/foundry';
import * as fixtures from '../../../src/living/universal-foundry/fixtures/plans';
import { viewForBox } from '../../../src/living/spatial-presentation/cues';

const q = new URLSearchParams(location.search), app = document.querySelector<HTMLElement>('#app')!;
document.body.style.margin = '0';
const ws = new SpatialWorkspace(app, { assembly: EXCAVATOR_ASSEMBLY_V1, agent: { mode: 'fixture' }, reducedMotion: true, preserveDrawingBuffer: true, look: 'premium', premiumEnvironment: createStudioEnvironment, startEmpty: true });
ws.renderNow();
const api: Record<string, unknown> & { ready: Promise<void> } = { ws, ready: Promise.resolve() };
Object.assign(window, { __uvf: api });
const noop = { changed: () => undefined, redraw: () => ws.redraw(), notify: () => undefined, syncLost: () => undefined } as never;
const name = q.get('plan') ?? 'sedan', route = q.get('route') ?? 'foundry';
api.ready = (async () => {
  const plan = (fixtures as unknown as Record<string, () => import('../../../src/universal-spatial/contracts-v2').SpatialPlanV2>)[name]!();
  const overrides: Record<string, number | string | boolean> = {};
  for (const [k, v] of q) if (k.startsWith('p.')) overrides[k.slice(2)] = v === 'true' ? true : v === 'false' ? false : Number.isFinite(Number(v)) && v !== '' ? Number(v) : v;
  const reference = new PlanSpaceLayer(plan, noop), refBox = reference.box() as Box3; reference.dispose();
  let last: FoundryResult | null = null; const t0 = performance.now();
  const layer = new PlanSpaceLayer(plan, { changed: () => ws.spaceChanged(), redraw: () => ws.redraw(), notify: () => undefined, syncLost: () => undefined } as never,
    route === 'v2' ? compileSpatialPlanV2 : (p) => { last = compileFoundry(p, { overrides, seed: Number(q.get('seed') ?? 1) }); api.result = last; return last; });
  const buildMs = performance.now() - t0;
  api.layer = layer;
  ws.showSpace(layer, { brandLabel: `espaço · ${plan.title}`, notices: [{ id: 'fixture', text: `Plano grosseiro de teste (não é saída da Meta) · rota ${route}` }] });
  const insets = (ws as unknown as { currentInsets: { top: number; right: number; bottom: number; left: number } }).currentInsets;
  const view = viewForBox(refBox, { azimuthDeg: Number(q.get('az') ?? 38), elevationDeg: Number(q.get('el') ?? 14), ctx: { viewport: { width: app.clientWidth || innerWidth, height: app.clientHeight || innerHeight }, insets: { ...insets }, baseFovDeg: Number(q.get('fov') ?? 30) } });
  ws.setView(view); ws.renderNow();
  const size = (layer.box() as Box3).getSize(new Vector3());
  api.metrics = { route, buildMs: +buildMs.toFixed(1), firstFrameTriangles: layer.stats.triangleCount };
  // wait for the progressive upgrade to finish (foundry route)
  const t1 = performance.now(); while (last && (last as FoundryResult).readyCount() > 0 && performance.now() - t1 < 60_000) await new Promise((r) => setTimeout(r, 30));
  ws.renderNow();
  let tri = 0, meshes = 0; layer.root.traverse((o) => { if (o instanceof Mesh) { meshes++; const g = o.geometry; tri += (g.index ? g.index.count : g.getAttribute('position').count) / 3; } });
  Object.assign(api.metrics as object, { triangles: Math.round(tri), meshes, upgradeMs: +(performance.now() - t1).toFixed(0), boxSize: size.toArray().map((n) => +n.toFixed(3)), report: last ? (last as FoundryResult).report.perFamily : null });
})();
