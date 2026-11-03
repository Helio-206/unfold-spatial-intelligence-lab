import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Studio post chain (all in linear HDR until the last pass):
 *   RenderPass (4x MSAA half-float target) -> GTAO (ambient occlusion, contact darkening in creases and under the arm)
 *   -> bloom (only the brightest speculars, kept small) -> grade (gentle S-curve, vignette, film grain too small to see as noise)
 *   -> OutputPass (tone mapping + sRGB).
 * Each effect can be switched off without rebuilding the chain; a switched-off pass costs nothing.
 */
export type PostSettings = { ao: boolean; bloom: boolean; grade: boolean };
export type StudioPost = {
  /** `still`: freeze the film-grain seed so the same state renders the same pixels (evidence, tests) */
  render(deltaS: number, still?: boolean): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  setSettings(settings: Partial<PostSettings>): void;
  /** grade and bloom values of a look; `null` restores the defaults */
  setGrade(grade: { contrast: number; vignette: number; grain: number; bloomStrength: number; bloomThreshold: number } | null): void;
  readonly settings: Readonly<PostSettings>;
  dispose(): void;
};

const GradeShader = {
  uniforms: { tDiffuse: { value: null as THREE.Texture | null }, vignette: { value: 0.32 }, contrast: { value: 1.06 }, grain: { value: 0.012 }, seed: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float vignette; uniform float contrast; uniform float grain; uniform float seed; varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233)) + seed) * 43758.5453); }
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, 1.04);                                  // a touch of saturation
      col = (col - 0.18) * contrast + 0.18;                          // pivot contrast around mid grey (linear)
      vec2 d = vUv - 0.5; float v = 1.0 - vignette * smoothstep(0.25, 0.95, length(d * vec2(1.15, 1.0)));
      col *= v;
      col += (hash(vUv * 1713.0) - 0.5) * grain * (0.35 + l);
      gl_FragColor = vec4(max(col, 0.0), c.a);
    }`,
};

export function createStudioPost(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, width: number, height: number, samples = 4): StudioPost {
  const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples });
  const composer = new EffectComposer(renderer, target);
  const settings: PostSettings = { ao: true, bloom: true, grade: true };
  const renderPass = new RenderPass(scene, camera);
  const ao = new GTAOPass(scene, camera, width, height);
  ao.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 12, distanceFallOff: 1, screenSpaceRadius: false });
  ao.blendIntensity = 0.85;
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.16, 0.55, 0.94);
  const grade = new ShaderPass(GradeShader);
  const output = new OutputPass();
  for (const pass of [renderPass, ao, bloom, grade, output]) composer.addPass(pass);
  let frame = 0;
  return {
    render(deltaS, still = false) { ao.enabled = settings.ao; bloom.enabled = settings.bloom; grade.enabled = settings.grade; frame += 1; grade.uniforms.seed!.value = still ? 0 : (frame % 97) * 0.37; composer.render(deltaS); },
    setSize(w, h, pixelRatio) { composer.setPixelRatio(pixelRatio); composer.setSize(w, h); },
    setSettings(next) { Object.assign(settings, next); },
    setGrade(g) { // ShaderPass clones the shader's uniforms: write to the pass's own
      grade.uniforms.contrast!.value = g?.contrast ?? 1.06; grade.uniforms.vignette!.value = g?.vignette ?? 0.32; grade.uniforms.grain!.value = g?.grain ?? 0.012; bloom.strength = g?.bloomStrength ?? 0.16; bloom.threshold = g?.bloomThreshold ?? 0.94; },
    get settings() { return settings; },
    dispose() { composer.dispose(); ao.dispose(); bloom.dispose(); output.dispose(); target.dispose(); },
  };
}
