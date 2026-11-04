/**
 * REFERENCE HOST for the Fidelity V3 evidence (test only, not product code, not a second workspace). It mounts the real SpatialWorkspace and the real
 * PlanSpaceLayer, and varies ONE thing: the geometry route passed through the layer's `compile` seam.
 *
 * Query: fixture=<name> (JSON under /reports/fidelity-v3/fixtures), route=v2|router, asset=camera (+ approve=1) for the external-mesh path.
 * Same camera for every route: the view is computed once from a throw-away V2 layer, so only the geometry differs between captures.
 */
import '../../../src/brand.css';
import { Box3, Mesh, Vector3, type Object3D } from 'three';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../../src/living/contracts/fixtures/excavator.assembly.v1';
import { createStudioEnvironment } from '../../../src/living/cinema/studio-environment';
import { SpatialWorkspace } from '../../../src/living/workspace-design/workspace';
import { PlanSpaceLayer } from '../../../src/living/spatial-space/layer';
import { validateSpatialPlanV2 } from '../../../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2 } from '../../../src/universal-spatial/geometry-compiler-v2';
import { compileWithRouter } from '../../../src/universal-spatial/fidelity/router';
import { ContinuousService, createBrowserWorker, createInlineWorker, type WorkerLike } from '../../../src/universal-spatial/fidelity/continuous-service';
import { createAssetOffer, type AssetOffer } from '../../../src/universal-spatial/fidelity/assets';
import { runContinuousJob } from '../../../src/universal-spatial/fidelity/continuous-job';
import { loadValidatedGlb, validateGlb } from '../../../src/universal-spatial/fidelity/glb';
import { DEFAULT_ROUTER_LIMITS, type AssetApproval, type AssetProposal, type RouterReport } from '../../../src/universal-spatial/fidelity/types';
import { viewForBox } from '../../../src/living/spatial-presentation/cues';

const q = new URLSearchParams(location.search), app = document.querySelector<HTMLElement>('#app')!;
document.body.style.margin = '0';
const ws = new SpatialWorkspace(app, { assembly: EXCAVATOR_ASSEMBLY_V1, agent: { mode: 'fixture' }, reducedMotion: true, preserveDrawingBuffer: true, look: 'premium', premiumEnvironment: createStudioEnvironment, startEmpty: true });
ws.renderNow();
type Api = { ws: SpatialWorkspace; layer: PlanSpaceLayer | null; report: RouterReport | null; metrics: Record<string, unknown>; assetNote: string | null; ready: Promise<void>;
  service: ContinuousService | null; counters: { created: number; terminated: number; messages: number }; events: Array<{ t: number; ids: string[]; ms: number }>; mount(planJson: unknown, route: string, opts?: { timeoutMs?: number; inline?: boolean; pool?: number; rim?: 'discard' }): { layer: PlanSpaceLayer; service: ContinuousService | null; buildMs: number }; dropService(): void; longTasks: Array<{ start: number; duration: number }>; mountStart: number; frameGaps: Array<{ at: number; gap: number }>; firstFrame: { atMs: number; families: Record<string, string>; pending: string[] } | null; decodeGlb(mode: 'validate' | 'full' | 'post' | 'pre' | 'seq', side: number): Promise<Record<string, unknown>>; fingerprint(root: Object3D): Record<string, { family: string; triangles: number; hash: string }>; syncFingerprint(): Record<string, { family: string; triangles: number; hash: string }> };
const api = { ws, layer: null, report: null, metrics: {}, assetNote: null, ready: Promise.resolve(), service: null, counters: { created: 0, terminated: 0, messages: 0 }, events: [], longTasks: [], mountStart: 0, frameGaps: [], firstFrame: null } as unknown as Api;
{ let last = performance.now(); const tick = (now: number) => { api.frameGaps.push({ at: now, gap: now - last }); last = now; requestAnimationFrame(tick); }; requestAnimationFrame(tick); } // gap between animation frames: what a person feels as a freeze
try { new PerformanceObserver((list) => { for (const e of list.getEntries()) api.longTasks.push({ start: e.startTime, duration: e.duration }); }).observe({ entryTypes: ['longtask'] }); } catch { /* not supported: reported as such */ }
Object.assign(window, { __fid: api });
const sha256 = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as unknown as ArrayBuffer))].map((b) => b.toString(16).padStart(2, '0')).join('');
const noop = { changed: () => undefined, redraw: () => undefined, notify: () => undefined, syncLost: () => undefined } as never;

