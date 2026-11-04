import { BoxGeometry, CatmullRomCurve3, ConeGeometry, CylinderGeometry, ExtrudeGeometry, Group, LatheGeometry, Mesh, MeshStandardMaterial, SphereGeometry, TorusGeometry, Vector2, Vector3, Shape, TubeGeometry } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { SpatialPlan } from './contracts';

function createGeometry(operator: string, p: number[]) {
  if (operator === 'box') return new BoxGeometry(p[0]!, p[1]!, p[2]!);
  if (operator === 'rounded_box') return new RoundedBoxGeometry(p[0]!, p[1]!, p[2]!, 3, Math.min(...p) * 0.08);
  if (operator === 'sphere') return new SphereGeometry(p[0]!, 24, 16);
  if (operator === 'ellipsoid') return new SphereGeometry(1, 24, 16).scale(p[0]!, p[1]!, p[2]!);
  if (operator === 'cylinder') return new CylinderGeometry(p[0]!, p[0]!, p[1]!, 32);
  if (operator === 'cone') return new ConeGeometry(p[0]!, p[1]!, 32);
  if (operator === 'torus') return new TorusGeometry(p[0]!, p[1]!, 12, 40);
  if (operator === 'extrude') {
    const shape = new Shape(); shape.moveTo(p[1]!, p[2]!);
    for (let i = 3; i < p.length; i += 2) shape.lineTo(p[i]!, p[i + 1]!);
    shape.closePath(); return new ExtrudeGeometry(shape, { depth: p[0]!, bevelEnabled: false });
  }
  if (operator === 'tube') {
    const points = Array.from({ length: (p.length - 1) / 3 }, (_, i) => new Vector3(p[i * 3 + 1]!, p[i * 3 + 2]!, p[i * 3 + 3]!));
    return new TubeGeometry(new CatmullRomCurve3(points), Math.max(8, points.length * 8), p[0]!, 10, false);
  }
  const points = Array.from({ length: (p.length - 1) / 2 }, (_, i) => new Vector2(p[i * 2 + 1]!, p[i * 2 + 2]!));
  return new LatheGeometry(points, p[0]!);
}

export function spatialPlanToThree(plan: SpatialPlan): Group {
  const root = new Group(); root.name = plan.title;
  const nodes = new Map<string, Group>();
  for (const entity of plan.entities) {
    const node = new Group(); node.name = entity.label; node.userData.spatialEntityId = entity.id;
    const geometry = createGeometry(entity.geometry.operator, entity.geometry.parameters);
    const material = new MeshStandardMaterial({ color: entity.material.color, roughness: entity.material.roughness, metalness: entity.material.metalness });
    const repetitions = entity.repeat?.count ?? 1;
    for (let i = 0; i < repetitions; i++) {
      const mesh = new Mesh(i === 0 ? geometry : geometry.clone(), material.clone());
      mesh.name = entity.label; mesh.userData.spatialEntityId = entity.id;
      if (entity.repeat && i > 0) {
        const axis = entity.repeat.axis === 'x' ? 0 : entity.repeat.axis === 'y' ? 1 : 2;
        if (entity.repeat.kind === 'linear') mesh.position.setComponent(axis, i * entity.repeat.spacingOrRadius);
        else { const angle = i * Math.PI * 2 / repetitions, u = (axis + 1) % 3, v = (axis + 2) % 3; mesh.position.setComponent(u, Math.cos(angle) * entity.repeat.spacingOrRadius); mesh.position.setComponent(v, Math.sin(angle) * entity.repeat.spacingOrRadius); if (axis === 0) mesh.rotation.x = angle; else if (axis === 1) mesh.rotation.y = angle; else mesh.rotation.z = angle; }
      }
      node.add(mesh);
    }
    node.position.set(...entity.transform.position); node.rotation.set(...entity.transform.rotationRad); node.scale.set(...entity.transform.scale);
    nodes.set(entity.id, node);
  }
  for (const entity of plan.entities) (entity.parentId ? nodes.get(entity.parentId)! : root).add(nodes.get(entity.id)!);
  root.userData.contract = plan.contract;
  return root;
}

export function disposeSpatialPlan(root: Group): void {
  root.traverse((object) => { if (object instanceof Mesh) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; for (const material of materials) material.dispose(); } });
}
