import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const url = process.env.UNFOLD_V2_E2E_URL ?? 'http://127.0.0.1:5179/universal-spatial-v2';
const imagePath = resolve(process.env.UNFOLD_V2_TEST_IMAGE ?? '/tmp/codex-clipboard-93f0e5f1-fb3c-401b-bad4-52d414ea704b.png');
const planPath = resolve(process.env.UNFOLD_V2_PLAN_REPLY ?? 'reports/universal-spatial-v2/evidence/live-image-plan.json');
const out = resolve(process.env.UNFOLD_V2_EVIDENCE_DIR ?? 'reports/universal-spatial-v2/evidence');
await mkdir(out, { recursive: true });
const bytes = await readFile(imagePath);
const reply = JSON.parse(await readFile(planPath, 'utf8'));
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('pageerror', (error) => errors.push(error.message));
try {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.evaluate((payload) => window.unfoldLoadSpatialPlanV2(payload), reply);
  assert.equal(reply.plan.source.kind, 'image');
  assert.equal(reply.plan.units, 'unitless', 'an unscaled photograph must not become physical dimensions');
  assert.ok(reply.plan.unknowns.some((value) => /absolute scale are unknown/i.test(value)));
  await page.locator('#v2-components button').first().click();
  await page.waitForFunction(() => document.querySelector('#v2-detail')?.textContent?.includes('provenance'));
  await page.screenshot({ path: resolve(out, 'v2-excavator-source.png'), fullPage: true });
  let evaluationStatus = 'not run by the bounded render-browser test';
  if (process.env.UNFOLD_V2_RUN_LIVE_EVALUATION === '1') {
    await page.locator('#v2-evaluate').click();
    await page.waitForFunction(() => document.querySelector('#v2-status')?.textContent?.includes('Visual hypothesis') || document.querySelector('#v2-status')?.textContent?.startsWith('Evaluation blocked:'), null, { timeout: 90_000 });
    evaluationStatus = await page.locator('#v2-status').textContent();
    await page.screenshot({ path: resolve(out, 'v2-excavator-evaluated.png'), fullPage: true });
  }
  assert.deepEqual(errors, [], 'browser console must stay clean');
  const { stats, evaluation } = await page.evaluate(() => ({ stats: window.unfoldSpatialStatsV2, evaluation: window.unfoldSpatialEvaluationV2 }));
  const screenshots = ['v2-excavator-source.png', ...(process.env.UNFOLD_V2_RUN_LIVE_EVALUATION === '1' ? ['v2-excavator-evaluated.png'] : [])];
  const result = { browser: 'Chromium Playwright + SwiftShader', viewport: '1440x1000', url, input: { path: imagePath, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }, model: reply.meta, plan: { title: reply.plan.title, units: reply.plan.units, componentCount: reply.plan.components.length, components: reply.plan.components.map(({ id, label, parentId, provenance }) => ({ id, label, parentId, provenance })), unknowns: reply.plan.unknowns, operators: reply.sceneSummary.operators, constraints: reply.constraintReport, stats }, evaluationStatus, evaluation, screenshots, consoleErrors: errors };
  await writeFile(resolve(out, 'browser-proof.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
