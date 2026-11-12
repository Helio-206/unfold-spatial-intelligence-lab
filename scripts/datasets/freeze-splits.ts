// Freezes the development / acceptance split of the external benchmarks BEFORE any evaluation. The split is a pure function of the scan name (sha256 parity), so it
// cannot be tuned after seeing results; the manifest is committed and a test recomputes it. Development scans may be used to choose parameters; acceptance scans
// are evaluated once per frozen configuration and never used to tune anything.   npx tsx scripts/datasets/freeze-splits.ts
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const DATASETS = {
  DTU: { scans: [1, 4, 9, 10, 11, 12, 13, 15, 23, 24, 29, 32, 33, 34, 48, 49, 62, 75, 77, 110, 114, 118].map((n) => `scan${n}`), listProvenance: 'Standard DTU evaluation scans used by MVS benchmarks; list written from the public benchmark description, to be checked against the downloaded archive.' },
  ETH3D: { scans: ['courtyard', 'delivery_area', 'electro', 'facade', 'kicker', 'meadow', 'office', 'pipes', 'playground', 'relief', 'relief_2', 'terrace', 'terrains'], listProvenance: 'ETH3D high-resolution multi-view training scenes (reference laser scans available); list written from the public benchmark description, to be checked against the downloaded archive.' },
} as const;
export const splitOf = (dataset: string, scan: string): 'development' | 'acceptance' => (createHash('sha256').update(`${dataset}:${scan}`).digest()[0]! % 2 === 0 ? 'development' : 'acceptance');
export function buildManifest() {
  return {
    frozenAt: '2026-11-12', rule: "sha256('<dataset>:<scan>')[0] % 2 === 0 -> development, else acceptance. A pure function of the name: no scan can be moved after results are seen.",
    protocol: ['Choose every parameter on development scans only.', 'Evaluate acceptance scans once per frozen configuration; report every acceptance scan, including the bad ones.', 'Never copy an acceptance scan into development, never re-roll the rule.', 'Licences are NOT asserted here: they are recorded in each scan\'s meta.json by whoever downloads the data, from the source page, and checked before any redistribution.'],
    datasets: Object.fromEntries(Object.entries(DATASETS).map(([name, d]) => [name, { listProvenance: d.listProvenance, licence: 'UNVERIFIED — read the licence on the dataset page before download and record it in meta.json', access: 'NOT DOWNLOADED: outbound network policy of the build environment blocks the dataset hosts; see scripts/datasets/README.md', scans: d.scans.map((s) => ({ scan: s, split: splitOf(name, s) })) }])),
  };
}
if (process.argv[1] && /freeze-splits\.ts$/.test(process.argv[1])) { writeFileSync(resolve('scripts/datasets/splits.json'), JSON.stringify(buildManifest(), null, 2) + '\n'); console.log('written scripts/datasets/splits.json'); }
