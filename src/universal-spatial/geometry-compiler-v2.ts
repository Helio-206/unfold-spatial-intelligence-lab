import {
  BufferGeometry, CatmullRomCurve3, type Material, type Texture, ConeGeometry, CylinderGeometry, DoubleSide, ExtrudeGeometry, Group,
  Float32BufferAttribute, InstancedMesh, LatheGeometry, Matrix4, Mesh, MeshPhysicalMaterial, Quaternion, Shape, ShapeUtils, SphereGeometry,
  TorusGeometry, TubeGeometry, Vector2, Vector3, type ColorRepresentation, type Object3D,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { materialValues } from './materials-v2';
import { MAX_V2_RENDERED_MESHES, MAX_V2_TRIANGLES, type GeometryNodeV2, type MaterialV2, type RepeatPatternV2, type SpatialPlanV2, validateSpatialPlanV2 } from './contracts-v2';

export type GeometryCompilerStats = { meshCount: number; triangleCount: number; geometryBytes: number; componentCount: number; nodeCount: number };
export type CompiledSpatialPlanV2 = { root: Group; stats: GeometryCompilerStats };

export function createMaterial(spec: MaterialV2): MeshPhysicalMaterial {
  const profile = spec.profile, values = materialValues(spec);
  const material = new MeshPhysicalMaterial({ color: spec.color as ColorRepresentation, metalness: values.metalness, roughness: values.roughness, clearcoat: values.clearcoat, ior: values.ior, transparent: values.transparent, opacity: values.opacity, depthWrite: values.depthWrite });
  if (values.sheen > 0) { material.sheen = values.sheen; material.sheenRoughness = 0.6; material.sheenColor.set(spec.color as ColorRepresentation); }
  if (profile === 'glass') material.side = DoubleSide;
  material.name = `spatial-v2:${profile}`;
  material.userData.materialProfile = profile;
  return material;
}

function createLoft(profile: number[][], sections: number[][], capEnds: boolean[]): BufferGeometry {
  const contour = profile.map(([x, y]) => new Vector2(x!, y!));
  const triangles = ShapeUtils.triangulateShape(contour, []);
  const ringSize = contour.length;
  const positions: number[] = [];
  for (const [z, sx, sy] of sections) for (const point of contour) positions.push(point.x * sx!, point.y * sy!, z!);
  const indices: number[] = [];
  for (let ring = 0; ring < sections.length - 1; ring++) {
    const start = ring * ringSize, next = (ring + 1) * ringSize;
    for (let i = 0; i < ringSize; i++) {
      const j = (i + 1) % ringSize, a = start + i, b = start + j, c = next + j, d = next + i;
      indices.push(a, b, c, a, c, d);
    }
  }
  const last = (sections.length - 1) * ringSize;
  if (capEnds[0]) for (const triangle of triangles) indices.push(triangle[2]!, triangle[1]!, triangle[0]!);
  if (capEnds[1]) for (const triangle of triangles) indices.push(last + triangle[0]!, last + triangle[1]!, last + triangle[2]!);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(new Float32Array(positions), 3));
  // u runs around the outline, v along the sections: enough for the micro-surface finishes (roughness, bump, tone variation) to apply to a loft.
  const uvs: number[] = []; for (let ring = 0; ring < sections.length; ring++) for (let i = 0; i < ringSize; i++) uvs.push(i / ringSize, ring / Math.max(1, sections.length - 1));
  geometry.setAttribute('uv', new Float32BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

/** Edge radius used to soften `box` shapes (7% of the thinnest side; never more than half of it). */
export const boxEdgeRadius = (dimensions: readonly number[]): number => Math.min(...dimensions) * 0.07;

function createShape(node: Extract<GeometryNodeV2, { type: 'shape' }>): BufferGeometry {
  const p = node.parameters as Record<string, unknown>;
  switch (node.operator) {
    case 'box': {
      // Presentation detail: a razor-sharp box reads as a placeholder, so edges are softened in proportion to the thinnest side. The declared outer dimensions are unchanged.
      const d = p.dimensions as [number, number, number];
      return new RoundedBoxGeometry(d[0], d[1], d[2], 2, boxEdgeRadius(d));
    }
    case 'rounded_box': {
      const d = p.dimensions as [number, number, number];
      return new RoundedBoxGeometry(d[0], d[1], d[2], Number(p.segments), Number(p.bevelM));
    }
    case 'sphere': return new SphereGeometry(Number(p.radius), Number(p.widthSegments), Number(p.heightSegments));
    case 'ellipsoid': {
      const radii = p.radii as [number, number, number];
      return new SphereGeometry(1, Number(p.widthSegments), Number(p.heightSegments)).scale(radii[0], radii[1], radii[2]);
    }
    case 'cylinder': return new CylinderGeometry(Number(p.radiusTop), Number(p.radiusBottom), Number(p.height), Number(p.radialSegments));
    case 'cone': return new ConeGeometry(Number(p.radius), Number(p.height), Number(p.radialSegments));
    case 'torus': return new TorusGeometry(Number(p.majorRadius), Number(p.tubeRadius), Number(p.radialSegments), Number(p.tubularSegments));
    case 'extrude': {
      const profile = p.profile as number[][];
      const shape = new Shape(); shape.moveTo(profile[0]![0]!, profile[0]![1]!);
      for (const [x, y] of profile.slice(1)) shape.lineTo(x!, y!);
      shape.closePath();
      const geometry = new ExtrudeGeometry(shape, { depth: Number(p.depth), bevelEnabled: Number(p.bevelM) > 0, bevelThickness: Number(p.bevelM), bevelSize: Number(p.bevelM), bevelSegments: 2, curveSegments: Number(p.curveSegments), steps: 1 });
      const smooth = toCreasedNormals(geometry, Math.PI / 9); geometry.dispose(); return smooth;
    }
    case 'tube': {
      const points = (p.points as number[][]).map((point) => new Vector3(...point as [number, number, number]));
      const curve = new CatmullRomCurve3(points, false, 'centripetal');
      const geometry = new TubeGeometry(curve, Number(p.tubularSegments), Number(p.radius), Number(p.radialSegments), false);
      geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return geometry;
    }
    case 'revolve': {
      const profile = (p.profile as number[][]).map(([radius, axial]) => new Vector2(radius!, axial!));
      const geometry = new LatheGeometry(profile, Number(p.segments));
      geometry.computeBoundingBox(); geometry.computeBoundingSphere(); return geometry;
    }
    case 'loft': return createLoft(p.profile as number[][], p.sections as number[][], p.capEnds as boolean[]);
  }
}

function axisIndex(axis: RepeatPatternV2['axis']): 0 | 1 | 2 { return axis === 'x' ? 0 : axis === 'y' ? 1 : 2; }
function repeatedObject(node: GeometryNodeV2, base: Object3D): Object3D {
  if (!node.repeat) return base;
  const { count, axis, kind, spacingOrRadius } = node.repeat;
  const axisIndexValue = axisIndex(axis);
  if (node.type === 'shape' && base instanceof Mesh) {
    const instance = new InstancedMesh(base.geometry, base.material as MeshPhysicalMaterial, count);
    instance.name = node.key; instance.userData = { ...base.userData, repeated: { kind, count, axis, spacingOrRadius } };
    const quaternion = new Quaternion();
    for (let i = 0; i < count; i++) {
      const position = new Vector3();
      if (kind === 'linear') position.setComponent(axisIndexValue, (i - (count - 1) / 2) * spacingOrRadius);
      else {
        const angle = i * Math.PI * 2 / count, u = (axisIndexValue + 1) % 3, v = (axisIndexValue + 2) % 3;
        position.setComponent(u, Math.cos(angle) * spacingOrRadius); position.setComponent(v, Math.sin(angle) * spacingOrRadius);
        quaternion.setFromAxisAngle(new Vector3().setComponent(axisIndexValue, 1), angle);
      }
      instance.setMatrixAt(i, new Matrix4().compose(position, kind === 'radial' ? quaternion : new Quaternion(), new Vector3(1, 1, 1)));
    }
    instance.instanceMatrix.needsUpdate = true; return instance;
  }
  const group = new Group(); group.name = `${node.key}:repeat`;
  for (let i = 0; i < count; i++) {
    const copy = base.clone(true); copy.name = `${node.key}:${i}`; copy.userData.repeatIndex = i;
    if (kind === 'linear') copy.position.setComponent(axisIndexValue, copy.position.getComponent(axisIndexValue) + (i - (count - 1) / 2) * spacingOrRadius);
    else {
      const angle = i * Math.PI * 2 / count, u = (axisIndexValue + 1) % 3, v = (axisIndexValue + 2) % 3;
      copy.position.setComponent(u, copy.position.getComponent(u) + Math.cos(angle) * spacingOrRadius); copy.position.setComponent(v, copy.position.getComponent(v) + Math.sin(angle) * spacingOrRadius);
      copy.rotation.setFromVector3(new Vector3().setComponent(axisIndexValue, angle)).order = 'XYZ';
    }
    group.add(copy);
  }
  return group;
}

function applyTransform(object: Object3D, transform: GeometryNodeV2['transform']): void {
  object.position.set(...transform.position); object.rotation.set(...transform.rotationRad); object.scale.set(...transform.scale);
}

function compileNode(node: GeometryNodeV2, entityId: string): Object3D {
  let base: Object3D;
  if (node.type === 'group') {
    const group = new Group(); group.name = node.key; group.userData.spatialSubcomponentKey = node.key;
    for (const child of node.children) group.add(compileNode(child, entityId));
    base = group;
  } else {
    const mesh = new Mesh(createShape(node), createMaterial(node.material));
    mesh.name = node.key; mesh.userData = { spatialEntityId: entityId, spatialSubcomponentKey: node.key, materialProfile: node.material.profile, ...(node.operator === 'box' ? { spatialEdgeSoftening: boxEdgeRadius(node.parameters.dimensions as number[]) } : {}) };
    mesh.castShadow = true; mesh.receiveShadow = true;
    base = mesh;
  }
  const repeated = repeatedObject(node, base);
  applyTransform(repeated, node.transform);
  return repeated;
}

export function compileSpatialPlanV2(value: SpatialPlanV2 | unknown): CompiledSpatialPlanV2 {
  const plan = validateSpatialPlanV2(value);
  const root = new Group(); root.name = plan.title; root.userData.contract = plan.contract; root.userData.source = plan.source; root.userData.presentationProfile = plan.presentationProfile;
  const components = new Map<string, Group>();
  for (const component of plan.components) {
    const group = new Group(); group.name = component.label; group.userData = { spatialEntityId: component.id, spatialComponentRoot: true, spatialLabel: component.label, provenance: component.provenance };
    applyTransform(group, component.transform); group.add(compileNode(component.geometry, component.id)); components.set(component.id, group);
  }
  for (const component of plan.components) (component.parentId ? components.get(component.parentId)! : root).add(components.get(component.id)!);
  root.updateMatrixWorld(true);
  const geometrySet = new Set<BufferGeometry>(), meshSet = new Set<Mesh>(); let triangles = 0, bytes = 0;
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    meshSet.add(object);
    geometrySet.add(object.geometry);
    const position = object.geometry.getAttribute('position');
    const triangleCount = object.geometry.index ? object.geometry.index.count / 3 : position.count / 3;
    triangles += triangleCount * (object instanceof InstancedMesh ? object.count : 1);
  });
  for (const geometry of geometrySet) {
    for (const attribute of Object.values(geometry.attributes)) bytes += attribute.array.byteLength;
    if (geometry.index) bytes += geometry.index.array.byteLength;
  }
  if (meshSet.size > MAX_V2_RENDERED_MESHES || triangles > MAX_V2_TRIANGLES) { disposeCompiledSpatialPlan(root); throw new Error(meshSet.size > MAX_V2_RENDERED_MESHES ? 'SPATIAL_V2_COMPILED_MESH_BUDGET_EXCEEDED' : 'SPATIAL_V2_COMPILED_TRIANGLE_BUDGET_EXCEEDED'); }
  return { root, stats: { meshCount: meshSet.size, triangleCount: triangles, geometryBytes: bytes, componentCount: components.size, nodeCount: countTreeNodes(plan.components.map((item) => item.geometry)) } };
}

function countTreeNodes(nodes: GeometryNodeV2[]): number { return nodes.reduce((sum, node) => sum + 1 + (node.type === 'group' ? countTreeNodes(node.children) : 0), 0); }

export function disposeCompiledSpatialPlan(root: Group): void {
  // Any material (an external mesh brings MeshStandardMaterial) and any texture it holds: nothing a compiled plan owns may outlive it.
  const geometries = new Set<BufferGeometry>(), materials = new Set<Material>(), textures = new Set<Texture>();
  root.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material)) if (value && (value as Texture).isTexture) textures.add(value as Texture);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
  root.clear();
}
