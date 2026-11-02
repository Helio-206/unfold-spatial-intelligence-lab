import * as THREE from 'three';

/** Scene and renderer cost counters, plus a frame-time sampler. Read-only: nothing here changes what is drawn. */

export type SceneStats = { nodes: number; meshes: number; lines: number; triangles: number; vertices: number; geometries: number; materials: number; textures: number; textureBytes: number; presentationOnlyMeshes: number; provisionalMeshes: number };

export function sceneStats(root: THREE.Object3D): SceneStats {
  const geometries = new Set<THREE.BufferGeometry>(); const materials = new Set<THREE.Material>(); const textures = new Set<THREE.Texture>();
  const stats: SceneStats = { nodes: 0, meshes: 0, lines: 0, triangles: 0, vertices: 0, geometries: 0, materials: 0, textures: 0, textureBytes: 0, presentationOnlyMeshes: 0, provisionalMeshes: 0 };
  root.traverse((object) => {
    stats.nodes += 1;
    const drawable = object as THREE.Mesh;
    if (!(drawable.isMesh || (object as THREE.Line).isLine)) return;
    if (drawable.isMesh) { stats.meshes += 1; if (drawable.userData.presentationOnly) stats.presentationOnlyMeshes += 1; if (drawable.userData.provisional) stats.provisionalMeshes += 1; } else stats.lines += 1;
    const geometry = drawable.geometry; geometries.add(geometry);
    const position = geometry.getAttribute('position'); const vertices = position?.count ?? 0; stats.vertices += vertices;
    if (drawable.isMesh) stats.triangles += (geometry.index ? geometry.index.count : vertices) / 3;
    for (const material of Array.isArray(drawable.material) ? drawable.material : [drawable.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value && (value as THREE.Texture).isTexture) textures.add(value as THREE.Texture);
    }
  });
  stats.geometries = geometries.size; stats.materials = materials.size; stats.textures = textures.size;
  for (const texture of textures) { const image = texture.image as { width?: number; height?: number } | undefined; if (image?.width && image.height) stats.textureBytes += Math.round(image.width * image.height * 4 * (texture.generateMipmaps ? 4 / 3 : 1)); }
  return stats;
}

export type RendererStats = { calls: number; triangles: number; lines: number; geometries: number; textures: number };
export const rendererStats = (renderer: THREE.WebGLRenderer): RendererStats => ({ calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, lines: renderer.info.render.lines, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures });

export function percentile(values: readonly number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

export type FrameSummary = { frames: number; meanMs: number; p50Ms: number; p95Ms: number; worstMs: number; fps: number };
export function summariseFrames(frameMs: readonly number[]): FrameSummary {
  const mean = frameMs.reduce((a, b) => a + b, 0) / Math.max(1, frameMs.length);
  return { frames: frameMs.length, meanMs: +mean.toFixed(2), p50Ms: +percentile(frameMs, 0.5).toFixed(2), p95Ms: +percentile(frameMs, 0.95).toFixed(2), worstMs: +Math.max(0, ...frameMs).toFixed(2), fps: +(1000 / Math.max(mean, 0.001)).toFixed(1) };
}

/** Times `count` consecutive renders (CPU submit time plus the GPU wait forced by gl.finish when `sync`). */
export function timeRenders(render: () => void, count: number, finish?: () => void): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += 1) { const t0 = performance.now(); render(); finish?.(); out.push(performance.now() - t0); }
  return out;
}
