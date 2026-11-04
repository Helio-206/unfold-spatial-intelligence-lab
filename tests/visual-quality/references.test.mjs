import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const manifest=JSON.parse(readFileSync('reports/product-integration/visual-quality/references/manifest.json'));
describe('reference candidate integrity',()=>{
 it('binds each redistributed image to a hash, licence and attribution',()=>{for(const c of manifest.cases){expect(createHash('sha256').update(readFileSync(c.file)).digest('hex')).toBe(c.sha256);expect(c.sourcePage).toMatch(/^https:\/\/commons\.wikimedia\.org\//);expect(c.license).toBeTruthy();expect(c.author).toBeTruthy();expect(c.expectedVisibleComponents.length).toBeGreaterThan(0)}});
 it('does not misrepresent candidates as a private or complete dataset',()=>{expect(manifest.status).toContain('INCOMPLETE');expect(manifest.cases.every(c=>c.split.includes('no confidential holdout'))).toBe(true)});
});
