import { Box3, BoxGeometry, CylinderGeometry, ExtrudeGeometry, Group, HemisphereLight, Mesh, MeshStandardMaterial, Path, PointLight, Quaternion, Scene, Shape, SphereGeometry, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { PHASE4A_EVIDENCE_STATUS, PHASE4A_LENGTHS, maxResidual, scenePoint } from './phase4a-kinematics';
import { solveFourBar, type AssemblyBranch, type BarName, type FourBarLengths, type FourBarResult, type Point } from './kinematics';

const SCALE = 0.045;
const BAR_COLORS: Record<BarName, string> = {
  ground: '#8d8c86',
  crank: '#e9a525',
  coupler: '#9a6538',
  rocker: '#d64b16',
};

const BAR_MATERIALS: Record<BarName, { metalness: number; roughness: number }> = {
  ground: { metalness: 0.46, roughness: 0.58 },
  crank: { metalness: 0.72, roughness: 0.33 },
  coupler: { metalness: 0.58, roughness: 0.38 },
  rocker: { metalness: 0.42, roughness: 0.5 },
};

const JOINT_MATERIAL = { metalness: 0.78, roughness: 0.24 };
const FIXED_SUPPORT_COLOR = '#5f5a50';

export type FourBarVisualTheme = 'default' | 'industrial';

type VisualPalette = {
  barColors: Record<BarName, string>;
  barMaterials: Record<BarName, { metalness: number; roughness: number }>;
  jointColor: string;
  fixedSupportColor: string;
  selectedColor: string;
  selectedEmissive: string;
  hoverColor: string;
  hoverEmissive: string;
  roundedBars: boolean;
  jointGeometry: 'sphere' | 'collar';
};

const INDUSTRIAL_PALETTE: VisualPalette = {
  barColors: {
    ground: '#666b66',
    crank: '#bd744b',
    coupler: '#a6a496',
    rocker: '#737b70',
  },
  barMaterials: {
    ground: { metalness: 0.38, roughness: 0.48 },
    crank: { metalness: 0.48, roughness: 0.34 },
    coupler: { metalness: 0.4, roughness: 0.4 },
    rocker: { metalness: 0.4, roughness: 0.44 },
  },
  jointColor: '#cbc1ac',
  fixedSupportColor: '#5f5a50',
  selectedColor: '#ffd48b',
  selectedEmissive: '#ffb42e',
  hoverColor: '#f0b862',
  hoverEmissive: '#8b5d20',
  roundedBars: true,
  jointGeometry: 'collar',
};

const DEFAULT_PALETTE: VisualPalette = {
  barColors: BAR_COLORS,
  barMaterials: BAR_MATERIALS,
  jointColor: '#d4ddd7',
  fixedSupportColor: FIXED_SUPPORT_COLOR,
  selectedColor: '#f0c67e',
  selectedEmissive: '#b97835',
  hoverColor: '#d8b477',
  hoverEmissive: '#76532d',
  roundedBars: false,
  jointGeometry: 'sphere',
};

export const FOUR_BAR_LAB_MODE = 'Four-Bar Lab' as const;
export const FOUR_BAR_LAB_EVIDENCE = PHASE4A_EVIDENCE_STATUS;

export type FourBarVisualState = 'assembled' | 'inspection';
export type CrankAssetStatus = 'unavailable' | 'loading' | 'ready' | 'fallback';

export function crankAssetTransform(start: Vector3, end: Vector3): { position: Vector3; rotationY: number; scaleX: number } {
  return {
    position: start.clone(),
    rotationY: Math.atan2(end.z - start.z, end.x - start.x) * -1,
    scaleX: start.distanceTo(end),
  };
}

const EXPLOSION_VECTORS: Record<BarName, Vector3> = {
  ground: new Vector3(-0.95, 0.08, 0.72),
  crank: new Vector3(-0.32, 0.64, -0.82),
  coupler: new Vector3(0.08, 0.9, 0.58),
  rocker: new Vector3(0.94, 0.42, -0.22),
};

const VISUAL_EASE = (value: number): number => 1 - Math.pow(1 - Math.min(Math.max(value, 0), 1), 4);

function disposeGroupResources(group: Group): void {
  for (const child of [...group.children]) {
    child.traverse((object) => {
      const mesh = object as Mesh;
      if (mesh.geometry) mesh.geometry.dispose();
      const materials = Array.isArray(mesh.material) ? mesh.material : mesh.material ? [mesh.material] : [];
      materials.forEach((entry) => entry.dispose());
    });
  }
  group.clear();
}

function point3(point: Point): Vector3 {
  const mapped = scenePoint(point, SCALE);
  return new Vector3(mapped.x, 0.18, mapped.z);
}

function makeMaterial(color: string, profile: { metalness: number; roughness: number }): MeshStandardMaterial {
  return new MeshStandardMaterial({
    color,
    roughness: profile.roughness,
    metalness: profile.metalness,
    emissive: '#000000',
    emissiveIntensity: 0,
  });
}

function makeBar(start: Vector3, end: Vector3, role: BarName, palette: VisualPalette): Mesh {
  const length = start.distanceTo(end);
  const width = 0.34;
  const thickness = 0.13;
  const endRadius = width / 2;
  const pivotBoreRadius = 0.078;
  let geometry: BoxGeometry | RoundedBoxGeometry | ExtrudeGeometry;
  if (palette.roundedBars) {
    const profile = new Shape();
    profile.moveTo(-length / 2, -width / 2);
    profile.lineTo(length / 2, -width / 2);
    profile.absarc(length / 2, 0, endRadius, -Math.PI / 2, Math.PI / 2, false);
    profile.lineTo(-length / 2, width / 2);
    profile.absarc(-length / 2, 0, endRadius, Math.PI / 2, Math.PI * 1.5, false);
    for (const center of [-length / 2, length / 2]) {
      const bore = new Path();
      bore.absarc(center, 0, pivotBoreRadius, 0, Math.PI * 2, true);
      profile.holes.push(bore);
    }
    geometry = new ExtrudeGeometry(profile, { depth: thickness, bevelEnabled: true, bevelSegments: 2, bevelSize: 0.012, bevelThickness: 0.012, curveSegments: 24 });
    geometry.userData.mechanicalProfile = 'rounded-link-with-pivot-bores';
    geometry.userData.pivotSpacing = length;
    geometry.userData.pivotBoreRadius = pivotBoreRadius;
  } else {
    geometry = new BoxGeometry(length, 0.14, 0.21);
  }
  const mesh = new Mesh(geometry, makeMaterial(palette.barColors[role], palette.barMaterials[role]));
  mesh.position.copy(start).add(end).multiplyScalar(0.5);
  if (palette.roundedBars) {
    const roll = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI / 2);
    const yaw = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.atan2(end.z - start.z, end.x - start.x) * -1);
    mesh.quaternion.copy(yaw).multiply(roll);
    mesh.position.y += thickness / 2;
  } else {
    mesh.rotation.y = Math.atan2(end.z - start.z, end.x - start.x) * -1;
  }
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.labRole = role;
  mesh.userData.baseColor = palette.barColors[role];
  return mesh;
}

