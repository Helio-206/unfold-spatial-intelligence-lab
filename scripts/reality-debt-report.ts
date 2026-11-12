// Regenerates reports/reality-engine/TECHNICAL-DEBT.md from the debt register and the committed measurement files.   npx tsx scripts/reality-debt-report.ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { debtMarkdown, evaluateDebt } from '../src/living/reality/debt';

export const loadMeasurement = (path: string): unknown | null => { const f = resolve(path); if (!existsSync(f)) return null; const text = readFileSync(f, 'utf8'); return path.endsWith('.json') ? JSON.parse(text) : { text }; };
export const currentDebtMarkdown = () => debtMarkdown(evaluateDebt(loadMeasurement));
if (process.argv[1] && /reality-debt-report\.ts$/.test(process.argv[1])) { writeFileSync(resolve('reports/reality-engine/TECHNICAL-DEBT.md'), currentDebtMarkdown()); console.log('written reports/reality-engine/TECHNICAL-DEBT.md'); }
