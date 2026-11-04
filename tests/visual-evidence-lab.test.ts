import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { referenceCases, renderReference } from '../scripts/benchmark/e2-lab/references';
describe('independent evidence laboratory',()=>{
 it('reproduces frozen fitting and held-out masks with matching digests',()=>{for(let i=0;i<referenceCases.length;i++){const generated=renderReference(i), saved=JSON.parse(readFileSync(`reports/fidelity-v4/e2-visual/${generated.name}-evidence.json`,'utf8'));expect(generated).toEqual(saved);expect(generated.views.filter(v=>v.partition==='fit')).toHaveLength(4);expect(generated.views.filter(v=>v.partition==='held-out')).toHaveLength(4);for(const v of generated.views)expect(createHash('sha256').update(Uint8Array.from(v.mask)).digest('hex')).toBe(v.sha256);}});
});
