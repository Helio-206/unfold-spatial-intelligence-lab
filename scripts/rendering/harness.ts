// Browser side of the rendering comparison. Not product code: it builds the SAME fixture scene with the frozen "before" adapter and the new one,
// with the same camera, viewport and (where stated) the same lights, and returns images and counters.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildThreePlanGroup as buildBefore } from './baseline/plan-three-adapter.main';
import { buildThreePlanGroup as buildAfter, type ArchitecturalAssets } from '../../src/plan-three-adapter';
import { FIXTURES } from '../../src/rendering/fixtures';
import { configureRenderer, createStage, editorRig } from '../../src/rendering/stage';
import { renderHighResolution, canvasToBlob } from '../../src/rendering/hires';
import { rendererStats, sceneStats, summariseFrames, timeRenders } from '../../src/rendering/metrics';
import { createSpatialCameraView } from '../../src/spatial-camera';

type Variant = 'before' | 'technical' | 'presentation' | 'presentation-on-editor-rig';
type View = 'isometric' | 'top' | 'cutaway' | 'door-detail' | 'window-detail' | 'material-detail' | 'corner-detail' | 'interior';
const W = 1280, H = 720;
const w = window as unknown as { prepare: () => Promise<unknown>; shot: (fixtureId: string, variant: Variant, view: View) => Promise<{ png: string; stats: unknown }>; bench: (fixtureId: string, variant: Variant, frames: number) => Promise<unknown>; hires: (width: number, height: number) => Promise<unknown>; };
let assets: ArchitecturalAssets = {}; let loadMs = 0; let glbBytes = 0;
const fixtures = new Map(FIXTURES.map((f) => [f.id, f.build()]));

w.prepare = async () => {
  const t0 = performance.now();
  const response = await fetch('/assets/architectural_library.glb'); const buffer = await response.arrayBuffer(); glbBytes = buffer.byteLength;
  const gltf = await new Promise<{ scene: THREE.Group }>((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve as never, reject));
  assets = Object.fromEntries(['wall_ext_3000', 'partition_int_3000', 'door_single_900', 'window_double_1200', 'connector_corner_90', 'connector_isolated_foot', 'mechanical_frame_1000'].map((n) => [n, gltf.scene.getObjectByName(n)])) as ArchitecturalAssets;
  loadMs = performance.now() - t0;
  return { glbBytes, loadMs: +loadMs.toFixed(1), userAgent: navigator.userAgent };
};

function makeRenderer(variant: Variant, width = W, height = H): THREE.WebGLRenderer {
  const canvas = document.createElement('canvas');
  const renderer = new THREE.WebGLRenderer({ antialias: true, canvas, powerPreference: 'high-performance', preserveDrawingBuffer: true });
  renderer.setPixelRatio(1); renderer.setSize(width, height, false);
  // "before" and "technical" use exactly the viewer's settings (sRGB output, no tone mapping, no shadows)
  if (variant === 'presentation') configureRenderer(renderer, 'presentation');
  else renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setPixelRatio(1);
  return renderer;
}

function setup(fixtureId: string, variant: Variant, renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#0B0D10');
  const data = fixtures.get(fixtureId)!;
  const t0 = performance.now();
  const group = variant === 'before' ? buildBefore(data, assets) : buildAfter(data, assets, { quality: variant === 'technical' ? 'technical' : 'presentation' });
  const buildMs = performance.now() - t0;
  scene.add(group);
  const grid = new THREE.GridHelper(36, 36, 0x4b5057, 0x23272c); grid.position.y = -0.035; scene.add(grid); // the viewer's grid, so the ground reads the same in every variant
  group.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(group);
  let stage: { fit(b: THREE.Box3): void; dispose(): void };
  if (variant === 'presentation') stage = createStage(scene, 'presentation', renderer);
  else { const rig = editorRig(); scene.add(rig); stage = { fit: () => undefined, dispose: () => scene.remove(rig) }; }
  stage.fit(bounds);
  return { scene, group, bounds, buildMs };
}

