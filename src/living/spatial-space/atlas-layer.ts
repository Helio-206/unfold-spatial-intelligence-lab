import gsap from 'gsap';
import { Box3, Color, Group, Mesh, Raycaster, Vector3, type Camera, type Material, type Vector2 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ANATOMY_COMPONENTS } from '../../anatomy/contracts';
import { HEART_COMPONENT_LABELS } from '../../anatomy/adapter';
import type { SpaceLayer } from '../workspace-design/space-port';

/**
 * Anatomy as another provider of Space: the static BodyParts3D heart atlas shown on the workspace's own stage, with the workspace's own inspector, selection,
 * camera, isolate and exploded view. It is an EDUCATIONAL REFERENCE MODEL: it is not reconstructed from any image, it is not clinical, and it carries
 * no physical scale. The attribution and licence travel with it.
 */
export const ATLAS_URL = '/anatomy/heart.glb';
export const ATLAS_SIZE = 5;
export const ATLAS_NOTICE = {
  text: 'Atlas educativo de referência · não é uma reconstrução da sua fonte · não é clínico · escala desconhecida',
  detail: 'Modelo estático BodyParts3D 4.0 (© DBCLS, CC BY 4.0), adulto masculino, malhas agrupadas e reduzidas por OrganUI; as duas paredes ventriculares formam uma só malha e as cavidades são superfícies, não músculo. A base de dados pode conter representações anatómicas em falta ou incorrectas. Sem diagnóstico, medição médica, simulação fisiológica validada nem dimensões físicas. A mesma proveniência está em public/anatomy/MODEL-ATTRIBUTION.md.',
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export type AtlasHost = { redraw(): void; changed?(): void; /** The pieces stopped moving: the host may bring them back into view. */ settled?(): void };

export class AtlasSpaceLayer implements SpaceLayer {
  readonly root = new Group();
  private readonly meshes = new Map<string, Mesh>();
  private readonly base = new Map<string, Vector3>();
  private readonly emissive = new WeakMap<Material, { color: Color; intensity: number }>();
  private readonly raycaster = new Raycaster();
  private tween: gsap.core.Tween | null = null;
  private selected: string | null = null;
  private isolated: string | null = null;
  private exploded = false;

  private constructor(private readonly host: AtlasHost) { this.root.name = 'anatomy-atlas'; }

  /** Loads and validates the model: exactly the 11 named structures, nothing else. */
  static async load(host: AtlasHost, url = ATLAS_URL): Promise<AtlasSpaceLayer> {
    const response = await fetch(url);
    if (!response.ok) throw new Error('ANATOMY_MODEL_UNAVAILABLE');
    return AtlasSpaceLayer.fromBuffer(host, await response.arrayBuffer());
  }

  static async fromBuffer(host: AtlasHost, buffer: ArrayBuffer): Promise<AtlasSpaceLayer> {
    const layer = new AtlasSpaceLayer(host);
    const gltf = await new GLTFLoader().parseAsync(buffer, '');
    const wrapper = new Group(); wrapper.add(gltf.scene);
    const names: string[] = [];
    gltf.scene.traverse((node) => {
      const mesh = node as Mesh; if (!mesh.isMesh) return;
      names.push(mesh.name); layer.meshes.set(mesh.name, mesh); mesh.castShadow = true; mesh.receiveShadow = true;
      const original = mesh.material; mesh.material = Array.isArray(original) ? original.map((m) => m.clone()) : original.clone();
    });
    const expected = new Set<string>(ANATOMY_COMPONENTS);
    if (names.length !== expected.size || names.some((n) => !expected.has(n))) { layer.dispose(); throw new Error('ANATOMY_MODEL_COMPONENTS_INVALID'); }
    wrapper.updateMatrixWorld(true);
    const box = new Box3().setFromObject(wrapper), size = box.getSize(new Vector3()), centre = box.getCenter(new Vector3()), scale = ATLAS_SIZE / Math.max(size.x, size.y, size.z, 1e-9);
    wrapper.scale.setScalar(scale); wrapper.position.set(-centre.x * scale, -box.min.y * scale, -centre.z * scale);
    layer.root.add(wrapper); layer.root.updateMatrixWorld(true);
    for (const [id, mesh] of layer.meshes) layer.base.set(id, mesh.position.clone());
    return layer;
  }

  has(id: string): boolean { return this.meshes.has(id); }
  describe(id: string) { return this.meshes.has(id) ? { kind: 'estrutura do atlas', label: HEART_COMPONENT_LABELS[id as keyof typeof HEART_COMPONENT_LABELS] ?? id } : null; }
  get isolatedId(): string | null { return this.isolated; }
  get isExploded(): boolean { return this.exploded; }
  get animating(): boolean { return this.tween !== null; }
  get structureCount(): number { return this.meshes.size; }

  box(id?: string | null): Box3 | null {
    this.root.updateMatrixWorld(true);
    const box = new Box3(); const mesh = id ? this.meshes.get(id) : null;
    if (id && !mesh) return null;
    if (mesh) box.expandByObject(mesh); else for (const m of this.meshes.values()) if (m.visible) box.expandByObject(m);
    return box.isEmpty() ? null : box;
  }
  /** Front view of the atlas: the model's front faces +Z as exported. */
  heroAzimuthDeg(): number | null { return 90; }

  pick(ndc: Vector2, camera: Camera): string | null {
    this.raycaster.setFromCamera(ndc, camera);
    const hit = this.raycaster.intersectObjects([...this.meshes.values()].filter((m) => m.visible), false)[0];
    return hit ? hit.object.name : null;
  }

  highlight(id: string | null): void { this.selected = id; this.paint(); this.host.redraw(); }
  isolate(id: string | null): void { this.isolated = id; for (const [name, mesh] of this.meshes) mesh.visible = !id || name === id; this.host.redraw(); }

  private paint(): void {
    for (const [name, mesh] of this.meshes) for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const m = material as Material & { emissive?: Color; emissiveIntensity?: number }; if (!m.emissive) continue;
      if (!this.emissive.has(m)) this.emissive.set(m, { color: m.emissive.clone(), intensity: m.emissiveIntensity ?? 1 });
      const base = this.emissive.get(m)!;
      if (name === this.selected) { m.emissive.set('#f18e64'); m.emissiveIntensity = 0.42; } else { m.emissive.copy(base.color); m.emissiveIntensity = base.intensity; }
    }
  }

  /** Generic exploded view: every structure moves away from the centre. Display only; the model is not changed. */
  setExploded(on: boolean, immediate = false): boolean {
    if (on === this.exploded) return on;
    this.tween?.kill(); this.exploded = on;
    const all = this.box(); if (!all) return on;
    const centre = all.getCenter(new Vector3()), span = all.getSize(new Vector3()).length() || 1, targets = new Map<string, Vector3>();
    for (const [id, mesh] of this.meshes) {
      if (!on) { targets.set(id, this.base.get(id)!.clone()); continue; }
      const b = new Box3().setFromObject(mesh), dir = b.getCenter(new Vector3()).sub(centre); if (dir.length() < span * 0.02) dir.set(0, 1, 0);
      const parent = mesh.parent!, from = mesh.getWorldPosition(new Vector3());
      targets.set(id, parent.worldToLocal(from.add(dir.normalize().multiplyScalar(span * 0.3))));
    }
    const from = new Map([...this.meshes].map(([id, m]) => [id, m.position.clone()])), state = { k: 0 };
    const apply = (k: number) => { for (const [id, m] of this.meshes) m.position.lerpVectors(from.get(id)!, targets.get(id)!, k); this.host.redraw(); };
    if (immediate) apply(1); else this.tween = gsap.to(state, { k: 1, duration: 0.8, ease: 'power2.inOut', onUpdate: () => apply(state.k), onComplete: () => { this.tween = null; apply(1); this.host.settled?.(); } });
    this.host.changed?.();
    return on;
  }
  get presentationNotice(): string | null { return this.exploded ? 'Vista explodida · afastamento só visual; não é anatomia em movimento.' : null; }

  renderInspector(host: HTMLElement, id: string, evidenceOpen: boolean): void {
    const label = HEART_COMPONENT_LABELS[id as keyof typeof HEART_COMPONENT_LABELS] ?? id;
    host.innerHTML = `<div class="uw-chips"><span class="u-chip u-chip--uncertain">atlas educativo</span><span class="u-chip u-chip--uncertain">escala desconhecida</span></div>
      <dl class="u-readout"><div><dt>Estrutura</dt><dd>${esc(label)}</dd></div><div><dt>Origem</dt><dd>BodyParts3D 4.0</dd></div><div><dt>Licença</dt><dd>CC BY 4.0</dd></div></dl>
      <p class="u-label sp-hint">Modelo de referência: não vem da sua fonte, não é clínico e não pode ser editado aqui.</p>
      ${evidenceOpen ? `<ul class="uw-evidence" aria-label="Evidência"><li>${esc(ATLAS_NOTICE.detail)}</li></ul>` : ''}`;
  }

  dispose(): void {
    this.tween?.kill();
    this.root.traverse((o) => { const m = o as Mesh; if (!m.isMesh) return; m.geometry.dispose(); for (const mat of Array.isArray(m.material) ? m.material : [m.material]) mat.dispose(); });
    this.root.clear(); this.meshes.clear();
  }
}