function makeJoint(position: Vector3, color: string, palette: VisualPalette, fixed = false): Mesh | Group {
  const mount = new Group();
  mount.position.copy(position).setY(0.27);
  mount.userData.labJoint = true;
  mount.userData.fixedSupport = fixed;
  if (palette.jointGeometry === 'collar') {
    const layers = [
      { radius: 0.19, height: 0.1, y: 0, color: fixed ? palette.fixedSupportColor : '#88877f', material: JOINT_MATERIAL },
      { radius: 0.135, height: 0.055, y: 0.065, color, material: { metalness: 0.82, roughness: 0.26 } },
      { radius: 0.082, height: 0.045, y: 0.112, color: '#303433', material: { metalness: 0.84, roughness: 0.24 } },
      { radius: 0.036, height: 0.05, y: 0.155, color: '#c9a170', material: { metalness: 0.78, roughness: 0.29 } },
    ];
    for (const layer of layers) {
      const part = new Mesh(new CylinderGeometry(layer.radius, layer.radius, layer.height, 32), makeMaterial(layer.color, layer.material));
      part.position.y = layer.y;
      part.castShadow = true;
      part.receiveShadow = true;
      part.userData.labJointDetail = true;
      mount.add(part);
    }
  } else {
    const joint = new Mesh(new SphereGeometry(0.16, 20, 14), makeMaterial(fixed ? palette.fixedSupportColor : color, JOINT_MATERIAL));
    joint.castShadow = true;
    joint.receiveShadow = true;
    mount.add(joint);
  }
  return mount;
}

