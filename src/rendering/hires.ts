import * as THREE from 'three';
import { configureRenderer, disposeEnvironment, environmentFor } from './stage';
import { profileFor, readDeviceCaps, type DeviceCaps, type VisualQuality } from './quality';

/**
 * High-resolution still of the SAME scene and camera as the viewer, independent of the viewport's display size.
 *
 * How it stays faithful to the viewer:
 *  - A temporary renderer is configured with the same profile (colour management, tone mapping, exposure, shadow filter).
 *  - The camera is a CLONE, so the viewer's camera is never touched (no state to restore, no frame drawn with a stray view offset).
 *  - Tiles use camera.setViewOffset, which keeps one projection for the whole image. Shadows are computed from the light's own camera, which
 *    does not depend on the view, so they are continuous across tiles; tone mapping and sRGB conversion are per pixel; MSAA works inside each
 *    tile. The seam test in e2e (tile 512 vs one single tile) measures the difference instead of assuming it.
 *  - An environment map belongs to the GL context that built it, so the temporary renderer builds its own for the duration of the render and
 *    the scene's own pointer is put back afterwards. The caller must not draw the scene with another renderer while this runs.
 *  - GPU memory is bounded by the tile, not by the output. The temporary renderer, its environment map and its context are always released.
 */

export type HighResProgress = { done: number; total: number };
export type HighResOptions = {
  width: number; height: number; quality: VisualQuality; tile?: number; background?: THREE.ColorRepresentation | null;
  /** aspect of the viewport the camera is framed for (default: camera.aspect). The export always shows at least what the viewport shows. */
  viewportAspect?: number;
  onProgress?: (progress: HighResProgress) => void; signal?: AbortSignal;
};
export type HighResReport = {
  requested: { width: number; height: number };
  actual: { width: number; height: number };
  tile: number; tiles: number; ms: number;
  limits: { maxTextureSize: number; maxViewport: [number, number]; maxSamples: number; renderer: string; software: boolean };
  clamped: boolean; framing: 'same' | 'wider' | 'taller'; note: string;
};

export class HighResError extends Error {
  constructor(readonly code: 'WEBGL_UNAVAILABLE' | 'CONTEXT_LOST' | 'CANVAS_UNAVAILABLE' | 'ABORTED', message: string) { super(message); this.name = 'HighResError'; }
}

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

/**
 * Pure: the vertical field of view that keeps everything the viewport shows visible in an output of another aspect ratio.
 * Output wider than the viewport: same vertical fov, more room at the sides. Output narrower: the horizontal extent is kept, so fov grows.
 */
export function framingFov(fovDegrees: number, viewportAspect: number, outputAspect: number): { fov: number; framing: 'same' | 'wider' | 'taller' } {
  if (Math.abs(outputAspect - viewportAspect) < 0.005) return { fov: fovDegrees, framing: 'same' };
  if (outputAspect > viewportAspect) return { fov: fovDegrees, framing: 'wider' };
  const half = Math.atan(Math.tan((fovDegrees * Math.PI) / 360) * (viewportAspect / outputAspect));
  return { fov: (half * 360) / Math.PI, framing: 'taller' };
}

export async function renderHighResolution(scene: THREE.Scene, camera: THREE.PerspectiveCamera, options: HighResOptions): Promise<{ canvas: HTMLCanvasElement; report: HighResReport }> {
  const started = performance.now();
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: options.background === null, canvas: document.createElement('canvas') }); }
  catch (error) { throw new HighResError('WEBGL_UNAVAILABLE', `Não foi possível criar um contexto WebGL para exportar: ${error instanceof Error ? error.message : 'erro'}`); }
  let lost = false;
  renderer.domElement.addEventListener('webglcontextlost', (event) => { lost = true; event.preventDefault(); });
  const savedEnvironment = scene.environment;
  try {
    const gl = renderer.getContext();
    const caps: DeviceCaps = readDeviceCaps(gl);
    const maxViewport = Array.from(gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array) as [number, number];
    // 2D canvases are limited by the browser (commonly 16384 per side, ~268 Mpx); stay well inside.
    const clamp = clampOutput(options.width, options.height, Math.min(16384, caps.maxTextureSize * 4), 120_000_000);
    const tile = Math.max(64, Math.min(options.tile ?? 1024, caps.maxTextureSize, maxViewport[0], maxViewport[1]));
    const plan = planTiles(clamp.width, clamp.height, tile);

    const output = document.createElement('canvas'); output.width = clamp.width; output.height = clamp.height;
    const context = output.getContext('2d');
    if (!context || output.width !== clamp.width) throw new HighResError('CANVAS_UNAVAILABLE', 'O navegador não consegue criar uma imagem deste tamanho.');

    configureRenderer(renderer, options.quality, caps);
    renderer.setPixelRatio(1);
    if (options.background !== null) renderer.setClearColor(new THREE.Color(options.background ?? 0x0b0d10), 1);
    if (profileFor(options.quality).environment && savedEnvironment) scene.environment = environmentFor(renderer);

    const view = camera.clone();
    view.copy(camera, false); view.matrixWorld.copy(camera.matrixWorld); view.updateMatrixWorld(true); view.clearViewOffset();
    const viewportAspect = options.viewportAspect ?? camera.aspect;
    const fit = framingFov(camera.fov, viewportAspect, clamp.width / clamp.height);
    view.fov = fit.fov; view.aspect = clamp.width / clamp.height;

    let done = 0; options.onProgress?.({ done, total: plan.length });
    for (const t of plan) {
      if (options.signal?.aborted) throw new HighResError('ABORTED', 'Exportação cancelada.');
      renderer.setSize(t.w, t.h, false);
      view.setViewOffset(clamp.width, clamp.height, t.x, t.y, t.w, t.h);
      view.updateProjectionMatrix();
      renderer.render(scene, view);
      if (lost || gl.isContextLost()) throw new HighResError('CONTEXT_LOST', 'O contexto gráfico foi perdido durante a exportação. Tente um tamanho menor.');
      context.drawImage(renderer.domElement, 0, 0, t.w, t.h, t.x, t.y, t.w, t.h);
      done += 1; options.onProgress?.({ done, total: plan.length });
      await new Promise<void>((resolve) => setTimeout(resolve, 0)); // let the browser paint progress and handle input between tiles
    }
    const note = clamp.clamped ? `Tamanho reduzido pelo dispositivo: pedido ${options.width}×${options.height}, obtido ${clamp.width}×${clamp.height}.`
      : fit.framing === 'same' ? 'Enquadramento igual ao do ecrã.' : fit.framing === 'wider' ? 'A imagem mostra o enquadramento do ecrã e mais espaço nas laterais.' : 'A imagem mostra o enquadramento do ecrã e mais espaço em cima e em baixo.';
    return {
      canvas: output,
      report: {
        requested: { width: options.width, height: options.height }, actual: { width: clamp.width, height: clamp.height }, tile, tiles: plan.length, ms: Math.round(performance.now() - started),
        limits: { maxTextureSize: caps.maxTextureSize, maxViewport, maxSamples: caps.maxSamples, renderer: caps.renderer, software: caps.software }, clamped: clamp.clamped, framing: fit.framing, note,
      },
    };
  } finally {
    scene.environment = savedEnvironment;
    disposeEnvironment(renderer); renderer.dispose(); renderer.forceContextLoss();
  }
}

export const canvasToBlob = (canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> => new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), type));
