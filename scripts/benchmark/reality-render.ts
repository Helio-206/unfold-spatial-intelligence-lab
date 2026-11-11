// Browser harness: renders turntable "photographs" (textured, lit, perspective) of a licensed GLB, for the Reality Engine E2E and for visual comparison.
// These are RENDERS of a 3D asset with a known camera, not photographs. Exposed as window.__render(url, azimuths, opts) -> PNG data URLs.
import { Box3, Color, DirectionalLight, HemisphereLight, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

type Opts = { width?: number; height?: number; fovDeg?: number; elevationDeg?: number; fill?: number; background?: string };
(window as unknown as { __render: unknown }).__render = async (url: string, azimuths: number[], opts: Opts = {}): Promise<string[]> => {
  const width = opts.width ?? 640, height = opts.height ?? 480, fov = opts.fovDeg ?? 12, el = ((opts.elevationDeg ?? 0) * Math.PI) / 180, fill = opts.fill ?? 0.55;
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setSize(width, height); renderer.setPixelRatio(1);
  const scene = new Scene(); scene.background = new Color(opts.background ?? '#eeeeee');
  scene.add(new HemisphereLight(0xffffff, 0x8a8f99, 1.4)); const sun = new DirectionalLight(0xffffff, 2.2); sun.position.set(3, 5, 4); scene.add(sun);
  const gltf = await new GLTFLoader().loadAsync(url), model = gltf.scene;
  const box = new Box3().setFromObject(model), centre = box.getCenter(new Vector3()), size = box.getSize(new Vector3()), scale = 1 / size.y;
  const pivot = new (await import('three')).Group(); model.position.sub(centre); pivot.add(model); pivot.scale.setScalar(scale); scene.add(pivot);
  const camera = new PerspectiveCamera(fov, width / height, 0.01, 100), dist = (1 / fill) / (2 * Math.tan((fov * Math.PI) / 360));
  camera.position.set(0, Math.sin(el) * dist, Math.cos(el) * dist); camera.lookAt(0, 0, 0);
  const out: string[] = [];
  for (const az of azimuths) { pivot.rotation.y = (az * Math.PI) / 180; renderer.render(scene, camera); out.push(renderer.domElement.toDataURL('image/png')); }
  renderer.dispose();
  return out;
};
(window as unknown as { __renderReady: boolean }).__renderReady = true;

// Records a turntable video (WebM) of the same scene: a "video with different perspectives" for the video intake. Returns base64.
(window as unknown as { __recordTurntable: unknown }).__recordTurntable = async (url: string, seconds: number, opts: Opts = {}): Promise<string> => {
  const width = opts.width ?? 480, height = opts.height ?? 360, fov = opts.fovDeg ?? 12, el = ((opts.elevationDeg ?? 0) * Math.PI) / 180, fill = opts.fill ?? 0.55;
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); renderer.setSize(width, height); renderer.setPixelRatio(1);
  const scene = new Scene(); scene.background = new Color(opts.background ?? '#eeeeee');
  scene.add(new HemisphereLight(0xffffff, 0x8a8f99, 1.4)); const sun = new DirectionalLight(0xffffff, 2.2); sun.position.set(3, 5, 4); scene.add(sun);
  const gltf = await new GLTFLoader().loadAsync(url), model = gltf.scene, { Group } = await import('three');
  const box = new Box3().setFromObject(model), centre = box.getCenter(new Vector3()), size = box.getSize(new Vector3()), pivot = new Group(); model.position.sub(centre); pivot.add(model); pivot.scale.setScalar(1 / size.y); scene.add(pivot);
  const camera = new PerspectiveCamera(fov, width / height, 0.01, 100), dist = (1 / fill) / (2 * Math.tan((fov * Math.PI) / 360));
  camera.position.set(0, Math.sin(el) * dist, Math.cos(el) * dist); camera.lookAt(0, 0, 0);
  document.body.append(renderer.domElement);
  const stream = renderer.domElement.captureStream(25), recorder = new MediaRecorder(stream, { mimeType: 'video/webm' }), chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((ok) => { recorder.onstop = () => ok(); });
  recorder.start(); const t0 = performance.now();
  await new Promise<void>((ok) => { const tick = () => { const f = (performance.now() - t0) / (seconds * 1000); if (f >= 1) { ok(); return; } pivot.rotation.y = f * Math.PI * 2; renderer.render(scene, camera); requestAnimationFrame(tick); }; tick(); });
  recorder.stop(); await stopped; renderer.dispose();
  const blob = new Blob(chunks, { type: 'video/webm' }), buf = new Uint8Array(await blob.arrayBuffer()); let s = ''; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
};

// Raw RGBA variant for in-process evaluation (no PNG round trip). Returns base64 RGBA per view.
(window as unknown as { __renderRaw: unknown }).__renderRaw = async (url: string, azimuths: number[], opts: Opts = {}): Promise<{ width: number; height: number; rgba: string[] }> => {
  const urls: string[] = await (window as unknown as { __render: (u: string, a: number[], o: Opts) => Promise<string[]> }).__render(url, azimuths, opts);
  const out: string[] = []; let width = 0, height = 0;
  for (const u of urls) {
    const img = new Image(); img.src = u; await img.decode(); width = img.width; height = img.height;
    const c = document.createElement('canvas'); c.width = width; c.height = height; const ctx = c.getContext('2d')!; ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, width, height).data; let str = ''; for (let i = 0; i < d.length; i += 0x8000) str += String.fromCharCode(...d.subarray(i, i + 0x8000)); out.push(btoa(str));
  }
  return { width, height, rgba: out };
};