export class FourBarLabScene {
  readonly root = new Group();
  private readonly fixedGroup = new Group();
  private readonly dynamicGroup = new Group();
  private readonly selectable = new Map<BarName, Mesh>();
  private lengths: FourBarLengths = { ...PHASE4A_LENGTHS };
  private angleDegrees = 0;
  private branch: AssemblyBranch = 'plus';
  private selectedRole: BarName | undefined;
  private hoveredRole: BarName | undefined;
  private result: FourBarResult;
  private crankAssetTemplate: Group | undefined;
  private crankAssetMeshes: Mesh[] = [];
  private crankAssetState: CrankAssetStatus = 'unavailable';
  private disposed = false;
  private explosionProgress = 0;
  private visualState: FourBarVisualState = 'assembled';
  private visualTransition: { from: number; to: number; started: number; duration: number } | undefined;
  private readonly inspectionOffsets = new Map<BarName, Vector3>();
  private readonly theme: FourBarVisualTheme;
  private readonly palette: VisualPalette;

  constructor(options: { theme?: FourBarVisualTheme; lengths?: FourBarLengths; angleDegrees?: number } = {}) {
    this.theme = options.theme ?? 'default';
    this.palette = this.theme === 'industrial' ? INDUSTRIAL_PALETTE : DEFAULT_PALETTE;
    this.lengths = options.lengths ? { ...options.lengths } : { ...PHASE4A_LENGTHS };
    this.angleDegrees = options.angleDegrees ?? 0;
    this.root.name = 'four-bar-lab';
    this.fixedGroup.name = 'four-bar-lab-fixed';
    this.dynamicGroup.name = 'four-bar-lab-dynamic';
    this.root.add(this.fixedGroup, this.dynamicGroup);
    this.addLighting();
    this.result = solveFourBar({ lengths: { ...this.lengths }, inputAngleRad: 0, branch: this.branch });
    this.createFixedGeometry();
    this.renderResult();
    if (typeof window !== 'undefined') this.loadCrankAsset();
  }

  get evidenceStatus(): typeof FOUR_BAR_LAB_EVIDENCE {
    return FOUR_BAR_LAB_EVIDENCE;
  }

  get currentResult(): FourBarResult {
    return this.result;
  }

  get currentLengths(): FourBarLengths {
    return { ...this.lengths };
  }

  get currentAngleDegrees(): number {
    return this.angleDegrees;
  }

  get currentBranch(): AssemblyBranch {
    return this.branch;
  }

  get currentVisualState(): FourBarVisualState {
    return this.visualState;
  }

  get isVisualTransitioning(): boolean {
    return this.visualTransition !== undefined;
  }

  get crankAssetStatus(): CrankAssetStatus {
    return this.crankAssetState;
  }

  setLengths(lengths: FourBarLengths): FourBarResult {
    this.lengths = { ...lengths };
    this.solveAndRender();
    return this.result;
  }

