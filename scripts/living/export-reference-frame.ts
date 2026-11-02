// Exporta o quadro de referência do excavador como `unfold.motion-frame.v1` (JSON canónico, estável entre execuções).
// Uso: node_modules/.bin/tsx scripts/living/export-reference-frame.ts <ficheiro-de-saída>
import { writeFileSync } from 'node:fs';
import { canonicalize } from '../../src/core';
import { validateMotionFrame } from '../../src/living/contracts';
import { evaluateReferencePose } from '../../src/living/engineering/engine';
import { EXCAVATOR_ASSEMBLY_V1 } from '../../src/living/contracts/fixtures/excavator.assembly.v1';

const out = process.argv[2];
if (!out) throw new Error('Indique o ficheiro de saída.');
const frame = evaluateReferencePose(EXCAVATOR_ASSEMBLY_V1, { timestampS: 0, index: 0 });
const check = validateMotionFrame(frame);
if (!check.ok) throw new Error(`Quadro inválido: ${JSON.stringify(check.issues)}`);
writeFileSync(out, `${JSON.stringify(JSON.parse(canonicalize(frame)), null, 2)}\n`, 'utf8');
console.log(`ok ${out}`);
