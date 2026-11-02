/**
 * Studio set for the Void viewport: a PMREM softbox environment with dark reflection flags, a key spot with soft
 * shadows, a floor that fades into the background, and a blurred contact shadow rendered from below.
 *
 * The background is the Void `--surface` (#0B0D10) put through the inverse of the tone mapper, so the canvas and the
 * CSS surface are the same colour on screen.
 *
 * Techniques adapted from the Airsup machine-skill kit (MIT, © 2026 Air Supply Technologies Inc.): softbox + flag
 * environment, inverse tone-mapped background, depth-from-below contact shadow. See NOTICE.md.
 */
import {
  BackSide, CircleGeometry, Color, DoubleSide, FogExp2, Group, HemisphereLight, Mesh, MeshBasicMaterial, MeshDepthMaterial,
  MeshStandardMaterial, OrthographicCamera, PlaneGeometry, PMREMGenerator, Scene, ShaderMaterial, SphereGeometry, SpotLight,
  SRGBColorSpace, WebGLRenderTarget, type Object3D, type Texture, type WebGLRenderer,
} from 'three';
import { HorizontalBlurShader } from 'three/examples/jsm/shaders/HorizontalBlurShader.js';
import { VerticalBlurShader } from 'three/examples/jsm/shaders/VerticalBlurShader.js';

export const VOID_SURFACE = '#0B0D10';

/** Khronos PBR Neutral (three's NeutralToneMapping), per channel. */
export function neutralToneMap(c: [number, number, number]): [number, number, number] {
  const s0 = 0.8 - 0.04, d = 0.15;
  const x = Math.min(...c), off = x < 0.08 ? x - 6.25 * x * x : 0.04;
  let r = c.map((v) => v - off) as [number, number, number];
  const peak = Math.max(...r);
  if (peak < s0) return r;
  const d1 = 1 - s0, np = 1 - (d1 * d1) / (peak + d1 - s0);
  r = r.map((v) => v * (np / peak)) as [number, number, number];
  const g = 1 - 1 / (d * (peak - np) + 1);
  return r.map((v) => v * (1 - g) + np * g) as [number, number, number];
}

/** Linear colour that the tone mapper turns into `target` (linear), so a canvas background equals a CSS colour. */
export function untonemap(target: Color, exposure = 1): Color {
  const t = [target.r, target.g, target.b] as [number, number, number];
  let x = [...t] as [number, number, number];
  for (let i = 0; i < 80; i++) { const y = neutralToneMap(x.map((v) => v * exposure) as [number, number, number]); x = x.map((v, k) => Math.max(0, v + (t[k]! - y[k]!) * 0.9)) as [number, number, number]; }
  return new Color(x[0], x[1], x[2]);
}

function softboxEnvironment(renderer: WebGLRenderer): { texture: Texture; dispose(): void } {
  const s = new Scene();
  const disposables: Array<{ dispose(): void }> = [];
  const track = <T extends { dispose(): void }>(v: T) => { disposables.push(v); return v; };
  const roomGeo = track(new SphereGeometry(30, 32, 16));
  s.add(new Mesh(roomGeo, track(new MeshBasicMaterial({ color: 0x08090b, side: BackSide }))));
  const floor = new Mesh(track(new CircleGeometry(30, 32)), track(new MeshBasicMaterial({ color: 0x101114 })));
  floor.rotation.x = -Math.PI / 2; floor.position.y = -1.5; s.add(floor);
  const box = (w: number, h: number, x: number, y: number, z: number, k: number, tint: [number, number, number] = [1, 1, 1]) => {
    const m = new Mesh(track(new PlaneGeometry(w, h)), track(new MeshBasicMaterial({ color: new Color(...tint).multiplyScalar(k), side: DoubleSide })));
    m.position.set(x, y, z); m.lookAt(0, 0, 0); s.add(m);
  };
  // camera works from the front-left (+X, -Z); the key and its reflection come from that side
  box(18, 10, 0, 15, 0, 2.8);                       // overhead softbox
  box(9, 8, 11, 7, -11, 4.2, [1, 0.97, 0.93]);      // warm key softbox, front left
  box(3, 15, -13, 6, 8, 6.5, [0.92, 0.95, 1]);      // cool rim strip, back right
  box(3, 15, -12, 6, -10, 3.2);                     // second rim, back left
  box(14, 2.5, 6, 0.6, 12, 1.2);                    // low fill, front right (keeps rods and glass legible)
  box(10, 2, 13, 0.4, -2, 1.6);                     // floor bounce strip, front
  // black flags: long dark reflections keep metal shaped instead of flat
  box(5, 16, 13, 4, 5, 0.015); box(4, 16, -14, 4, -1, 0.015); box(18, 3, 0, -0.4, -15, 0.02);
  const pm = new PMREMGenerator(renderer);
  const rt = pm.fromScene(s, 0.02);
  pm.dispose();
  for (const d of disposables) d.dispose();
  return { texture: rt.texture, dispose: () => rt.dispose() };
}

