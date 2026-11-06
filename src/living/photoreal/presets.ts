/**
 * Quality presets and capability detection for the photoreal path. Pure functions where possible so
 * the fallback rules are unit-tested without a GPU. Software rendering (SwiftShader/llvmpipe) always
 * falls back to the balanced preset's material set without the stage lights' extra shadow cost, and
 * any missing WebGL2 falls back entirely to the stock renderer (the caller simply does not apply).
 */
export type PhotorealPresetName = 'cinematic' | 'balanced' | 'performance';
export type PhotorealPreset = {
  name: PhotorealPresetName;
  envMapIntensityScale: number;
  exposure: number;
  shadowMapSize: number;
  microdetail: boolean;
  contactShadow: boolean;
};

export const PHOTOREAL_PRESETS: Record<PhotorealPresetName, PhotorealPreset> = {
  cinematic: { name: 'cinematic', envMapIntensityScale: 1, exposure: 1.02, shadowMapSize: 2048, microdetail: true, contactShadow: true },
  balanced: { name: 'balanced', envMapIntensityScale: 0.9, exposure: 1, shadowMapSize: 1024, microdetail: true, contactShadow: true },
  performance: { name: 'performance', envMapIntensityScale: 0.8, exposure: 1, shadowMapSize: 512, microdetail: false, contactShadow: false },
};

export type RendererCapabilities = { webgl2: boolean; maxTextures: number; softwareRendering: boolean; rendererInfo: string };

export function selectPhotorealPreset(requested: PhotorealPresetName, caps: RendererCapabilities): PhotorealPreset | null {
  if (!caps.webgl2 || caps.maxTextures < 8) return null; // no safe photoreal path: caller keeps the stock renderer
  if (caps.softwareRendering) return PHOTOREAL_PRESETS.performance;
  return PHOTOREAL_PRESETS[requested];
}

export function detectCapabilities(renderer: { getContext(): WebGLRenderingContext | WebGL2RenderingContext }): RendererCapabilities {
  const gl = renderer.getContext();
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const info = String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
  return {
    webgl2: typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext,
    maxTextures: Number(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS)) || 0,
    softwareRendering: /swiftshader|llvmpipe|software/i.test(info),
    rendererInfo: info,
  };
}
