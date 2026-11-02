// Cena para o e2e da fusão de divisões. Quatro divisões com nome, feitas por createPlanScene como o editor faz:
//   Sala (0,0)-(4,3) e Cozinha (4,0)-(7,3): partilham a parede x = 4 (fusão limpa, 12 + 9 = 21 m²);
//   Corredor (10,0)-(14,6) e Despensa (14,0)-(17,3): a Despensa só encosta a metade do Corredor, e o Corredor perde o vértice
//   onde a parede acaba (partilha parcial, bloqueada).
// `confirmed` põe um valor confirmado em cada uma das divisões da fusão limpa (a área da Sala; a geometria da Cozinha).
// Uso: npx tsx tests/e2e/wall-removal-merge-seed.ts <ficheiro-de-saída> [confirmed]   (escreve também <saída>.meta.json)
import { writeFileSync } from 'node:fs';
import { executeSceneCommand, serializeSceneTransaction, validateSpatialScene, type PropertyProvenance } from '../../src/spatial-scene';
import { mutateScene, nodeOf, sceneFromRooms, sharedWallId, wallBetween } from '../helpers/rooms';

const [out, variant] = [process.argv[2]!, process.argv[3]];
let t = sceneFromRooms([
  { id: 'sala', vertices: [[0, 0], [4, 0], [4, 3], [0, 3]] },
  { id: 'cozinha', vertices: [[4, 0], [7, 0], [7, 3], [4, 3]] },
  { id: 'corredor', vertices: [[10, 0], [14, 0], [14, 6], [10, 6]] },
  { id: 'despensa', vertices: [[14, 0], [17, 0], [17, 3], [14, 3]] },
], { sceneId: 'e2e-merge' });
const meta = { sharedWall: sharedWallId(t.scene, 'sala', 'cozinha'), outerWall: wallBetween(t.scene, [0, 0], [0, 3]), partialWall: wallBetween(t.scene, [14, 0], [14, 3]) };
t = mutateScene(t, (scene) => {
  const corredor = nodeOf(scene, 'corredor');
  if (corredor.geometry?.kind !== 'polygon') throw new Error('sem polígono');
  corredor.geometry.verticesM = corredor.geometry.verticesM.filter((v) => !(Math.abs(v[0] - 14) < 1e-9 && Math.abs(v[2] + 3) < 1e-9));
});
for (const [id, value] of [['sala', 'Sala'], ['cozinha', 'Cozinha'], ['corredor', 'Corredor'], ['despensa', 'Despensa']] as const) {
  t = executeSceneCommand(t, { type: 'UpdateParameter', nodeId: id, property: 'name', value }, 'reviewer').transaction;
}
if (variant === 'confirmed') {
  const at = '2026-11-01T10:00:00.000Z';
  const verified: PropertyProvenance = { source: 'user', validation: 'verified', actor: 'reviewer', evidence: 'Área medida em obra.', recordedAt: at };
  const corrected: PropertyProvenance = { source: 'user', validation: 'corrected', actor: 'reviewer', evidence: 'Geometria corrigida em obra.', sourceValue: 'medida original', recordedAt: at };
  t = mutateScene(t, (scene) => {
    nodeOf(scene, 'sala').component!.properties.area = { value: 12, unit: 'm2', provenance: verified };
    nodeOf(scene, 'cozinha').geometry!.provenance = corrected;
  });
}
const valid = { ...t, scene: validateSpatialScene(t.scene), undoStack: [], redoStack: [] };
writeFileSync(out, serializeSceneTransaction(valid));
writeFileSync(`${out}.meta.json`, JSON.stringify(meta));
console.log(JSON.stringify(meta));
