// Cena para o e2e de autorização: duas paredes (A com geometria e comprimento confirmados, B sem nada confirmado) e uma
// porta na A com a largura confirmada. `door-position` confirma também a posição da porta.
// Uso: npx tsx tests/e2e/confirmed-values-seed.ts <ficheiro-de-saída> [door-position]
import { writeFileSync } from 'node:fs';
import { addOpeningToScene, createPlanScene } from '../../src/plan-scene';
import { serializeSceneTransaction, validateSpatialScene, type PropertyProvenance } from '../../src/spatial-scene';

const at = '2026-11-01T10:00:00.000Z';
const wall = (id: string, y: number) => ({ id, orientation: 'horizontal' as const, start: { x: 20, y }, end: { x: 220, y }, thicknessPx: 4, confidence: 0.9, origin: 'manual_correction' as const });
const candidates = [wall('a', 30), wall('b', 90)];
let tx = createPlanScene({
  sceneId: 'e2e-confirmed', title: 'Cena e2e', image: { sha256: 'a'.repeat(64), width: 260, height: 130 },
  calibration: { pixelDistance: 100, realDistanceMetres: 5, evidence: 'Cota de 5 m em 100 px (fixture e2e).', actor: 'reviewer' },
  confirmedCandidateIds: ['a', 'b'], candidates, wall: { heightM: 2.8, thicknessM: 0.2 }, recordedAt: at,
});
tx = addOpeningToScene(tx, 'wall-a', { id: 'door-a', kind: 'door', offsetM: 2, widthM: 0.9, heightM: 2.1, sillM: 0, actor: 'reviewer' }, at);
const verified = (note: string): PropertyProvenance => ({ source: 'user', validation: 'verified', actor: 'reviewer', evidence: note, recordedAt: at });
const scene = structuredClone(tx.scene);
const a = scene.nodes.find((n) => n.id === 'wall-a')!;
a.geometry!.provenance = verified('Medido em obra: parede A.');
a.component!.properties.length!.provenance = verified('Comprimento medido em obra.');
const door = scene.nodes.find((n) => n.id === 'door-a')!;
door.component!.properties.width!.provenance = verified('Largura da porta medida.');
if (process.argv[3] === 'door-position') door.transform.provenance.translationM = verified('Posição da porta medida.');
const out = { scene: validateSpatialScene(scene), undoStack: [], redoStack: [] };
writeFileSync(process.argv[2]!, serializeSceneTransaction(out));
console.log(out.scene.nodes.map((n) => `${n.id}:${n.component?.kind}:${n.geometry?.kind === 'box' ? n.geometry.sizeM.join('x') : ''}`).join('  '));