  get selected(): BarName | undefined {
    return this.selectedRole;
  }

  mount(scene: Scene): void {
    if (!this.root.parent) scene.add(this.root);
    this.root.visible = true;
  }

  setAngle(angleDegrees: number): FourBarResult {
    this.angleDegrees = Math.min(Math.max(angleDegrees, 0), 360);
    this.solveAndRender();
    return this.result;
  }

  setBranch(branch: AssemblyBranch): FourBarResult {
    this.branch = branch;
    this.solveAndRender();
    return this.result;
  }

  setExploded(exploded: boolean, reducedMotion = false, now = performance.now()): void {
    this.update(now);
    if (!exploded) this.inspectionOffsets.clear();
    const target = exploded ? 1 : 0;
    this.visualState = exploded || this.explosionProgress > 0 ? 'inspection' : 'assembled';
    if (reducedMotion || Math.abs(this.explosionProgress - target) < 0.0001) {
      this.visualTransition = undefined;
      this.explosionProgress = target;
      this.visualState = target > 0 ? 'inspection' : 'assembled';
      this.applyExplosionProgress();
      return;
    }
    this.visualTransition = { from: this.explosionProgress, to: target, started: now, duration: 850 };
  }

  update(now = performance.now()): void {
    if (!this.visualTransition) return;
    const progress = Math.min((now - this.visualTransition.started) / this.visualTransition.duration, 1);
    const eased = VISUAL_EASE(progress);
    this.explosionProgress = this.visualTransition.from + (this.visualTransition.to - this.visualTransition.from) * eased;
    this.applyExplosionProgress();
    if (progress >= 1) {
      const target = this.visualTransition.to;
      this.visualTransition = undefined;
      this.explosionProgress = target;
      this.visualState = target > 0 ? 'inspection' : 'assembled';
      this.applyExplosionProgress();
    }
  }

  boundsForVisualState(exploded: boolean): Box3 {
    const currentProgress = this.explosionProgress;
    this.explosionProgress = exploded ? 1 : 0;
    this.applyExplosionProgress();
    const bounds = this.bounds();
    this.explosionProgress = currentProgress;
    this.applyExplosionProgress();
    return bounds;
  }

  select(role: BarName | undefined): void {
    this.selectedRole = role;
    this.refreshSelectionMaterials();
  }

  hover(role: BarName | undefined): void {
    this.hoveredRole = role;
    this.refreshSelectionMaterials();
  }

