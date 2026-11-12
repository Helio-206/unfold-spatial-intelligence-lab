import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildManifest, DATASETS, splitOf } from '../scripts/datasets/freeze-splits';

describe('frozen external-benchmark splits', () => {
  const committed = JSON.parse(readFileSync('scripts/datasets/splits.json', 'utf8'));
  it('the committed manifest equals the pure function of the scan names (no scan was moved after the fact)', () => { expect(committed).toEqual(buildManifest()); });
  it('both splits are non-empty for every dataset and no scan is in both', () => {
    for (const [name, d] of Object.entries(DATASETS)) { const dev = d.scans.filter((s) => splitOf(name, s) === 'development'), acc = d.scans.filter((s) => splitOf(name, s) === 'acceptance'); expect(dev.length).toBeGreaterThanOrEqual(3); expect(acc.length).toBeGreaterThanOrEqual(3); expect(dev.length + acc.length).toBe(d.scans.length); }
  });
  it('licences are never asserted without verification and the data is declared as not downloaded', () => {
    for (const d of Object.values(committed.datasets) as Array<{ licence: string; access: string }>) { expect(d.licence).toMatch(/UNVERIFIED/); expect(d.access).toMatch(/NOT DOWNLOADED/); }
  });
});