function cameraFor(view: View, bounds: THREE.Box3, fixtureId: string, scene: THREE.Scene): THREE.PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(42, W / H, 0.02, 10000);
  const centre = bounds.getCenter(new THREE.Vector3());
  const at = (position: [number, number, number], target: [number, number, number]) => { camera.position.set(...position); camera.up.set(0, 1, 0); camera.lookAt(...target); };
  if (view === 'isometric' || view === 'cutaway') { const v = createSpatialCameraView(bounds, W / H, 'isometric'); camera.position.copy(v.position); camera.up.copy(v.up); camera.lookAt(v.target); }
  else if (view === 'top') { const v = createSpatialCameraView(bounds, W / H, 'top'); camera.position.copy(v.position); camera.up.copy(v.up); camera.lookAt(v.target); }
  else if (view === 'interior') at([bounds.min.x + 0.6, 1.55, bounds.min.z + 0.7], [centre.x + 0.8, 1.0, centre.z + 0.4]);
  else if (view === 'door-detail') { const door = scene.getObjectByName('door-1'); const p = door ? new THREE.Vector3().setFromMatrixPosition(door.matrixWorld) : centre; at([p.x - 2.6, 1.5, p.z + 0.9], [p.x, 1.0, p.z]); }
  else if (view === 'window-detail') { const win = scene.getObjectByName('win-1'); const p = win ? new THREE.Vector3().setFromMatrixPosition(win.matrixWorld) : centre; at([p.x + 0.2, 1.7, p.z + 2.6], [p.x, 1.4, p.z]); }
  else if (view === 'corner-detail') { const p = new THREE.Vector3(bounds.min.x, 0, bounds.min.z); at([p.x - 1.3, 1.9, p.z - 1.3], [p.x + 0.1, 1.5, p.z + 0.1]); } // an outer corner: faces, cap and the join
  else { const x = bounds.min.x + (bounds.max.x - bounds.min.x) / 2; at([x - 2.0, 1.5, bounds.min.z + 2.4], [x, 1.3, bounds.min.z + 0.9]); } // material-detail: the partition wall seen from the left room, floor at the bottom
  camera.updateMatrixWorld(true);
  return camera;
}

w.shot = async (fixtureId, variant, view) => {
  const renderer = makeRenderer(variant);
  const { scene, group, bounds, buildMs } = setup(fixtureId, variant, renderer);
  const camera = cameraFor(view, bounds, fixtureId, scene);
  if (view === 'cutaway') renderer.clippingPlanes = [new THREE.Plane(new THREE.Vector3(0, -1, 0), 1.45)]; // horizontal section at 1.45 m, same for every variant
  renderer.render(scene, camera);
  const png = renderer.domElement.toDataURL('image/png');
  const stats = { build: { ms: +buildMs.toFixed(2) }, scene: sceneStats(group), renderer: rendererStats(renderer) };
  renderer.dispose(); renderer.forceContextLoss();
  return { png, stats };
};

w.bench = async (fixtureId, variant, frames) => {
  const renderer = makeRenderer(variant);
  const { scene, group, bounds, buildMs } = setup(fixtureId, variant, renderer);
  const camera = cameraFor('isometric', bounds, fixtureId, scene);
  const gl = renderer.getContext(); const pixel = new Uint8Array(4);
  const finish = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); // forces the GPU to complete the frame
  timeRenders(() => renderer.render(scene, camera), 5, finish); // warm-up: shader compile, texture upload, shadow map
  const times = timeRenders(() => renderer.render(scene, camera), frames, finish);
  const perFrame = rendererStats(renderer); // renderer.info resets on every render, so this is exactly one frame
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  const out = { fixtureId, variant, build: { ms: +buildMs.toFixed(2) }, frame: summariseFrames(times), draw: { callsPerFrame: perFrame.calls, trianglesPerFrame: perFrame.triangles, lines: perFrame.lines }, memory: { geometries: perFrame.geometries, textures: perFrame.textures, jsHeapBytes: mem?.usedJSHeapSize ?? null }, scene: sceneStats(group), gpu: ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : 'unknown' };
  renderer.dispose(); renderer.forceContextLoss();
  return out;
};

w.hires = async (width, height) => {
  const renderer = makeRenderer('presentation', W, H);
  const { scene, bounds } = setup('multi-room', 'presentation', renderer);
  const camera = cameraFor('isometric', bounds, 'multi-room', scene);
  renderer.dispose(); renderer.forceContextLoss();
  const { canvas, report } = await renderHighResolution(scene, camera, { width, height, quality: 'presentation' });
  const blob = await canvasToBlob(canvas);
  const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { report, png: 'data:image/png;base64,' + btoa(binary), bytes: bytes.length, canvas: [canvas.width, canvas.height] };
};
