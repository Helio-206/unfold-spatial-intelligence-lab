/**
 * REFERENCE HOST for the Fidelity V3 evidence (test only, not product code, not a second workspace). It mounts the real SpatialWorkspace and the real
 * PlanSpaceLayer, and varies ONE thing: the geometry route passed through the layer's `compile` seam.
 *
 * Query: fixture=<name> (JSON under /reports/fidelity-v3/fixtures), route=v2|router, asset=camera (+ approve=1) for the external-mesh path.
 * Same camera for every route: the view is computed once from a throw-away V2 layer, so only the geometry differs between captures.
 */
import '../../../src/brand.css';
import { Box3, Vector3 } from 'three';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../../src/living/contracts/fixtures/excavator.assembly.v1';
import { createStudioEnvironment } from '../../../src/living/cinema/studio-environment';
import { SpatialWorkspace } from '../../../src/living/workspace-design/workspace';
import { PlanSpaceLayer } from '../../../src/living/spatial-space/layer';
import { validateSpatialPlanV2 } from '../../../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2 } from '../../../src/universal-spatial/geometry-compiler-v2';
import { compileWithRouter } from '../../../src/universal-spatial/fidelity/router';
import { createAssetOffer, type AssetOffer } from '../../../src/universal-spatial/fidelity/assets';
import { loadValidatedGlb } from '../../../src/universal-spatial/fidelity/glb';
import { DEFAULT_ROUTER_LIMITS, type AssetApproval, type AssetProposal, type RouterReport } from '../../../src/universal-spatial/fidelity/types';
import { viewForBox } from '../../../src/living/spatial-presentation/cues';

const q = new URLSearchParams(location.search), app = document.querySelector<HTMLElement>('#app')!;
document.body.style.margin = '0';
const ws = new SpatialWorkspace(app, { assembly: EXCAVATOR_ASSEMBLY_V1, agent: { mode: 'fixture' }, reducedMotion: true, preserveDrawingBuffer: true, look: 'premium', premiumEnvironment: createStudioEnvironment, startEmpty: true });
ws.renderNow();
type Api = { ws: SpatialWorkspace; layer: PlanSpaceLayer | null; report: RouterReport | null; metrics: Record<string, unknown>; assetNote: string | null; ready: Promise<void> };
const api: Api = { ws, layer: null, report: null, metrics: {}, assetNote: null, ready: Promise.resolve() };
Object.assign(window, { __fid: api });
const sha256 = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer))].map((b) => b.toString(16).padStart(2, '0')).join('');
const noop = { changed: () => undefined, redraw: () => undefined, notify: () => undefined, syncLost: () => undefined } as never;

const fixture = q.get('fixture');
if (fixture) api.ready = (async () => {
  const reply = await (await fetch(`/reports/fidelity-v3/fixtures/${fixture}.json`)).json(), plan = validateSpatialPlanV2(reply.plan);
  const assets: AssetOffer[] = [], approvals: AssetApproval[] = [];
  if (q.get('asset') === 'camera') {
    const t0 = performance.now(), bytes = new Uint8Array(await (await fetch('/__assets/AntiqueCamera.glb')).arrayBuffer()), digest = await sha256(bytes);
    const loaded = await loadValidatedGlb(bytes, DEFAULT_ROUTER_LIMITS, { downscaleTo: 1024 });
    if ('refused' in loaded) api.assetNote = `refused: ${loaded.refused} (${loaded.detail})`;
    else {
      const proposal: AssetProposal = { id: `glb-${digest.slice(0, 12)}`, sha256: digest, source: { kind: 'licensed_library', library: 'KhronosGroup/glTF-Sample-Assets AntiqueCamera (UX3D, CC0-1.0)' }, license: { spdx: 'CC0-1.0', attribution: 'Maximillan Kamps / UX3D', sourceUrl: 'https://github.com/KhronosGroup/glTF-Sample-Assets/tree/main/Models/AntiqueCamera', verified: true },
        mapping: [{ componentId: 'camera', nodePaths: ['camera'], method: 'node_name', confidence: 1 }, { componentId: 'tripod', nodePaths: ['tripod'], method: 'node_name', confidence: 1 }], stats: { triangles: loaded.info.triangles, nodes: loaded.info.nodes, materials: loaded.info.materials, textures: loaded.info.textures, textureBytes: loaded.info.textureBytes, bytes: loaded.info.bytes }, status: 'proposed' };
      assets.push(createAssetOffer(proposal, loaded.scene));
      if (q.get('approve') === '1') approvals.push({ proposalId: proposal.id, componentIds: ['camera', 'tripod'], decidedBy: 'human_review', reviewerAuthenticated: false, at: new Date().toISOString() });
      api.assetNote = `validated and loaded in ${(performance.now() - t0).toFixed(0)} ms; ${loaded.info.triangles} triangles; decoded textures ${(loaded.info.textureBytes / 1048576).toFixed(1)} MB after downscale to ${loaded.info.downscaledTo}; ${approvals.length ? 'approved' : 'NOT approved'}`;
    }
  }
  // one camera for every route: from a throw-away V2 layer
  const reference = new PlanSpaceLayer(plan, noop), refBox = reference.box() as Box3; reference.dispose();
  const route = q.get('route') ?? 'v2';
  const t0 = performance.now();
  const layer = new PlanSpaceLayer(plan, { changed: () => ws.spaceChanged(), redraw: () => ws.redraw(), notify: () => undefined, syncLost: () => undefined } as never,
    route === 'router' ? (p) => { const routed = compileWithRouter(p, { assets, approvals, limits: { maxGridCells: 96 } }); api.report = routed.report; return routed; } : compileSpatialPlanV2);
  const buildMs = performance.now() - t0;
  api.layer = layer; ws.showSpace(layer, { brandLabel: `espaço · ${plan.title}`, notices: [{ id: 'fixture', text: `Fixture manual, não é saída da Meta · rota ${route}${api.assetNote ? ` · malha externa: ${api.assetNote}` : ''}` }] });
  // usable area known only now (the workspace started empty); the same reference box gives the same view for every route
  const insets = (ws as unknown as { currentInsets: { top: number; right: number; bottom: number; left: number } }).currentInsets;
  const view = viewForBox(refBox, { azimuthDeg: 38, elevationDeg: 14, ctx: { viewport: { width: app.clientWidth || innerWidth, height: app.clientHeight || innerHeight }, insets: { ...insets }, baseFovDeg: 30 } });

  ws.setView(view); ws.renderNow();
  const size = (layer.box() as Box3).getSize(new Vector3());
  api.metrics = { route, buildMs: +buildMs.toFixed(1), triangles: layer.stats.triangleCount, meshes: layer.stats.meshCount, geometryBytes: layer.stats.geometryBytes, components: layer.stats.componentCount, boxSize: size.toArray().map((n) => +n.toFixed(3)), view };
})();
