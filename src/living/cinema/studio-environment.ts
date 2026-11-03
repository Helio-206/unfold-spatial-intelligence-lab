import * as THREE from 'three';

/**
 * A procedural photo-studio, baked once into a PMREM environment map. There is no image and no HDRI file: a dark room with a few emissive panels whose
 * radiance goes well above 1 (so metals get hard, believable highlights and long soft-box streaks on cylinders), generated deterministically in code.
 *
 *   key      large soft box, upper front-left
 *   strips   two tall strip lights left and right (the long vertical streaks on rods and barrels)
 *   top      overhead panel (reads on flat tops and the floor)
 *   rim      narrow cool strip behind, right
 *   bounce   dim warm floor-level card (stops shadow sides from going dead black)
 *
 * The map belongs to the renderer that built it (GL contexts do not share textures); `dispose()` releases it.
 */
export type StudioEnvironment = { texture: THREE.Texture; panels: ReadonlyArray<{ id: string; radiance: number }>; dispose(): void };

type Panel = { id: string; size: [number, number]; position: [number, number, number]; color: string; radiance: number };
export const STUDIO_PANELS: ReadonlyArray<Panel> = [
  { id: 'key', size: [9, 5], position: [-8, 9, 8], color: '#fff4e6', radiance: 11 },
  { id: 'strip-left', size: [1.4, 9], position: [-12, 4, -1], color: '#ffffff', radiance: 14 },
  { id: 'strip-right', size: [1.4, 9], position: [12, 4, 3], color: '#eaf2ff', radiance: 10 },
  { id: 'top', size: [12, 8], position: [0, 13, 0], color: '#ffffff', radiance: 6 },
  { id: 'rim', size: [1.2, 8], position: [9, 5, -11], color: '#cfe0ff', radiance: 20 },
  { id: 'front', size: [16, 6], position: [8, 3.5, 15], color: '#f2f5ff', radiance: 3.2 },
  { id: 'left-fill', size: [8, 6], position: [-13, 3.5, 7], color: '#fff6ec', radiance: 3.6 },
  { id: 'bounce', size: [14, 1.6], position: [0, 0.6, 12], color: '#ffd9b0', radiance: 1.6 },
];

/** Any list of panels in the shape of `PREMIUM_STUDIO.environment` (an `absorber` is a black plane in front of a panel: architecture in the reflections). */
export type EnvironmentPanel = { id: string; size: readonly [number, number]; position: readonly [number, number, number]; color: string; radiance: number; kind?: 'panel' | 'absorber' };

export function createStudioEnvironment(renderer: THREE.WebGLRenderer, panelSpec: ReadonlyArray<EnvironmentPanel> = STUDIO_PANELS): StudioEnvironment {
  const room = new THREE.Scene();
  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(40, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying vec3 vP; void main(){ float h = clamp(vP.y*0.5+0.5, 0.0, 1.0); vec3 c = mix(vec3(0.010,0.011,0.013), vec3(0.060,0.064,0.072), pow(h, 1.4)); gl_FragColor = vec4(c, 1.0); }',
    }),
  );
  room.add(shell);
  const geometry = new THREE.PlaneGeometry(1, 1); const materials: THREE.Material[] = [];
  for (const p of panelSpec) {
    const material = new THREE.MeshBasicMaterial({ color: p.kind === 'absorber' ? new THREE.Color(0x000000) : new THREE.Color(p.color).multiplyScalar(p.radiance), side: THREE.DoubleSide, toneMapped: false });
    materials.push(material);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.set(p.size[0], p.size[1], 1); mesh.position.set(...p.position); mesh.lookAt(0, 1.8, 0);
    if (p.id === 'bounce') mesh.rotation.x = -Math.PI / 2 + 0.35;
    room.add(mesh);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(room, 0.025, 0.1, 100);
  pmrem.dispose();
  shell.geometry.dispose(); (shell.material as THREE.Material).dispose(); geometry.dispose(); for (const m of materials) m.dispose();
  return { texture: target.texture, panels: panelSpec.map((p) => ({ id: p.id, radiance: p.radiance })), dispose() { target.dispose(); } };
}
