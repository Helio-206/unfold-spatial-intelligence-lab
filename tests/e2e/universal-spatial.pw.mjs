import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';

const baseUrl = process.env.UNFOLD_E2E_URL ?? 'http://127.0.0.1:5173/universal-spatial';
const imagePath = resolve(process.env.UNFOLD_TEST_IMAGE ?? 'reports/universal-spatial/inputs/turbofan-jet-engine.jpg');
const out = resolve(process.env.UNFOLD_EVIDENCE_DIR ?? 'reports/universal-spatial/evidence');
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
const errors = [];
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
page.on('pageerror', (error) => errors.push(error.message));
const scenarios = [];
async function generateText(instruction, screenshot) {
  const sha = createHash('sha256').update(instruction).digest('hex');
  await page.locator('#us-prompt').fill(instruction);
  await page.locator('#us-build').click();
  await page.waitForFunction((expected) => window.unfoldSpatialPlan?.source?.sha256 === expected || document.querySelector('#us-status')?.textContent?.startsWith('Blocked:'), sha, { timeout: 75_000 });
  const plan = await page.evaluate(() => window.unfoldSpatialPlan);
  if (!plan || plan.source.sha256 !== sha) throw new Error(await page.locator('#us-status').textContent());
  await page.locator('#us-entities button').first().click();
  await page.waitForFunction(() => document.querySelector('#us-detail')?.textContent?.includes('provenance'));
  await page.screenshot({ path: resolve(out, screenshot), fullPage: true });
  const summary = { input: instruction, sourceSha256: sha, request: await page.locator('#us-status').textContent(), title: plan.title, entities: plan.entities.map(({ id, label, parentId, geometry, repeat, transform, origin }) => ({ id, label, parentId, operator: geometry.operator, parameters: geometry.parameters, repeat, transform, origin })), unknowns: plan.unknowns, relations: plan.relations };
  scenarios.push(summary);
  return plan;
}

try {
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  const arm = await generateText('Build a robotic arm with three joints and a magnetic end effector.', 'scenario-a-robotic-arm.png');
  assert.ok(arm.entities.filter((item) => /joint/i.test(item.label)).length >= 3, 'robotic arm plan should identify three joints');
  const fan = await generateText('Create an industrial fan with six blades, a central hub, electric motor, housing and stand.', 'scenario-c-industrial-fan.png');
  assert.ok(fan.entities.some((item) => item.repeat?.kind === 'radial' && item.repeat.count === 6), 'six-blade request should use a six-instance radial pattern');
  const armShape = JSON.stringify(arm.entities.map((item) => [item.id, item.geometry.operator, item.geometry.parameters]));
  const fanShape = JSON.stringify(fan.entities.map((item) => [item.id, item.geometry.operator, item.geometry.parameters]));
  assert.notEqual(armShape, fanShape, 'different text inputs must produce different plan geometry');

  await page.locator('#us-image').setInputFiles(imagePath);
  await page.waitForFunction(() => window.unfoldSpatialPlan?.source?.kind === 'image' || document.querySelector('#us-status')?.textContent?.startsWith('Blocked:'), null, { timeout: 75_000 });
  const imagePlan = await page.evaluate(() => window.unfoldSpatialPlan);
  if (!imagePlan || imagePlan.source.kind !== 'image') throw new Error(await page.locator('#us-status').textContent());
  assert.ok(imagePlan.unknowns.length > 0, 'image-scale uncertainty must be retained');
  assert.match(await page.locator('#us-status').textContent(), /scale unknown/i);
  assert.equal(imagePlan.units, 'unitless', 'photo without scale must stay unitless');
  assert.ok(imagePlan.entities.every((item) => !/hangar|background|floor|wall/i.test(item.label)), 'image plan should exclude unrelated scene dressing');
  await page.locator('#us-entities button').first().click();
  await page.screenshot({ path: resolve(out, 'scenario-b-turbofan-image.png'), fullPage: true });
  scenarios.push({ input: 'Wikimedia Commons turbofan photograph (CC BY 2.0)', sourceSha256: imagePlan.source.sha256, request: await page.locator('#us-status').textContent(), title: imagePlan.title, entities: imagePlan.entities.map(({ id, label, geometry, origin }) => ({ id, label, operator: geometry.operator, origin })), unknowns: imagePlan.unknowns, relations: imagePlan.relations });

  const unexpected = await generateText('Create a small pedestrian suspension bridge with a deck, two towers, cables and repeating hangers.', 'scenario-d-unexpected-bridge.png');
  const fanOperators = JSON.stringify(fan.entities.map((item) => item.geometry.operator));
  const unexpectedOperators = JSON.stringify(unexpected.entities.map((item) => item.geometry.operator));
  assert.notEqual(unexpectedOperators, fanOperators, 'unexpected-domain operator composition should differ from the fan');
  await page.locator('#us-step').evaluate((node, max) => { node.value = String(max); node.dispatchEvent(new Event('input', { bubbles: true })); }, unexpected.entities.length + unexpected.relations.length + 3);
  assert.deepEqual(errors, [], 'browser console must stay clean');
  const result = { browser: 'Chromium Playwright + SwiftShader', url: baseUrl, sourceImage: 'Wikimedia Commons, Turbofan jet engine.jpg, author Stéphane Gallay, CC BY 2.0; 1280x960 derivative', scenarios, geometryDifferentiation: { roboticArmVsFan: armShape !== fanShape, fanVsUnexpected: fanOperators !== unexpectedOperators }, selectionInspector: 'passed for live text and image plans', screenshots: ['scenario-a-robotic-arm.png', 'scenario-b-turbofan-image.png', 'scenario-c-industrial-fan.png', 'scenario-d-unexpected-bridge.png'], consoleErrors: errors };
  await writeFile(resolve(out, 'browser-proof.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally { await browser.close(); }
