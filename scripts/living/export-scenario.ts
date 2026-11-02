// Exporta o cenário do excavador como sequência de quadros `unfold.motion-frame.v1` (JSON canónico, estável entre execuções).
// Uso: node_modules/.bin/tsx scripts/living/export-scenario.ts <ficheiro-de-saída>
import { writeFileSync } from 'node:fs';
import { buildExcavatorScenario } from '../../src/living/engineering/scenario';

const out = process.argv[2];
if (!out) throw new Error('Indique o ficheiro de saída.');
const payload = buildExcavatorScenario();
writeFileSync(out, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
console.log(`ok ${out} (${payload.frames.length} quadros)`);
