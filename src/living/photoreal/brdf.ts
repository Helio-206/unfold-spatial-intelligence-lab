/**
 * UNFOLD photoreal BRDF — reference mathematics (TypeScript) and the matching GLSL chunk.
 *
 * The model is Cook–Torrance with a GGX microfacet distribution, Smith's joint masking-shadowing
 * for the GGX (height-correlated, the form whose grazing behaviour stays finite), Schlick's Fresnel
 * approximation, and an energy-aware diffuse term: the diffuse lobe is scaled by (1 - F) per
 * wavelength average and by (1 - metallic), so a surface never returns more light than it receives
 * from a single bounce of this model. Three.js already ships a GGX implementation; this module is
 * NOT claimed to be better because it is custom. It exists so the numbers the product uses are
 * explicit, unit-tested, and identical between the material-sphere reference material and the tests.
 *
 * Conventions: all directions unit length, in the same space; `nDotV`/`nDotL` are clamped to a small
 * positive floor only inside denominators, never silently rewriting the geometry.
 */

export type Vec3 = [number, number, number];

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
export const dot3 = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const normalize3 = (a: Vec3): Vec3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Roughness is clamped to a working range: exactly 0 makes GGX a delta and breaks every denominator. */
export const effectiveRoughness = (roughness: number): number => clamp(Number.isFinite(roughness) ? roughness : 1, 0.045, 1);

/** GGX (Trowbridge–Reitz) normal distribution. `alpha = roughness^2` (the perceptual remap). */
export function ggxDistribution(nDotH: number, roughness: number): number {
  const alpha = effectiveRoughness(roughness) ** 2;
  const a2 = alpha * alpha;
  const d = nDotH * nDotH * (a2 - 1) + 1;
  return a2 / (Math.PI * d * d);
}

/** Smith GGX masking for one direction. */
export function smithG1(nDotX: number, roughness: number): number {
  const alpha = effectiveRoughness(roughness) ** 2;
  const x = Math.max(nDotX, 1e-4);
  return (2 * x) / (x + Math.sqrt(alpha * alpha + (1 - alpha * alpha) * x * x));
}

/** Height-correlated Smith joint term (Heitz): finite at grazing, never above the separable bound. */
export function smithJoint(nDotV: number, nDotL: number, roughness: number): number {
  const alpha = effectiveRoughness(roughness) ** 2;
  const v = Math.max(nDotV, 1e-4), l = Math.max(nDotL, 1e-4);
  const lambdaV = (-1 + Math.sqrt(alpha * alpha * (1 - l * l) / (l * l) + 1)) / 2;
  const lambdaL = (-1 + Math.sqrt(alpha * alpha * (1 - v * v) / (v * v) + 1)) / 2;
  return 1 / (1 + lambdaV + lambdaL);
}

/** Schlick Fresnel: F0 at normal incidence, 1 at grazing. */
export function fresnelSchlick(cosTheta: number, f0: number): number {
  const m = clamp(1 - cosTheta, 0, 1);
  return f0 + (1 - f0) * m ** 5;
}

/** Dielectric F0 from IOR (0.04 at 1.5); metals use their base colour as F0 instead. */
export const dielectricF0 = (ior = 1.5): number => ((ior - 1) / (ior + 1)) ** 2;

export type BrdfInput = {
  normal: Vec3; view: Vec3; light: Vec3;
  /** linear-space base colour */
  albedo: Vec3;
  metallic: number; roughness: number;
};

/**
 * Outgoing radiance factor (BRDF value, to be multiplied by light colour × nDotL by the caller)
 * for one directional light. Returns [0,0,0] for back-facing configurations instead of negatives.
 */
export function cookTorrance(input: BrdfInput): Vec3 {
  const n = normalize3(input.normal), v = normalize3(input.view), l = normalize3(input.light);
  const nDotV = dot3(n, v), nDotL = dot3(n, l);
  if (nDotV <= 0 || nDotL <= 0) return [0, 0, 0];
  const h = normalize3([v[0] + l[0], v[1] + l[1], v[2] + l[2]]);
  const nDotH = Math.max(dot3(n, h), 0), vDotH = Math.max(dot3(v, h), 0);
  const metallic = clamp(input.metallic, 0, 1);
  const d = ggxDistribution(nDotH, input.roughness);
  const g = smithJoint(nDotV, nDotL, input.roughness);
  const specularScale = (d * g) / Math.max(4 * nDotV * nDotL, 1e-4);
  const out: Vec3 = [0, 0, 0];
  for (let i = 0 as 0 | 1 | 2; i < 3; i++) {
    const f0 = metallic * input.albedo[i]! + (1 - metallic) * dielectricF0();
    const f = fresnelSchlick(vDotH, f0);
    const specular = specularScale * f;
    // Energy-aware diffuse: what Fresnel reflects cannot also be diffusely scattered.
    const diffuse = (input.albedo[i]! / Math.PI) * (1 - f) * (1 - metallic);
    out[i] = diffuse + specular;
  }
  return out;
}

/** The same model in GLSL (ES 3.0), used by the reference material. Kept textually aligned with the TS. */
export const PHOTOREAL_BRDF_GLSL = /* glsl */`
float unfoldGgxD(float nDotH, float roughness) {
  float alpha = roughness * roughness;
  float a2 = alpha * alpha;
  float d = nDotH * nDotH * (a2 - 1.0) + 1.0;
  return a2 / (3.141592653589793 * d * d);
}
float unfoldSmithJoint(float nDotV, float nDotL, float roughness) {
  float alpha = roughness * roughness;
  float v = max(nDotV, 1e-4);
  float l = max(nDotL, 1e-4);
  float lambdaV = (-1.0 + sqrt(alpha * alpha * (1.0 - l * l) / (l * l) + 1.0)) / 2.0;
  float lambdaL = (-1.0 + sqrt(alpha * alpha * (1.0 - v * v) / (v * v) + 1.0)) / 2.0;
  return 1.0 / (1.0 + lambdaV + lambdaL);
}
vec3 unfoldFresnel(float cosTheta, vec3 f0) {
  float m = clamp(1.0 - cosTheta, 0.0, 1.0);
  return f0 + (1.0 - f0) * pow(m, 5.0);
}
vec3 unfoldCookTorrance(vec3 n, vec3 v, vec3 l, vec3 albedo, float metallic, float roughness) {
  float nDotV = dot(n, v);
  float nDotL = dot(n, l);
  if (nDotV <= 0.0 || nDotL <= 0.0) return vec3(0.0);
  vec3 h = normalize(v + l);
  float nDotH = max(dot(n, h), 0.0);
  float vDotH = max(dot(v, h), 0.0);
  float r = clamp(roughness, 0.045, 1.0);
  float d = unfoldGgxD(nDotH, r);
  float g = unfoldSmithJoint(nDotV, nDotL, r);
  vec3 f0 = mix(vec3(0.04), albedo, metallic);
  vec3 f = unfoldFresnel(vDotH, f0);
  vec3 specular = (d * g / max(4.0 * nDotV * nDotL, 1e-4)) * f;
  vec3 diffuse = (albedo / 3.141592653589793) * (1.0 - f) * (1.0 - metallic);
  return diffuse + specular;
}
`;
