/**
 * FoundryRenderer: one WebGL renderer, one scene, one camera, rendered on demand (no perpetual loop).
 *
 * Two profiles:
 *  - realtime: capped pixel ratio, MSAA 4× HDR target, 2048 shadows, no AO. For interaction.
 *  - export:   pixel ratio 2, MSAA 4×, 4096 shadows, GTAO. For stills ("Golden Frame"), rendered once.
 * Colour management: linear working space, Khronos PBR Neutral tone mapping and sRGB output in the OutputPass.
 */
import { HalfFloatType, NeutralToneMapping, NoToneMapping, PCFSoftShadowMap, PerspectiveCamera, Scene, SRGBColorSpace, Vector2, WebGLRenderer, WebGLRenderTarget, type Mesh } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { Studio } from './studio';

export type RenderProfileName = 'realtime' | 'export';
/** motionScale: render-resolution factor while the view is moving (real-time profile); full resolution at rest. */
export type RenderProfile = { name: RenderProfileName; maxPixelRatio: number; msaa: number; shadowMapSize: number; contactShadowSize: number; ao: boolean; motionScale: number };

export const RENDER_PROFILES: Record<RenderProfileName, RenderProfile> = {
  realtime: { name: 'realtime', maxPixelRatio: 1.5, msaa: 4, shadowMapSize: 2048, contactShadowSize: 512, ao: false, motionScale: 1 }, // motion resolution off: under SwiftShader it did not help (vertex/shadow bound); re-measure on GPUs
  export: { name: 'export', maxPixelRatio: 2, msaa: 4, shadowMapSize: 4096, contactShadowSize: 1024, ao: true, motionScale: 1 },
};

export type RenderStats = {
  profile: RenderProfileName; drawCalls: number; triangles: number; geometries: number; textures: number; programs: number;
  lastFrameMs: number; frames: number; pixelRatio: number; motion: boolean; size: [number, number]; renderer: string; softwareRendering: boolean;
};