export type StudioProfile = { shadowMapSize: number; contactShadowSize: number };

export class Studio {
  readonly group = new Group();
  readonly background: Color;
  private readonly env: { texture: Texture; dispose(): void };
  private readonly contact: ContactShadow;
  private readonly key: SpotLight;
  private readonly floor: Mesh;
  constructor(private readonly renderer: WebGLRenderer, readonly scene: Scene, profile: StudioProfile, exposure = 1) {
    this.group.name = 'studio';
    this.group.userData.studio = true;
    this.background = untonemap(new Color().setStyle(VOID_SURFACE, SRGBColorSpace), exposure);
    scene.background = this.background.clone();
    scene.fog = new FogExp2(this.background.clone(), 0.018);
    this.env = softboxEnvironment(renderer);
    scene.environment = this.env.texture;
    scene.environmentIntensity = 0.95;

    // floor: dark, rough, lit by the key into a pool that the fog carries into the background
    this.floor = new Mesh(new PlaneGeometry(220, 220), new MeshStandardMaterial({ color: new Color().setStyle('#16181C', SRGBColorSpace), roughness: 0.96, metalness: 0, envMapIntensity: 0.35 }));
    this.floor.rotation.x = -Math.PI / 2; this.floor.receiveShadow = true; this.floor.name = 'studio:floor'; this.floor.userData.studio = true;
    this.group.add(this.floor);

    this.key = new SpotLight(0xfff6ea, 520, 70, Math.PI / 5.2, 0.85, 1.6);
    this.key.position.set(10, 16, -9); this.key.target.position.set(2.6, 1.2, 0);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
    this.key.shadow.bias = -0.00015; this.key.shadow.normalBias = 0.025; this.key.shadow.radius = 4;
    this.key.shadow.camera.near = 6; this.key.shadow.camera.far = 40;
    this.group.add(this.key, this.key.target);
    const rim = new HemisphereLight(0xdfe6f0, 0x0b0c0e, 0.18); this.group.add(rim);
    this.group.traverse((o) => { o.userData.studio = true; });
    scene.add(this.group);
    this.contact = new ContactShadow(renderer, scene, profile.contactShadowSize, 15, 0.85);
  }

  /** Re-render the contact shadow (only when part poses change, never every frame). */
  updateContactShadow(): void { this.contact.update(); }

  dispose(): void {
    this.env.dispose();
    this.contact.dispose();
    this.floor.geometry.dispose(); (this.floor.material as MeshStandardMaterial).dispose();
    this.key.shadow.map?.dispose();
    this.group.removeFromParent();
    this.scene.environment = null; this.scene.background = null; this.scene.fog = null;
    void this.renderer;
  }
}

