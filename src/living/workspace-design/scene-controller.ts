/**
 * Display state of the scene: highlight, isolation, exploded view, picking. None of it touches engineering data:
 * part poses come from a pose source and are re-applied unchanged; the exploded view is a labelled display offset.
 */
import gsap from 'gsap';
import {
  AdditiveBlending, Color, LessEqualDepth, Mesh, MeshBasicMaterial, Raycaster, ShaderMaterial, SRGBColorSpace, Vector2, Vector3,
  type Camera, type Material, type Object3D,
} from 'three';
import { DURATION, EASE } from '../../motion/tokens';
import type { ComponentRegistry, CanonicalComponent } from '../visual-foundry/component-registry';
import type { ExcavatorModel, PartPose } from '../visual-foundry/excavator/build';
import { partIdOf } from './digital-hand';

/** Display-only offsets for the exploded view (metres, world). Not an engineering result. */
const EXPLODE: Record<string, [number, number, number]> = {
  upper_body: [0, 0.8, 0], boom: [0.7, 1.1, 0], stick: [1.5, 1.25, 0], bucket: [2.2, 1.1, 0], idler_link: [2.0, 1.2, 0.9], bucket_link: [2.2, 1.2, -0.9],
  boom_cyl_barrel: [0.5, 0.8, 1.2], boom_cyl_rod: [0.8, 0.8, 1.2], stick_cyl_barrel: [0.9, 1.6, 1.2], stick_cyl_rod: [1.2, 1.6, 1.2],
  bucket_cyl_barrel: [1.6, 1.1, 1.3], bucket_cyl_rod: [1.9, 1.1, 1.3],
};

function rimMaterial(colorHex: string): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { uColor: { value: new Color().setStyle(colorHex, SRGBColorSpace) }, uOpacity: { value: 1 } },
    vertexShader: `varying vec3 vN; varying vec3 vV;
      void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; varying vec3 vN; varying vec3 vV;
      void main(){ float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4); gl_FragColor = vec4(uColor, (0.07 + 0.8 * rim) * uOpacity); }`,
    transparent: true, depthWrite: false, depthFunc: LessEqualDepth, blending: AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
}

export class SceneController {
  private highlightMeshes: Mesh[] = [];
  private readonly rim: ShaderMaterial;
  private readonly ghost: MeshBasicMaterial;
  private readonly ghosted = new Map<Mesh, Material | Material[]>();
  private poses: PartPose[] = [];
  private explodeK = 0;
  private explodeTween: gsap.core.Tween | null = null;
  private readonly raycaster = new Raycaster();
  selectedId: string | null = null;
  isolatedId: string | null = null;
  reducedMotion = false;

  constructor(readonly model: ExcavatorModel, readonly registry: ComponentRegistry, private readonly requestRender: () => void, private readonly afterPoseChange: () => void, accentHex: string, ghostHex: string) {
    this.rim = rimMaterial(accentHex);
    this.ghost = new MeshBasicMaterial({ color: new Color().setStyle(ghostHex, SRGBColorSpace), transparent: true, opacity: 0.1, depthWrite: false });
  }

  /** Canonical meshes (for picking and occlusion); display-only meshes excluded. */
  canonicalMeshes(): Object3D[] {
    const out: Object3D[] = [];
    this.model.root.traverse((o) => { const m = o as Mesh; if (m.isMesh && !m.userData.highlightOverlay && m.material !== this.ghost && partIdOf(o) && o.visible) out.push(o); });
    return out;
  }

  setPoses(poses: PartPose[]): void { this.poses = poses; this.applyDisplay(); }

  private applyDisplay(): void {
    const k = this.explodeK;
    const shifted = this.poses.map((p) => { const o = EXPLODE[p.partId] ?? [0, 0, 0]; return { ...p, translationM: [p.translationM[0] + o[0] * k, p.translationM[1] + o[1] * k, p.translationM[2] + o[2] * k] as [number, number, number] }; });
    this.model.applyPoses(shifted);
    this.afterPoseChange();
    this.requestRender();
  }

  get exploded(): boolean { return this.explodeK > 0.5; }

  setExploded(on: boolean): void {
    this.explodeTween?.kill();
    const to = on ? 1 : 0;
    if (this.reducedMotion) { this.explodeK = to; this.applyDisplay(); return; }
    const s = { k: this.explodeK };
    this.explodeTween = gsap.to(s, { k: to, duration: DURATION.slow, ease: EASE.inOut, onUpdate: () => { this.explodeK = s.k; this.applyDisplay(); }, onComplete: () => { this.explodeTween = null; } });
  }

  highlight(component: CanonicalComponent | null, opacity = 1): void {
    for (const m of this.highlightMeshes) m.removeFromParent();
    this.highlightMeshes = [];
    this.rim.uniforms.uOpacity!.value = opacity;
    if (component) {
      for (const pid of component.partIds) {
        this.model.parts.get(pid)?.traverse((o) => {
          const mesh = o as Mesh;
          if (!mesh.isMesh || mesh.userData.highlightOverlay || mesh.userData.materialKey === 'glass') return;
          const overlay = new Mesh(mesh.geometry, this.rim); overlay.userData.highlightOverlay = true; overlay.renderOrder = 3; overlay.raycast = () => {};
          mesh.add(overlay); this.highlightMeshes.push(overlay);
        });
      }
    }
    this.requestRender();
  }

  setHighlightOpacity(opacity: number): void { this.rim.uniforms.uOpacity!.value = opacity; this.requestRender(); }

  /** Show only one component's parts solid; everything else becomes a faint ghost (display only). */
  /** `keepMesh` keeps extra meshes solid (e.g. a parent part's pins and bosses). Material swap only: geometry and poses untouched. */
  isolate(component: CanonicalComponent | null, keepMesh?: (mesh: Mesh) => boolean): void {
    for (const [mesh, mat] of this.ghosted) mesh.material = mat;
    this.ghosted.clear();
    this.isolatedId = component?.id ?? null;
    if (component) {
      const keep = new Set(component.partIds);
      this.model.root.traverse((o) => {
        const mesh = o as Mesh;
        if (!mesh.isMesh || mesh.userData.highlightOverlay) return;
        const pid = partIdOf(mesh);
        if (pid && keep.has(pid)) return;
        if (keepMesh?.(mesh)) return;
        this.ghosted.set(mesh, mesh.material); mesh.material = this.ghost;
      });
    }
    this.requestRender();
  }

  /** Pointer pick → the canonical component that owns the hit part (actuator for barrels and rods). */
  pick(ndc: Vector2, camera: Camera): CanonicalComponent | null {
    this.raycaster.setFromCamera(ndc, camera);
    for (const hit of this.raycaster.intersectObjects(this.canonicalMeshes(), false)) {
      if ((hit.object as Mesh).material === this.ghost) continue;
      const pid = partIdOf(hit.object);
      if (pid) return this.registry.ownerOfPart(pid) ?? null;
    }
    return null;
  }

  worldOf(partId: string): Vector3 { const g = this.model.parts.get(partId); return g ? new Vector3().setFromMatrixPosition(g.matrixWorld) : new Vector3(); }

  dispose(): void {
    this.explodeTween?.kill();
    this.highlight(null); this.isolate(null);
    this.rim.dispose(); this.ghost.dispose();
  }
}
