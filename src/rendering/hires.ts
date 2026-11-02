import * as THREE from 'three';
import { configureRenderer, disposeEnvironment, environmentFor } from './stage';
import { profileFor, type VisualQuality } from './quality';

/**
 * High-resolution still of the SAME scene and camera, independent of the viewport's display size.
 * A temporary renderer draws the image in tiles (camera.setViewOffset keeps projection and framing identical to a single huge render),
 * each tile is copied to a 2D canvas and the renderer is released. GPU memory is bounded by the tile size, not by the output size.
 */

export type HighResOptions = { width: number; height: number; quality: VisualQuality; tile?: number; background?: THREE.ColorRepresentation | null };
export type HighResReport = {
  requested: { width: number; height: number };
  actual: { width: number; height: number };
  tile: number; tiles: number; ms: number;
  limits: { maxTextureSize: number; maxViewport: [number, number]; maxSamples: number; renderer: string };
  clamped: boolean; aspectChanged: boolean; note: string;
};

export type TilePlan = { x: number; y: number; w: number; h: number };

/** Pure: how an output of `width` x `height` is split into tiles of at most `tile` px. */
export function planTiles(width: number, height: number, tile: number): TilePlan[] {
  const plan: TilePlan[] = [];
  for (let y = 0; y < height; y += tile) for (let x = 0; x < width; x += tile) plan.push({ x, y, w: Math.min(tile, width - x), h: Math.min(tile, height - y) });
  return plan;
}

/** Pure: the largest output not above the limits, keeping the requested aspect ratio. */
export function clampOutput(width: number, height: number, maxSide: number, maxPixels: number): { width: number; height: number; clamped: boolean } {
  let scale = Math.min(1, maxSide / Math.max(width, height), Math.sqrt(maxPixels / (width * height)));
  if (scale >= 1) return { width: Math.round(width), height: Math.round(height), clamped: false };
  scale = Math.max(scale, 1 / Math.max(width, height));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), clamped: true };
}

export async function renderHighResolution(scene: THREE.Scene, camera: THREE.PerspectiveCamera, options: HighResOptions): Promise<{ canvas: HTMLCanvasElement; report: HighResReport }> {
  const started = performance.now();
  const probe = new THREE.WebGLRenderer({ antialias: true, canvas: document.createElement('canvas') });
  const gl = probe.getContext();
  const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  const maxViewport = Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array) as [number, number];
  const maxSamples = 'MAX_SAMPLES' in gl ? ((gl as WebGL2RenderingContext).getParameter((gl as WebGL2RenderingContext).MAX_SAMPLES) as number) : 0;
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const rendererName = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  probe.dispose(); probe.forceContextLoss();

  // 2D canvases are limited by the browser (commonly 16384 per side, ~268 Mpx); stay well inside.
  const clamp = clampOutput(options.width, options.height, Math.min(16384, maxTexture * 4), 120_000_000);
  const tile = Math.min(options.tile ?? 1024, maxTexture, maxViewport[0], maxViewport[1]);
  const plan = planTiles(clamp.width, clamp.height, tile);

  const output = document.createElement('canvas'); output.width = clamp.width; output.height = clamp.height;
  const context = output.getContext('2d')!;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: options.background === null, canvas: document.createElement('canvas') });
  configureRenderer(renderer, options.quality);
  renderer.setPixelRatio(1);
  if (options.background !== null) renderer.setClearColor(new THREE.Color(options.background ?? 0x0b0d10), 1);

  // An environment map belongs to the GL context that built it, so the temporary renderer builds its own for the duration of the render.
  const savedEnvironment = scene.environment;
  if (profileFor(options.quality).environment && savedEnvironment) scene.environment = environmentFor(renderer);
  const savedAspect = camera.aspect; const savedView = camera.view ? { ...camera.view } : null;
  const aspect = clamp.width / clamp.height;
  const aspectChanged = Math.abs(aspect - savedAspect) > 0.01;
  try {
    camera.aspect = aspect;
    for (const t of plan) {
      renderer.setSize(t.w, t.h, false);
      camera.setViewOffset(clamp.width, clamp.height, t.x, t.y, t.w, t.h);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      context.drawImage(renderer.domElement, 0, 0, t.w, t.h, t.x, t.y, t.w, t.h);
      await new Promise<void>((resolve) => setTimeout(resolve, 0)); // let the browser breathe between tiles
    }
  } finally {
    camera.aspect = savedAspect;
    if (savedView?.enabled) camera.setViewOffset(savedView.fullWidth, savedView.fullHeight, savedView.offsetX, savedView.offsetY, savedView.width, savedView.height); else camera.clearViewOffset();
    camera.updateProjectionMatrix();
    scene.environment = savedEnvironment;
    disposeEnvironment(renderer); renderer.dispose(); renderer.forceContextLoss();
  }
  return {
    canvas: output,
    report: {
      requested: { width: options.width, height: options.height }, actual: { width: clamp.width, height: clamp.height }, tile, tiles: plan.length, ms: Math.round(performance.now() - started),
      limits: { maxTextureSize: maxTexture, maxViewport, maxSamples, renderer: rendererName }, clamped: clamp.clamped, aspectChanged,
      note: aspectChanged ? 'Output aspect differs from the viewport; vertical field of view is preserved, horizontal coverage changes.' : 'Camera framing identical to the viewport.',
    },
  };
}

export const canvasToBlob = (canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> => new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), type));