class ContactShadow {
  private readonly rt: WebGLRenderTarget;
  private readonly rtBlur: WebGLRenderTarget;
  private readonly cam: OrthographicCamera;
  readonly plane: Mesh;
  private readonly depth: MeshDepthMaterial;
  private readonly hb = new ShaderMaterial(HorizontalBlurShader);
  private readonly vb = new ShaderMaterial(VerticalBlurShader);
  private readonly quad: Mesh;
  constructor(private readonly renderer: WebGLRenderer, private readonly scene: Scene, size: number, width: number, opacity: number) {
    this.rt = new WebGLRenderTarget(size, size); this.rt.texture.generateMipmaps = false;
    this.rtBlur = new WebGLRenderTarget(size, size); this.rtBlur.texture.generateMipmaps = false;
    this.cam = new OrthographicCamera(-width / 2, width / 2, width / 2, -width / 2, 0, 1.6);
    this.cam.rotation.x = Math.PI / 2; this.cam.position.set(2.2, 0, 0);
    const mat = new MeshBasicMaterial({ map: this.rt.texture, transparent: true, opacity, depthWrite: false, color: 0x000000 });
    mat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', 'vec4 sampledDiffuseColor = texture2D(map, vMapUv); diffuseColor.a *= sampledDiffuseColor.a;'); };
    this.plane = new Mesh(new PlaneGeometry(width, width).rotateX(Math.PI / 2), mat);
    this.plane.position.set(2.2, 0.002, 0); this.plane.scale.y = -1; this.plane.renderOrder = 1; this.plane.name = 'studio:contact-shadow';
    this.plane.userData.studio = true;
    scene.add(this.plane, this.cam);
    this.depth = new MeshDepthMaterial();
    this.depth.onBeforeCompile = (sh) => {
      sh.uniforms.darkness = { value: 2.4 };
      sh.fragmentShader = 'uniform float darkness;\n' + sh.fragmentShader.replace('gl_FragColor = vec4( vec3( 1.0 - fragCoordZ ), opacity );', 'gl_FragColor = vec4( vec3( 0.0 ), ( 1.0 - fragCoordZ ) * darkness );');
    };
    this.depth.depthTest = false; this.depth.depthWrite = false;
    this.hb.depthTest = false; this.vb.depthTest = false;
    this.quad = new Mesh(new PlaneGeometry(width, width).rotateX(Math.PI / 2), this.hb);
    this.quad.frustumCulled = false; this.quad.position.set(2.2, 0.01, 0);
  }
  private blur(amount: number) {
    const r = this.renderer;
    this.quad.material = this.hb; this.hb.uniforms.tDiffuse!.value = this.rt.texture; this.hb.uniforms.h!.value = amount / 256;
    r.setRenderTarget(this.rtBlur); r.render(this.quad, this.cam);
    this.quad.material = this.vb; this.vb.uniforms.tDiffuse!.value = this.rtBlur.texture; this.vb.uniforms.v!.value = amount / 256;
    r.setRenderTarget(this.rt); r.render(this.quad, this.cam);
  }
  update(): void {
    const r = this.renderer, sc = this.scene;
    const bg = sc.background, fog = sc.fog, ov = sc.overrideMaterial;
    const hidden: Object3D[] = [];
    sc.traverse((o) => { if (o.userData.studio && o.visible && o !== sc) { o.visible = false; hidden.push(o); } });
    sc.background = null; sc.fog = null; sc.overrideMaterial = this.depth;
    const clearAlpha = r.getClearAlpha(); r.setClearAlpha(0);
    const prev = r.getRenderTarget();
    r.setRenderTarget(this.rt); r.clear(); r.render(sc, this.cam);
    sc.overrideMaterial = ov;
    this.blur(1.6); this.blur(0.6);
    r.setRenderTarget(prev); r.setClearAlpha(clearAlpha);
    sc.background = bg; sc.fog = fog;
    for (const o of hidden) o.visible = true;
  }
  dispose(): void {
    this.rt.dispose(); this.rtBlur.dispose(); this.depth.dispose(); this.hb.dispose(); this.vb.dispose();
    this.plane.geometry.dispose(); (this.plane.material as MeshBasicMaterial).dispose(); this.quad.geometry.dispose();
    this.plane.removeFromParent(); this.cam.removeFromParent();
  }
}
