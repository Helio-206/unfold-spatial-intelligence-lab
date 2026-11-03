/**
 * The "imported" technical drawing for the prototype: a side elevation of the canonical excavator rendered as line art
 * (Paper sheet, ink lines, hidden lines removed) from a separate instance of the Visual Foundry geometry, plus the
 * screen region of every canonical part in sheet coordinates.
 *
 * FIXTURE: the sheet is generated from the canonical model, so it registers exactly with the 3D scene. That is the
 * point of the transition, and the interface says so; it is not evidence that a real drawing was read.
 */
import * as THREE from 'three';
import type { Assembly } from '../contracts';
import { convexHull, type P2 } from '../visual-foundry/geometry';
import { createExcavatorProvider } from '../visual-foundry/provider';

/** The sheet is a side elevation seen from the operator's left (−Z), with +Y up; the machine front (+X) is on the left. */
export type SheetProjection = { centre: [number, number]; widthM: number; heightM: number; px: [number, number] };
export type DrawingResult = { dataUrl: string; projection: SheetProjection; regions: Map<string, P2[]> };

const PAPER = '#F3F0E8', INK = '#0B0D10';

/** World (x, y) on the sheet plane → sheet pixels. Pure, so the overlay and the 3D sheet share it. */
export function toSheet(p: SheetProjection, x: number, y: number): P2 {
  const u = 0.5 - (x - p.centre[0]) / p.widthM; // camera looks +Z: world +X runs to the left
  const v = 0.5 - (y - p.centre[1]) / p.heightM;
  return [u * p.px[0], v * p.px[1]];
}

export function sheetProjectionFor(min: THREE.Vector3, max: THREE.Vector3, px: [number, number] = [1800, 900]): SheetProjection {
  const aspect = px[0] / px[1];
  const w = (max.x - min.x) * 1.16, h = (max.y - min.y) * 1.22;
  const widthM = Math.max(w, h * aspect), heightM = widthM / aspect;
  // the sheet's bottom edge is the ground line (y = 0): the sheet hinges onto the floor exactly there
  return { centre: [(min.x + max.x) / 2, heightM / 2], widthM, heightM, px };
}

export function renderDrawing(assembly: Assembly): DrawingResult {
  const provider = createExcavatorProvider(assembly);
  provider.applyReferencePose();
  const root = provider.root; root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);
  const projection = sheetProjectionFor(bounds.min, bounds.max);
  const scene = new THREE.Scene(); scene.background = new THREE.Color().setStyle(PAPER, THREE.SRGBColorSpace);
  const fill = new THREE.MeshBasicMaterial({ color: new THREE.Color().setStyle(PAPER, THREE.SRGBColorSpace), polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  const ink = new THREE.LineBasicMaterial({ color: new THREE.Color().setStyle(INK, THREE.SRGBColorSpace) });
  const disposables: Array<{ dispose(): void }> = [fill, ink];
  const regions = new Map<string, P2[]>();
  const tmp = new THREE.Vector3();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || (mesh.material as THREE.Material).transparent) return;
    const edges = new THREE.EdgesGeometry(mesh.geometry, 28); disposables.push(edges);
    const lines = new THREE.LineSegments(edges, ink); lines.applyMatrix4(mesh.matrixWorld);
    const solid = new THREE.Mesh(mesh.geometry, fill); solid.applyMatrix4(mesh.matrixWorld);
    scene.add(solid, lines);
    const partId = typeof mesh.userData.partId === 'string' ? mesh.userData.partId as string : null;
    if (!partId) return;
    const pos = mesh.geometry.attributes.position!; const step = Math.max(1, Math.floor(pos.count / 400));
    const pts = regions.get(partId) ?? [];
    for (let i = 0; i < pos.count; i += step) { tmp.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld); pts.push(toSheet(projection, tmp.x, tmp.y)); }
    regions.set(partId, pts);
  });
  for (const [k, pts] of regions) regions.set(k, convexHull(pts));
  const { widthM, heightM, centre } = projection;
  const cam = new THREE.OrthographicCamera(-widthM / 2, widthM / 2, heightM / 2, -heightM / 2, 0.1, 200);
  cam.position.set(centre[0], centre[1], -60); cam.up.set(0, 1, 0); cam.lookAt(centre[0], centre[1], 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(projection.px[0], projection.px[1], false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.render(scene, cam);
  const dataUrl = renderer.domElement.toDataURL('image/png');
  renderer.dispose(); renderer.forceContextLoss();
  for (const d of disposables) d.dispose();
  provider.dispose();
  return { dataUrl, projection, regions };
}
