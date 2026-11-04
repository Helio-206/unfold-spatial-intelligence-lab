// Writes the hand-authored fixture replies (never Meta output) as JSON so scripts/visual/capture.mjs can load them into any harness build.
//   npx tsx scripts/visual/write-fixtures.ts reports/visual-recovery/fixtures
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { bicycleReply, clockLikeReply, jetEngineReply } from '../../tests/fixtures/spatial-v2/handauthored';

const out = resolve(process.argv[2] ?? 'reports/visual-recovery/fixtures');
await mkdir(out, { recursive: true });
for (const [name, reply] of [['jet-engine', jetEngineReply()], ['bicycle', bicycleReply()], ['clock-like', clockLikeReply()]] as const) await writeFile(resolve(out, `${name}.json`), `${JSON.stringify(reply, null, 2)}\n`);
console.log(`fixtures written to ${out}`);
