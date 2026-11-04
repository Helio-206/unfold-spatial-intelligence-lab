// The review gate must reopen as soon as the last "correct component" choice gets its corrected component (PR #27 review, P2).
// Mocked observation route (no model call). Run: npx tsx tests/e2e/anatomy-review-correction.pw.ts  (frontend on UNFOLD_E2E_URL, default http://127.0.0.1:5191)
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright-core';
import { ANATOMY_OBSERVATION_SCHEMA, bindAnatomySource, validateAnatomyObservation } from '../../src/anatomy/contracts';

const BASE = process.env.UNFOLD_E2E_URL ?? 'http://127.0.0.1:5191';
const evidence = [{ id: 'label-right-atrium', kind: 'label_text' as const, detail: 'Printed label identifies the right atrium.', locator: 'left-middle label' }];
const base = validateAnatomyObservation({
  schema: ANATOMY_OBSERVATION_SCHEMA, subjectDisposition: 'heart_illustration', subjectEvidence: evidence,
  structures: [{ id: 'right-atrium', label: 'Right atrium', status: 'observed', confidence: 0.9, evidence }, { id: 'ventricular-wall', label: 'Ventricular wall', status: 'hypothesis', confidence: 0.6, evidence }],
  relations: [], hypotheses: [], uncertainties: ['No physical scale is visible.'],
});
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1600, height: 1050 } })).newPage();
  await page.route('**/api/anatomy/observe', async (route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as { imageDataUrl: string; sourceReference: string };
    const sha = createHash('sha256').update(Buffer.from(body.imageDataUrl.split(',')[1]!, 'base64')).digest('hex');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ contract: 'unfold.anatomy_observation.v1', status: 'review_required', observation: bindAnatomySource(base, body.sourceReference, sha), meta: { model: 'mock', requestId: 'mock' } }) });
  });
  await page.goto(`${BASE}/anatomy?debug-anatomy`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => (document.querySelector('#anatomy-source-image') as HTMLImageElement | null)?.naturalWidth! > 0);
  await page.locator('#analyse-image').click();
  await page.waitForSelector('#review-list [data-review-choice]');
  const choices = page.locator('#review-list [data-review-choice]');
  const count = await choices.count(); assert.equal(count, 2);
  await choices.nth(0).selectOption('accept');
  assert.equal(await page.locator('#build-scene').isEnabled(), false, 'incomplete review stays blocked');
  await choices.nth(1).selectOption('correct');
  assert.equal(await page.locator('#build-scene').isEnabled(), false, 'a correction without a corrected component stays blocked');
  await page.locator('#review-list .anatomy-review-item').nth(1).locator('[data-correction]').selectOption('left-ventricle');
  assert.equal(await page.locator('#build-scene').isEnabled(), true, 'choosing the corrected component completes the review');
  await page.locator('#review-list .anatomy-review-item').nth(1).locator('[data-correction]').selectOption('');
  assert.equal(await page.locator('#build-scene').isEnabled(), false, 'clearing it blocks the gate again');
  console.log('PASS review gate follows the correction selector');
} catch (error) { console.error(error); process.exitCode = 1; } finally { await browser.close(); }