export class FoundryRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly studio: Studio;
  readonly profile: RenderProfile;
  private readonly composer: EffectComposer;
  private readonly ao: GTAOPass | null;
  private frameRequested = false;
  private disposed = false;
  private lastFrameMs = 0;
  private motion = false;
  private basePixelRatio = 1;
  private restTimer = 0;
  private frames = 0;
  private readonly beforeRender = new Set<() => void>();
  private readonly afterRender = new Set<() => void>();
  readonly rendererInfo: string;

  constructor(readonly canvasHost: HTMLElement, profileName: RenderProfileName = 'realtime', options: { preserveDrawingBuffer?: boolean; pixelRatio?: number } = {}) {
    this.profile = RENDER_PROFILES[profileName];
    const r = new WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance', preserveDrawingBuffer: options.preserveDrawingBuffer ?? false });
    this.basePixelRatio = options.pixelRatio ?? Math.min(globalThis.devicePixelRatio ?? 1, this.profile.maxPixelRatio);
    r.setPixelRatio(this.basePixelRatio);
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = NoToneMapping; // the OutputPass applies tone mapping once
    r.shadowMap.enabled = true; r.shadowMap.type = PCFSoftShadowMap;
    r.domElement.classList.add('uw-canvas');
    r.domElement.setAttribute('aria-hidden', 'true');
    canvasHost.prepend(r.domElement);
    this.renderer = r;
    const gl = r.getContext();
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    this.rendererInfo = String(gl.getParameter(dbg ? dbg.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    this.camera = new PerspectiveCamera(30, 1, 0.1, 400);
    this.studio = new Studio(r, this.scene, this.profile);
    const size = this.size();
    r.setSize(size.x, size.y, false);
    const buffer = r.getDrawingBufferSize(new Vector2());
    const target = new WebGLRenderTarget(buffer.x, buffer.y, { type: HalfFloatType, samples: this.profile.msaa });
    this.composer = new EffectComposer(r, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = null;
    if (this.profile.ao) {
      const ao = new GTAOPass(this.scene, this.camera, buffer.x, buffer.y);
      ao.blendIntensity = 0.9;
      ao.updateGtaoMaterial({ radius: 0.32, distanceExponent: 1.6, thickness: 1.0, scale: 1, samples: 16 });
      ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
      // see-through parts are not solid: keep glass out of the AO normal/depth pass
      const aoRender = ao.render.bind(ao);
      ao.render = (...args: Parameters<GTAOPass['render']>) => {
        const hidden: Mesh[] = [];
        this.scene.traverse((o) => { const m = o as Mesh; if (m.isMesh && m.visible && (m.userData.materialKey === 'glass' || m.userData.noAO)) { m.visible = false; hidden.push(m); } });
        aoRender(...args); for (const m of hidden) m.visible = true;
      };
      this.composer.addPass(ao);
      this.ao = ao;
    }
    const out = new OutputPass();
    this.composer.addPass(out);
    r.toneMapping = NeutralToneMapping; // read by the OutputPass
    this.resize();
  }

  private size(): Vector2 { return new Vector2(Math.max(1, this.canvasHost.clientWidth), Math.max(1, this.canvasHost.clientHeight)); }

  resize(): void {
    const s = this.size();
    this.camera.aspect = s.x / s.y; this.camera.updateProjectionMatrix();
    this.renderer.setSize(s.x, s.y, false);
    this.composer.setSize(s.x, s.y);
    this.requestRender();
  }

  /**
   * Motion resolution: while the camera or parts are moving, render at `motionScale`; 160 ms after the last moving
   * frame, return to full resolution and render one clean frame. No effect in the export profile.
   */
  markMotion(): void {
    if (this.profile.motionScale >= 1) return;
    clearTimeout(this.restTimer);
    if (!this.motion) { this.motion = true; this.applyPixelRatio(this.basePixelRatio * this.profile.motionScale); }
    this.restTimer = window.setTimeout(() => { this.motion = false; this.applyPixelRatio(this.basePixelRatio); this.requestRender(); }, 160);
  }

  private applyPixelRatio(ratio: number): void {
    this.renderer.setPixelRatio(ratio);
    this.composer.setPixelRatio(ratio);
    const s = this.size();
    this.renderer.setSize(s.x, s.y, false);
    this.composer.setSize(s.x, s.y);
  }

  onBeforeRender(fn: () => void): () => void { this.beforeRender.add(fn); return () => this.beforeRender.delete(fn); }
  onAfterRender(fn: () => void): () => void { this.afterRender.add(fn); return () => this.afterRender.delete(fn); }

  /** Schedules exactly one frame. Callers that animate request again from their own update. */
  requestRender(): void {
    if (this.frameRequested || this.disposed) return;
    this.frameRequested = true;
    requestAnimationFrame(() => { this.frameRequested = false; this.renderNow(); });
  }

  renderNow(): void {
    if (this.disposed) return;
    const t0 = performance.now();
    for (const fn of this.beforeRender) fn();
    this.renderer.info.reset();
    this.renderer.info.autoReset = false;
    this.composer.render();
    this.lastFrameMs = performance.now() - t0;
    this.frames++;
    for (const fn of this.afterRender) fn();
  }

  stats(): RenderStats {
    const info = this.renderer.info;
    const s = this.renderer.getDrawingBufferSize(new Vector2());
    return {
      profile: this.profile.name, drawCalls: info.render.calls, triangles: info.render.triangles, geometries: info.memory.geometries, textures: info.memory.textures,
      programs: info.programs?.length ?? 0, lastFrameMs: this.lastFrameMs, frames: this.frames, pixelRatio: this.renderer.getPixelRatio(), motion: this.motion, size: [s.x, s.y],
      renderer: this.rendererInfo, softwareRendering: /swiftshader|llvmpipe|software/i.test(this.rendererInfo),
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    clearTimeout(this.restTimer);
    this.studio.dispose();
    this.ao?.dispose();
    this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
  }
}
