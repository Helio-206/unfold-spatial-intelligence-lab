// Starts vite, opens the harness in headless Chrome, runs the real pipeline on a local fixture and writes raw JSON.
// usage: node scripts/benchmark/run-detect.mjs .local-fixtures/sample-1.png reports/benchmark/sample-1.raw.json [threshold] [runs]
import fs from 'node:fs';
import { createServer } from 'vite';
import { launchSystemChromium } from './browser.mjs';

const [, , imagePath, outPath, thresholdArg, runsArg] = process.argv;
if (!imagePath || !outPath) throw new Error('usage: run-detect.mjs <image> <out.json> [threshold] [runs]');
const server = await createServer({ server: { port: 5189, host: '127.0.0.1' }, logLevel: 'error' });
await server.listen();
const browser = await launchSystemChromium();
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://127.0.0.1:5189/scripts/benchmark/harness.html');
  await page.waitForFunction(() => typeof window.runPipeline === 'function');
  const b64 = fs.readFileSync(imagePath).toString('base64');
  const runs = Number(runsArg ?? 5);
  const results = [];
  for (let i = 0; i < runs; i += 1) results.push(await page.evaluate(([data, threshold]) => window.runPipeline(data, 'image/png', { threshold }), [b64, thresholdArg ? Number(thresholdArg) : 150]));
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const timings = Object.fromEntries(Object.keys(results[0].timings).map((k) => [k, Number(median(results.map((r) => r.timings[k])).toFixed(1))]));
  fs.writeFileSync(outPath, JSON.stringify({ ...results[0], timings, timingRuns: runs, errors }, null, 1));
  console.log(JSON.stringify({ candidates: results[0].candidates.length, regions: results[0].regions.length, loops: results[0].loops, timings, errors }));
} finally { await browser.close(); await server.close(); }
