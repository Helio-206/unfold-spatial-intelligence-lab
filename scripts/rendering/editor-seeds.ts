// Seeds for the integrated-editor evidence: the three synthetic fixtures of src/rendering/fixtures.ts as saved scene transactions
// (the same format the editor restores from localStorage). Synthetic: confirmed geometry here is a fixture choice, not product data.
// usage: npx tsx scripts/rendering/editor-seeds.ts <outDir>
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { serializeSceneTransaction } from '../../src/spatial-scene';
import { FIXTURES } from '../../src/rendering/fixtures';

const out = process.argv[2]!; mkdirSync(out, { recursive: true });
for (const fixture of FIXTURES) writeFileSync(join(out, `${fixture.id}.json`), serializeSceneTransaction({ scene: fixture.build(), undoStack: [], redoStack: [] }));
console.log(FIXTURES.map((f) => f.id).join(' '));
