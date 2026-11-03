/** Isolated still harness: the excavator alone in the studio, camera from the query string. Used for Golden Frame captures. */
import '../../../brand.css';
import { Box3, Mesh, Raycaster, Vector3 } from 'three';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../contracts/fixtures/excavator.assembly.v1';
import { buildExcavator } from '../excavator/build';
import { createMaterialLibrary } from '../materials';
import { referencePoses } from '../poses';
import { FoundryRenderer } from '../renderer';

const q = new URLSearchParams(location.search);
const num = (k: string, d: number) => (q.has(k) ? Number(q.get(k)) : d);
const host = document.querySelector<HTMLElement>('#stage')!;
const foundry = new FoundryRenderer(host, q.get('profile') === 'export' ? 'export' : 'realtime', { preserveDrawingBuffer: true, pixelRatio: q.has('dpr') ? num('dpr', 1) : undefined });
const lib = createMaterialLibrary();
const model = buildExcavator(EXCAVATOR_ASSEMBLY_V1, lib);
foundry.scene.add(model.root);
model.applyPoses(referencePoses().poses);
foundry.studio.updateContactShadow();
const box = new Box3().setFromObject(model.root);
const target = new Vector3(num('tx', 2.4), num('ty', 1.7), num('tz', 0));
const az = num('az', -38) * Math.PI / 180, el = num('el', 14) * Math.PI / 180, dist = num('dist', 15.5);
foundry.camera.fov = num('fov', 30);
foundry.camera.position.set(target.x + dist * Math.cos(el) * Math.cos(az), target.y + dist * Math.sin(el), target.z - dist * Math.cos(el) * Math.sin(az));
foundry.camera.lookAt(target);
foundry.camera.updateProjectionMatrix();
foundry.renderNow();
/** Camera directions from which a world point is visible (no canonical mesh in between); used to frame close-ups. */
const clearViews = (p: [number, number, number], dist: number, ignorePartIds: string[] = []) => {
  const target = new Vector3(...p), out: Array<{ az: number; el: number }> = [], meshes: Mesh[] = [];
  model.root.traverse((o) => { const m = o as Mesh; if (m.isMesh && !ignorePartIds.includes(String(m.userData.partId))) meshes.push(m); });
  const ray = new Raycaster();
  for (let el = -10; el <= 70; el += 5) for (let az = -180; az < 180; az += 5) {
    const a = (az * Math.PI) / 180, e = (el * Math.PI) / 180;
    const cam = new Vector3(target.x + dist * Math.cos(e) * Math.cos(a), target.y + dist * Math.sin(e), target.z - dist * Math.cos(e) * Math.sin(a));
    if (cam.y < 0.1) continue;
    const dir = target.clone().sub(cam); const d = dir.length(); ray.set(cam, dir.normalize()); ray.far = d - 0.02;
    if (!ray.intersectObjects(meshes, false).length) out.push({ az, el });
  }
  return out;
};
(window as unknown as Record<string, unknown>).__foundry = { clearViews, stats: () => foundry.stats(), bounds: { min: box.min.toArray(), max: box.max.toArray() }, ready: true, render: () => foundry.renderNow() };
