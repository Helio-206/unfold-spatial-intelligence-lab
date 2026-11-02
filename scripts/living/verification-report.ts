// Relatório de verificação do motor: números recalculados agora (referência, fecho, varredura, envelope da caçamba).
// Uso: node_modules/.bin/tsx scripts/living/verification-report.ts <ficheiro-de-saída.json>
import { readFileSync, writeFileSync } from 'node:fs';
import { EXCAVATOR_ASSEMBLY_V1 as A } from '../../src/living/contracts/fixtures/excavator.assembly.v1';
import { evaluateActuators, evaluateReferencePose } from '../../src/living/engineering/engine';
import { quatAngle } from '../../src/living/engineering/transform-math';

const out = process.argv[2];
if (!out) throw new Error('Indique o ficheiro de saída.');
const reference = JSON.parse(readFileSync(new URL('../../src/living/contracts/fixtures/excavator.reference-pose.json', import.meta.url), 'utf8')) as { parts: Array<{ partId: string; translationM: number[]; rotation: number[] }> };

const ref = evaluateReferencePose(A);
const errors = ref.parts.map((p) => {
  const e = reference.parts.find((x) => x.partId === p.partId)!;
  return { translation: Math.hypot(...p.translationM.map((v, i) => v - e.translationM[i]!)), rotation: quatAngle(p.rotation, e.rotation) };
});

const strokes: Record<string, number> = { swing_drive: 0 };
for (const a of A.actuators) if (a.kind === 'hydraulic_cylinder') strokes[a.id] = a.referenceStroke.value;
let grid = { ok: 0, blocked: {} as Record<string, number>, worstClosureM: 0, warnings: 0 };
for (let i = 0; i <= 40; i += 1) for (let j = 0; j <= 40; j += 1) {
  const f = evaluateActuators(A, { ...strokes, boom_cylinder: i * 0.019, stick_cylinder: j * 0.02 });
  if (f.status === 'ok') { grid.ok += 1; grid.worstClosureM = Math.max(grid.worstClosureM, f.solver.closureResidualM!); grid.warnings += f.warnings.length; }
  else grid.blocked[f.blocked!.code] = (grid.blocked[f.blocked!.code] ?? 0) + 1;
}
const bucket: Array<{ strokeM: number; status: string; code: string | null }> = [];
for (let i = 0; i <= 30; i += 1) {
  const s = i * 0.02;
  const f = evaluateActuators(A, { ...strokes, bucket_cylinder: s });
  bucket.push({ strokeM: s, status: f.status, code: f.blocked?.code ?? null });
}
const okBucket = bucket.filter((b) => b.status === 'ok').map((b) => b.strokeM);

const report = {
  schema: 'unfold.engine-verification.v1',
  assemblyId: A.id,
  reference: {
    parts: ref.parts.length,
    maxTranslationErrorM: Math.max(...errors.map((e) => e.translation)),
    maxRotationErrorRad: Math.max(...errors.map((e) => e.rotation)),
    loopClosureResidualM: ref.solver.closureResidualM,
    toleranceRequestedM: 1e-6,
    toleranceRequestedRad: 1e-6,
  },
  boomStickGrid: { samples: 41 * 41, ...grid, blocked: grid.blocked },
  bucketEnvelope: { samples: bucket.length, okStrokeRangeM: okBucket.length ? [Math.min(...okBucket), Math.max(...okBucket)] : null, blockedCodes: [...new Set(bucket.filter((b) => b.code).map((b) => b.code))].sort() },
};
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(report, null, 2));