  private refreshSelectionMaterials(): void {
    for (const [candidate, mesh] of this.selectable) {
      const material = mesh.material as MeshStandardMaterial;
      const isSelected = candidate === this.selectedRole;
      const isHovered = candidate === this.hoveredRole;
      const baseColor = mesh.userData.baseColor as string;
      material.color.set(isSelected ? this.palette.selectedColor : isHovered ? this.palette.hoverColor : baseColor);
      if (this.theme === 'industrial' && this.selectedRole && !isSelected && !isHovered) material.color.multiplyScalar(0.62);
      material.emissive.set(isSelected ? this.palette.selectedEmissive : isHovered ? this.palette.hoverEmissive : '#000000');
      material.emissiveIntensity = isSelected ? 0.42 : isHovered ? 0.16 : 0;
    }
    for (const mesh of this.crankAssetMeshes) {
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const entry of materials) {
        const material = entry as MeshStandardMaterial;
        if (!material.color) continue;
        const isSelected = this.selectedRole === 'crank';
        const isHovered = this.hoveredRole === 'crank';
        const baseColor = mesh.userData.assetBaseColor as string | undefined;
        material.color.set(isSelected ? this.palette.selectedColor : isHovered ? this.palette.hoverColor : baseColor ? `#${baseColor}` : this.palette.barColors.crank);
        if (this.theme === 'industrial' && this.selectedRole && !isSelected && !isHovered) material.color.multiplyScalar(0.62);
        if (material.emissive) material.emissive.set(isSelected ? this.palette.selectedEmissive : isHovered ? this.palette.hoverEmissive : '#000000');
        material.emissiveIntensity = isSelected ? 0.42 : isHovered ? 0.16 : 0;
      }
    }
  }

  selectableMeshes(): Mesh[] {
    return [...this.selectable.values()];
  }

  setInspectionOffset(role: BarName, offset: Vector3): void {
    if (this.visualState !== 'inspection') return;
    this.inspectionOffsets.set(role, offset.clone().clampLength(0, 1.6));
    this.applyExplosionProgress();
  }

  inspectionOffset(role: BarName): Vector3 {
    return this.inspectionOffsets.get(role)?.clone() ?? new Vector3();
  }

  clearInspectionOffsets(): void {
    this.inspectionOffsets.clear();
    this.applyExplosionProgress();
  }

  bounds(): Box3 {
    return new Box3().setFromObject(this.root);
  }

  boundsFor(role: BarName): Box3 {
    const mesh = this.selectable.get(role);
    return mesh ? new Box3().setFromObject(mesh) : this.bounds();
  }

  dispose(): void {
    this.disposed = true;
    this.visualTransition = undefined;
    this.inspectionOffsets.clear();
    disposeGroupResources(this.root);
    if (this.crankAssetTemplate) disposeGroupResources(this.crankAssetTemplate);
    this.crankAssetTemplate = undefined;
    this.crankAssetMeshes = [];
    this.selectable.clear();
    this.root.removeFromParent();
  }

  private explosionDistance(): number {
    return Math.max(this.lengths.ground, this.lengths.crank, this.lengths.coupler, this.lengths.rocker) * SCALE * 0.18;
  }

  private tagExplodable<T extends Group | Mesh>(object: T, role: BarName): T {
    object.userData.explodeRole = role;
    object.userData.assembledPosition = object.position.clone();
    return object;
  }

  private applyExplosionProgress(): void {
    const distance = this.explosionDistance();
    this.root.traverse((object) => {
      const mesh = object as Mesh;
      const role = mesh.userData.explodeRole as BarName | undefined;
      const assembledPosition = mesh.userData.assembledPosition as Vector3 | undefined;
      if (!role || !assembledPosition || !mesh.position) return;
      mesh.position.copy(assembledPosition)
        .addScaledVector(EXPLOSION_VECTORS[role], distance * this.explosionProgress)
        .add(this.inspectionOffsets.get(role) ?? new Vector3());
    });
  }

  private createFixedGeometry(): void {
    const pivotA = point3({ x: 0, y: 0 });
    const pivotB = point3({ x: this.lengths.ground, y: 0 });
    const ground = this.tagExplodable(makeBar(pivotA, pivotB, 'ground', this.palette), 'ground');
    ground.userData.assembledPosition = ground.position.clone();
    const fixedPivotA = this.tagExplodable(makeJoint(pivotA, this.palette.barColors.ground, this.palette, true), 'ground');
    const fixedPivotB = this.tagExplodable(makeJoint(pivotB, this.palette.barColors.ground, this.palette, true), 'ground');
    this.fixedGroup.add(ground, fixedPivotA, fixedPivotB);
    this.selectable.set('ground', ground);
    this.applyExplosionProgress();
  }

  private solveAndRender(): void {
    this.result = solveFourBar({ lengths: { ...this.lengths }, inputAngleRad: this.angleDegrees * Math.PI / 180, branch: this.branch });
    this.renderResult();
  }

  private renderResult(): void {
    disposeGroupResources(this.dynamicGroup);
    this.crankAssetMeshes = [];
    this.selectable.delete('crank');
    this.selectable.delete('coupler');
    this.selectable.delete('rocker');
    if (!this.result.coordinates) {
      this.select(this.selectedRole);
      return;
    }
    const { fixedPivotA, fixedPivotB, crankCouplerJoint, couplerRockerJoint } = this.result.coordinates;
    const a = point3(fixedPivotA);
    const b = point3(fixedPivotB);
    const c = point3(crankCouplerJoint);
    const d = point3(couplerRockerJoint);
    const crankProxy = this.tagExplodable(makeBar(a, c, 'crank', this.palette), 'crank');
    const coupler = this.tagExplodable(makeBar(c, d, 'coupler', this.palette), 'coupler');
    const rocker = this.tagExplodable(makeBar(d, b, 'rocker', this.palette), 'rocker');
    const crankJoint = this.tagExplodable(makeJoint(c, this.palette.barColors.crank, this.palette), 'crank');
    const rockerJoint = this.tagExplodable(makeJoint(d, this.palette.barColors.coupler, this.palette), 'rocker');
    if (this.crankAssetTemplate) {
      const crankAsset = this.tagExplodable(this.createCrankAsset(a, c), 'crank');
      const proxyMaterial = crankProxy.material as MeshStandardMaterial;
      proxyMaterial.transparent = true;
      proxyMaterial.opacity = 0;
      proxyMaterial.depthWrite = false;
      crankProxy.castShadow = false;
      crankProxy.receiveShadow = false;
      crankProxy.userData.assetProxy = true;
      this.dynamicGroup.add(crankAsset, crankProxy);
    } else {
      this.dynamicGroup.add(crankProxy);
    }
    this.dynamicGroup.add(coupler, rocker, crankJoint, rockerJoint);
    this.selectable.set('crank', crankProxy);
    this.selectable.set('coupler', coupler);
    this.selectable.set('rocker', rocker);
    this.select(this.selectedRole);
    this.applyExplosionProgress();
  }

  private loadCrankAsset(): void {
    this.crankAssetState = 'loading';
    new GLTFLoader().load(
      '/assets/crank.glb',
      (gltf) => {
        if (this.disposed) {
          disposeGroupResources(gltf.scene);
          return;
        }
        this.crankAssetTemplate = gltf.scene;
        this.crankAssetTemplate.name = 'crank-glb-template';
        this.crankAssetState = 'ready';
        this.renderResult();
      },
      undefined,
      () => {
        if (!this.disposed) this.crankAssetState = 'fallback';
      },
    );
  }

  private createCrankAsset(start: Vector3, end: Vector3): Group {
    const instance = this.crankAssetTemplate!.clone(true);
    const transform = crankAssetTransform(start, end);
    instance.name = 'crank-glb';
    instance.position.copy(transform.position);
    instance.rotation.y = transform.rotationY;
    instance.scale.set(transform.scaleX, 1, 1);
    instance.traverse((object) => {
      const mesh = object as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry = mesh.geometry.clone();
      const clonedMaterials = Array.isArray(mesh.material)
        ? mesh.material.map((entry) => entry.clone())
        : mesh.material
          ? mesh.material.clone()
          : [];
      mesh.material = clonedMaterials;
      const materialEntries = Array.isArray(clonedMaterials) ? clonedMaterials : clonedMaterials ? [clonedMaterials] : [];
      const firstMaterial = materialEntries[0] as MeshStandardMaterial | undefined;
      mesh.userData.assetBaseColor = firstMaterial?.color?.getHexString();
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.crankAssetMeshes.push(mesh);
    });
    return instance;
  }

  private addLighting(): void {
    const hemisphere = new HemisphereLight('#c8dce0', '#071014', 0.42);
    hemisphere.name = 'four-bar-lab-hemisphere';
    const key = new PointLight('#f4cf9d', 0.85, 10, 2);
    key.name = 'four-bar-lab-key-light';
    key.position.set(1.2, 3.8, 2.8);
    this.root.add(hemisphere, key);
  }
}

export function fourBarLabResidual(result: FourBarResult): number | undefined {
  return maxResidual(result);
}