/** A Worker that counts what is created, used and terminated: the leak checks read these. */
function countedWorker(inline: boolean, rim?: 'discard'): WorkerLike {
  const w = rim === 'discard' ? createInlineWorker((job) => runContinuousJob(job, undefined, { rim })) : inline ? createInlineWorker() : createBrowserWorker(); api.counters.created++;
  const terminate = w.terminate.bind(w), post = w.postMessage.bind(w);
  w.terminate = () => { api.counters.terminated++; terminate(); }; w.postMessage = (m, t) => { api.counters.messages++; post(m, t); };
  return w;
}

api.mount = (planJson, route, opts = {}) => {
  const plan = validateSpatialPlanV2(planJson);
  const service = route === 'live' ? new ContinuousService({ createWorker: () => countedWorker(opts.inline === true, opts.rim), jobTimeoutMs: opts.timeoutMs ?? 15_000, ...(opts.pool ? { poolSize: opts.pool } : {}) }) : null;
  api.service = service;
  const t0 = performance.now();
  const layer = new PlanSpaceLayer(plan, { changed: () => ws.spaceChanged(), redraw: () => ws.redraw(), notify: () => undefined, syncLost: () => undefined } as never,
    route === 'v2' ? compileSpatialPlanV2 : (p) => { const routed = compileWithRouter(p, { assets: [], approvals: [], limits: { maxGridCells: 96 }, ...(service ? { service } : {}) }); api.report = routed.report; return routed; });
  const buildMs = performance.now() - t0;
  if (service) service.onReady(() => { const t = performance.now(), ids = layer.upgradeGeometry(); api.events.push({ t, ids, ms: performance.now() - t }); });
  api.layer = layer;
  return { layer, service, buildMs };
};
/** Per component: family, triangles and a hash of the exact vertex bits. Two draws of the same plan are equal iff these are equal. */
api.fingerprint = (root) => {
  const out: Record<string, { family: string; triangles: number; hash: string; h: number }> = {};
  root.traverse((o) => {
    if (!(o instanceof Mesh) || typeof o.userData.spatialEntityId !== 'string') return;
    const id = o.userData.spatialEntityId as string, e = out[id] ?? (out[id] = { family: String(o.userData.geometryFamily ?? 'procedural_v2'), triangles: 0, hash: '', h: 2166136261 });
    const pos = o.geometry.getAttribute('position').array as Float32Array, bits = new Uint32Array(pos.buffer, pos.byteOffset, pos.length);
    let h = e.h; for (let i = 0; i < bits.length; i++) h = Math.imul(h ^ bits[i]!, 16777619); e.h = h;
    e.triangles += (o.geometry.index ? o.geometry.index.count : pos.length / 3) / 3; e.hash = (h >>> 0).toString(16);
  });
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { family: v.family, triangles: v.triangles, hash: v.hash }]));
};
api.syncFingerprint = () => { const routed = compileWithRouter(api.layer!.currentPlan, { limits: { maxGridCells: 96 } }); const fp = api.fingerprint(routed.root); routed.root.traverse((o) => { if (o instanceof Mesh) { o.geometry.dispose(); } }); return fp; };
api.decodeGlb = async (mode, side) => {
  const bytes = new Uint8Array(await (await fetch('/__assets/AntiqueCamera.glb')).arrayBuffer()), t0 = performance.now();
  if (mode === 'validate') { const v = validateGlb(bytes, DEFAULT_ROUTER_LIMITS, { downscaleTo: side }); return { mode, ok: v.ok, ms: performance.now() - t0 }; }
  const loaded = await loadValidatedGlb(bytes, mode === 'full' ? { ...DEFAULT_ROUTER_LIMITS, maxTextureBytes: 1024 * 1024 * 1024, maxTextureSide: 4096 } : DEFAULT_ROUTER_LIMITS, mode === 'full' ? {} : { downscaleTo: side, decode: mode });
  if ('refused' in loaded) return { mode, refused: loaded.refused, ms: performance.now() - t0 };
  const sizes: number[] = []; loaded.scene.traverse((o) => { if (o instanceof Mesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) for (const v of Object.values(m)) { const img = (v as { image?: { width?: number; height?: number } } | null)?.image; if (img?.width && !sizes.includes(img.width * 1e5 + (img.height ?? 0))) sizes.push(img.width * 1e5 + (img.height ?? 0)); } });
  return { mode, ms: +(performance.now() - t0).toFixed(0), textureSizes: sizes.map((n) => `${Math.floor(n / 1e5)}x${n % 1e5}`), info: loaded.info };
};
api.dropService = () => { api.service?.dispose(); api.service = null; };

