import * as THREE from 'three';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';

/**
 * Soft contact shadow under the machine: the receivers' depth seen from below the floor, blurred twice, drawn as a dark multiply-like decal on the floor.
 * It adds the grounding that a shadow-mapped key light cannot (the tight, dark, soft contact right where parts meet the floor) and costs one small render
 * of the machine layer plus two blur passes, only when the pose changed (`markDirty()`).
 *
 * Only objects on `CONTACT_LAYER` are drawn into it. The machine's meshes enable that layer; the floor, the backdrop and the mirrored copy do not.
 */
export const CONTACT_LAYER = 3;

export type ContactShadow = {
  readonly object: THREE.Group;
  /** footprint of the decal and the height range that still darkens the floor */
  fit(bounds: THREE.Box3): void;
  markDirty(): void;
  update(renderer: THREE.WebGLRenderer, scene: THREE.Scene): boolean;
  setEnabled(enabled: boolean): void;
  readonly renders: number;
  dispose(): void;
};

export function createContactShadow(resolution = 512): ContactShadow {
  const rt = new THREE.WebGLRenderTarget(resolution, resolution); rt.texture.generateMipmaps = false;
  const blurRt = new THREE.WebGLRenderTarget(resolution, resolution); blurRt.texture.generateMipmaps = false;
  const plane = new THREE.PlaneGeometry(1, 1).rotateX(Math.PI / 2); // faces up; scale.y = -1 below flips it so its UVs match the depth camera under the floor
  const material = new THREE.MeshBasicMaterial({ map: rt.texture, transparent: true, opacity: 0.95, depthWrite: false });
  const decal = new THREE.Mesh(plane, material); decal.name = 'contact-shadow'; decal.renderOrder = 1; decal.scale.y = -1;
  const group = new THREE.Group(); group.name = 'contact-shadow-rig'; group.add(decal);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1); camera.rotation.x = Math.PI / 2; camera.layers.set(CONTACT_LAYER); group.add(camera); // looks UP from the floor plane
  const blurPlane = new THREE.Mesh(plane); blurPlane.visible = false; blurPlane.layers.set(CONTACT_LAYER); group.add(blurPlane);
  const depthMaterial = new THREE.MeshDepthMaterial(); const darkness = { value: 1.7 };
  depthMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.darkness = darkness;
    shader.fragmentShader = `uniform float darkness;\n${shader.fragmentShader.replace('gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );', 'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );')}`;
  };
  depthMaterial.depthTest = false; depthMaterial.depthWrite = false;
  const hBlur = new THREE.ShaderMaterial(HorizontalBlurShader); hBlur.depthTest = false;
  const vBlur = new THREE.ShaderMaterial(VerticalBlurShader); vBlur.depthTest = false;
  let dirty = true; let enabled = true; let renders = 0; const blurAmount = 3.4;

  function blurPass(renderer: THREE.WebGLRenderer, amount: number) {
    blurPlane.visible = true;
    blurPlane.material = hBlur; hBlur.uniforms.tDiffuse!.value = rt.texture; hBlur.uniforms.h!.value = amount / resolution * 1.0;
    renderer.setRenderTarget(blurRt); renderer.render(blurPlane, camera);
    blurPlane.material = vBlur; vBlur.uniforms.tDiffuse!.value = blurRt.texture; vBlur.uniforms.v!.value = amount / resolution * 1.0;
    renderer.setRenderTarget(rt); renderer.render(blurPlane, camera);
    blurPlane.visible = false;
  }

  return {
    object: group,
    fit(bounds) {
      const size = bounds.getSize(new THREE.Vector3()); const center = bounds.getCenter(new THREE.Vector3());
      const span = Math.max(size.x, size.z) * 1.35 + 1.5;
      group.position.set(center.x, 0.003, center.z); decal.scale.set(span, -1, span); blurPlane.scale.set(span, 1, span);
      camera.left = -span / 2; camera.right = span / 2; camera.top = span / 2; camera.bottom = -span / 2;
      camera.near = 0; camera.far = Math.max(1, size.y * 1.25); camera.updateProjectionMatrix(); dirty = true;
    },
    markDirty() { dirty = true; },
    setEnabled(next) { enabled = next; group.visible = next; if (next) dirty = true; },
    update(renderer, scene) {
      if (!enabled || !dirty) return false;
      dirty = false; renders += 1;
      const prevTarget = renderer.getRenderTarget(); const prevAlpha = renderer.getClearAlpha(); const prevBackground = scene.background; const prevFog = scene.fog; const prevOverride = scene.overrideMaterial;
      scene.updateMatrixWorld(true);
      scene.background = null; scene.fog = null; scene.overrideMaterial = depthMaterial; decal.visible = false;
      renderer.setClearAlpha(0); renderer.setRenderTarget(rt); renderer.clear(); renderer.render(scene, camera);
      scene.overrideMaterial = prevOverride;
      blurPass(renderer, blurAmount); blurPass(renderer, blurAmount * 0.4);
      renderer.setRenderTarget(prevTarget); renderer.setClearAlpha(prevAlpha); scene.background = prevBackground; scene.fog = prevFog; decal.visible = true;
      return true;
    },
    get renders() { return renders; },
    dispose() { rt.dispose(); blurRt.dispose(); plane.dispose(); material.dispose(); depthMaterial.dispose(); hBlur.dispose(); vBlur.dispose(); },
  };
}
