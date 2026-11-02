// Relatório da pose de referência: compara as 13 partes com o script Python independente e imprime os erros máximos.
// Uso: node_modules/.bin/tsx scripts/living/reference-pose-report.ts
import { readFileSync } from 'node:fs';
import { evaluateReferencePose } from '../../src/living/engineering/engine';
import { quatAngle } from '../../src/living/engineering/transform-math';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../src/living/contracts/fixtures/excavator.assembly.v1';

const reference = JSON.parse(
  readFileSync(new URL('../../src/living/contracts/fixtures/excavator.reference-pose.json', import.meta.url), 'utf8'),
) as { parts: Array<{ partId: string; translationM: number[]; rotation: number[] }> };

const frame = evaluateReferencePose(EXCAVATOR_ASSEMBLY_V1);
const rows = frame.parts.map((part) => {
  const expected = reference.parts.find((item) => item.partId === part.partId);
  if (!expected) throw new Error(`Sem referência para ${part.partId}`);
  return {
    partId: part.partId,
    translationErrorM: Math.hypot(...part.translationM.map((v, i) => v - expected.translationM[i]!)),
    rotationErrorRad: quatAngle(part.rotation, expected.rotation),
  };
});

console.log(JSON.stringify({
  status: frame.status,
  parts: rows.length,
  maxTranslationErrorM: Math.max(...rows.map((r) => r.translationErrorM)),
  maxRotationErrorRad: Math.max(...rows.map((r) => r.rotationErrorRad)),
  maxClosureResidualM: frame.solver.closureResidualM,
  worstTranslation: rows.reduce((a, b) => (b.translationErrorM > a.translationErrorM ? b : a)).partId,
}, null, 2));
