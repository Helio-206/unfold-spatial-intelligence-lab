import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { createStudioEnvironment } from '../living/cinema/studio-environment';
import { HEART_COMPONENT_LABELS } from './adapter';
import type { AnatomySceneProposal } from './adapter';

export type HeartViewer = { select(id: string | null): void; setVisible(id: string, visible: boolean): void; setIllustrativePhase(id: string): void; dispose(): void; readonly meshNames: string[] };

export async function mountHeartViewer(host: HTMLElement, onSelect: (id: string | null) => void, reducedMotion = false): Promise<HeartViewer> {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5)); renderer.setSize(host.clientWidth, host.clientHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.setAttribute('aria-label', 'Modelo cardíaco 3D educativo; arraste para rodar e use a roda para aproximar');
  host.replaceChildren(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#101317');
  const environment = createStudioEnvironment(renderer); scene.environment = environment.texture; scene.environmentIntensity = 0.8;
  const key = new THREE.DirectionalLight('#fff0e3', 3.0); key.position.set(-4, 5, 5); key.castShadow = true;
  const rim = new THREE.DirectionalLight('#c5d9ff', 2.0); rim.position.set(4, 2, -4);
  const fill = new THREE.HemisphereLight('#c1d1e5', '#241c1c', 1.1); scene.add(key, rim, fill);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(3, 64).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#171a1e', roughness: 0.6, metalness: 0.05 })); floor.receiveShadow = true; scene.add(floor);
  const camera = new THREE.PerspectiveCamera(36, Math.max(0.1, host.clientWidth / host.clientHeight), 0.1, 100);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = !reducedMotion; controls.dampingFactor = 0.07; controls.minDistance = 2.5; controls.maxDistance = 12; controls.maxPolarAngle = Math.PI * 0.88; controls.target.set(0, 0, 0);
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync('/anatomy/heart.glb');
  const root = gltf.scene; root.name = 'bodyparts3d-heart-atlas'; root.traverse((node) => { const mesh = node as THREE.Mesh; if (!mesh.isMesh) return; mesh.castShadow = true; mesh.receiveShadow = true; });
  scene.add(root); root.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(root); const center = box.getCenter(new THREE.Vector3()); root.position.sub(center); root.updateWorldMatrix(true, true);
  const size = box.getSize(new THREE.Vector3()); const radius = Math.max(size.length() * 0.72, 1.2); camera.position.set(radius * 0.9, radius * 0.45, radius * 2.35); camera.near = radius / 30; camera.far = radius * 20; camera.updateProjectionMatrix(); camera.lookAt(0, 0, 0); controls.target.set(0, 0, 0); controls.minDistance = radius * 0.85; controls.maxDistance = radius * 4;
  floor.position.y = -size.y * 0.52;
  const names: string[] = []; const meshByName = new Map<string, THREE.Mesh>(); const originalMaterials = new Map<string, THREE.Material | THREE.Material[]>();
  root.traverse((node) => { const mesh = node as THREE.Mesh; if (!mesh.isMesh) return; names.push(mesh.name); meshByName.set(mesh.name, mesh); const original = mesh.material; originalMaterials.set(mesh.name, original); const clone = Array.isArray(original) ? original.map((m) => m.clone()) : original.clone(); mesh.material = clone; });
  if (names.length !== 11 || names.some((name) => !Object.hasOwn(HEART_COMPONENT_LABELS, name))) throw new Error('ANATOMY_MODEL_COMPONENTS_INVALID');
  const animateMats = (active: Set<string>) => { for (const [id, mesh] of meshByName) { const mat = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; for (const item of mat) { const m = item as THREE.MeshStandardMaterial; if (!m.emissive) continue; m.emissive.set(id === selectedId ? '#f18e64' : active.has(id) ? '#b44d38' : '#000000'); m.emissiveIntensity = id === selectedId ? 0.42 : active.has(id) ? 0.3 : 0; } } renderer.render(scene, camera); };
  let selectedId: string | null = null; let activePhase = new Set<string>(); let raf = 0; let disposed = false;
  const render = () => { if (disposed) return; raf = requestAnimationFrame(render); controls.update(); renderer.render(scene, camera); };
  renderer.domElement.addEventListener('click', (event) => {
    const rect = renderer.domElement.getBoundingClientRect(); const pointer = new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster(); raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects([...meshByName.values()], false)[0]?.object as THREE.Mesh | undefined;
    onSelect(hit && meshByName.has(hit.name) ? hit.name : null);
  });
  const observer = new ResizeObserver(() => { const width = Math.max(1, host.clientWidth); const height = Math.max(1, host.clientHeight); camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false); }); observer.observe(host);
  render();
  return {
    get meshNames() { return [...names]; },
    select(id) { selectedId = id && meshByName.has(id) ? id : null; animateMats(activePhase); },
    setVisible(id, visible) { const mesh = meshByName.get(id); if (mesh) { mesh.visible = visible; renderer.render(scene, camera); } },
    setIllustrativePhase(id) {
      const byPhase: Record<string, string[]> = {
        fill: ['right-ventricle','left-ventricle'], atria: ['right-atrium','left-atrium'],
        ventricles: ['ventricular-wall'], rest: [],
      };
      activePhase = new Set(byPhase[id] ?? []); animateMats(activePhase);
    },
    dispose() { disposed = true; cancelAnimationFrame(raf); observer.disconnect(); controls.dispose(); environment.dispose(); floor.geometry.dispose(); (floor.material as THREE.Material).dispose(); for (const [id, mesh] of meshByName) { const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]; materials.forEach((material) => material.dispose()); mesh.material = originalMaterials.get(id)!; } renderer.dispose(); renderer.domElement.remove(); scene.clear(); },
  };
}

export function activePhaseAt(proposal: AnatomySceneProposal, seconds: number): AnatomySceneProposal['motion']['phases'][number] {
  const t = Math.min(Math.max(seconds, 0), proposal.motion.durationS);
  return proposal.motion.phases.find((phase, index) => t >= phase.startS && (t < phase.endS || index === proposal.motion.phases.length - 1)) ?? proposal.motion.phases[0]!;
}
