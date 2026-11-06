/**
 * A standalone ShaderMaterial implementing the module's own Cook–Torrance GLSL end to end
 * (up to four directional lights, no textures), used for the neutral material-sphere reference
 * comparisons. The product path uses MeshPhysicalMaterial's maintained GGX plus this subsystem's
 * microdetail/studio work; this material exists so the custom BRDF itself is exercised, compiled
 * and compared honestly — not smuggled into claims about the product renderer.
 */
import { Color, ShaderMaterial, Vector3 } from 'three';
import { PHOTOREAL_BRDF_GLSL } from './brdf';

export type ReferenceLight = { direction: [number, number, number]; color: string; intensity: number };

export function createReferenceMaterial(options: { albedo: string; metallic: number; roughness: number; lights: ReferenceLight[] }): ShaderMaterial {
  const lights = options.lights.slice(0, 4);
  while (lights.length < 4) lights.push({ direction: [0, 1, 0], color: '#000000', intensity: 0 });
  return new ShaderMaterial({
    uniforms: {
      uAlbedo: { value: new Color(options.albedo) },
      uMetallic: { value: options.metallic },
      uRoughness: { value: options.roughness },
      uLightDirs: { value: lights.map((l) => new Vector3(...l.direction).normalize()) },
      uLightColors: { value: lights.map((l) => new Color(l.color).multiplyScalar(l.intensity)) },
    },
    vertexShader: /* glsl */`
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      void main() {
        vNormal = normalize(mat3(modelMatrix) * normal);
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorldPos = world.xyz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */`
      uniform vec3 uAlbedo;
      uniform float uMetallic;
      uniform float uRoughness;
      uniform vec3 uLightDirs[4];
      uniform vec3 uLightColors[4];
      varying vec3 vNormal;
      varying vec3 vWorldPos;
      ${PHOTOREAL_BRDF_GLSL}
      void main() {
        vec3 n = normalize(vNormal);
        vec3 v = normalize(cameraPosition - vWorldPos);
        vec3 radiance = uAlbedo * 0.03; // controlled ambient contribution, kept deliberately small
        for (int i = 0; i < 4; i++) {
          vec3 l = normalize(uLightDirs[i]);
          float nDotL = max(dot(n, l), 0.0);
          radiance += unfoldCookTorrance(n, v, l, uAlbedo, uMetallic, clamp(uRoughness, 0.045, 1.0)) * uLightColors[i] * nDotL;
        }
        gl_FragColor = vec4(radiance, 1.0);
      }`,
  });
}