const fixture = q.get('fixture'), source = q.get('src');
if (fixture || source) api.ready = (async () => {
  const reply = await (await fetch(source ?? `/reports/fidelity-v3/fixtures/${fixture}.json`)).json(), plan = validateSpatialPlanV2(reply.plan);
  const label = source ? `plano guardado da Meta (${source.split('/').pop()}), parâmetros do reparador antigo` : 'Fixture manual, não é saída da Meta';
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
  api.mountStart = performance.now();
  const built = route === 'live' ? api.mount(reply.plan, 'live', { ...(q.get('timeout') ? { timeoutMs: Number(q.get('timeout')) } : {}), inline: q.get('inline') === '1', ...(q.get('rim') === 'discard' ? { rim: 'discard' as const } : {}) }) : null;
  const t0 = performance.now();
  const layer = built ? built.layer : new PlanSpaceLayer(plan, { changed: () => ws.spaceChanged(), redraw: () => ws.redraw(), notify: () => undefined, syncLost: () => undefined } as never,
    route === 'router' ? (p) => { const routed = compileWithRouter(p, { assets, approvals, limits: { maxGridCells: 96 } }); api.report = routed.report; return routed; } : compileSpatialPlanV2);
  const buildMs = built ? built.buildMs : performance.now() - t0;
  api.layer = layer; ws.showSpace(layer, { brandLabel: `espaço · ${plan.title}`, notices: [{ id: 'fixture', text: `${label} · rota ${route}${api.assetNote ? ` · malha externa: ${api.assetNote}` : ''}` }] });
  const insets = (ws as unknown as { currentInsets: { top: number; right: number; bottom: number; left: number } }).currentInsets;
  const view = viewForBox(refBox, { azimuthDeg: 38, elevationDeg: 14, ctx: { viewport: { width: app.clientWidth || innerWidth, height: app.clientHeight || innerHeight }, insets: { ...insets }, baseFovDeg: 30 } });

  ws.setView(view); ws.renderNow();
  { const families: Record<string, string> = {}; layer.root.traverse((o) => { if (o instanceof Mesh && typeof o.userData.spatialEntityId === 'string') families[o.userData.spatialEntityId] = String(o.userData.geometryFamily ?? 'procedural_v2'); }); api.firstFrame = { atMs: performance.now(), families, pending: [...(api.report?.pending ?? [])] }; } // the state of the very first frame: no message from a worker can have been handled yet
  const size = (layer.box() as Box3).getSize(new Vector3());
  api.metrics = { route, buildMs: +buildMs.toFixed(1), triangles: layer.stats.triangleCount, meshes: layer.stats.meshCount, geometryBytes: layer.stats.geometryBytes, components: layer.stats.componentCount, boxSize: size.toArray().map((n) => +n.toFixed(3)), view };
})();
