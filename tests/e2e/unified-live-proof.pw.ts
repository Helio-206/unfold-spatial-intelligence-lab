import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createMetaServer } from '../../server/meta-server';

/**
 * LIVE proof: a real photograph, through the real UI, the real backend and the real Meta Muse Spark. This makes a PAID call.
 * It is not part of any suite and refuses to run without UNFOLD_LIVE=1. At most two Meta calls are allowed (the server's own budget).
 *
 *   UNFOLD_LIVE=1 UNFOLD_PHOTO=/path/to/photo.jpg [UNFOLD_ENV_FILE=/path/.env] npx tsx tests/e2e/unified-live-proof.pw.ts
 *
 * The path is browser -> Vite dev proxy (port 5173, the only origin the local guard accepts) -> backend -> Meta.
 * The key is read from the env file into this process only; it is never printed, written or sent to the browser.
 * The "review" is performed by this script, standing in for a person: it is NOT a human review and the report says so.
 */
// UNFOLD_LIVE_FAKE=1 dry-runs this very script against a provider double (no key, no cost) to check the script itself before a paid run.
const FAKE = process.env.UNFOLD_LIVE_FAKE === '1';
if (process.env.UNFOLD_LIVE !== '1' && !FAKE) { console.error('refusing to make a paid Meta call without UNFOLD_LIVE=1'); process.exit(2); }
const out = resolve(process.env.UNFOLD_LIVE_OUT ?? 'reports/unified-workspace/live');
mkdirSync(out, { recursive: true });
const photoPath = process.env.UNFOLD_PHOTO!; if (!photoPath) throw new Error('UNFOLD_PHOTO is required');
const EXPECTED_SHA256 = process.env.UNFOLD_PHOTO_SHA256 ?? '0e8bb9e548026b363b00caba1f186a477a469a67b8f44fd5b8b845512fd159f5';

// key: env file -> this process only
const envFile = process.env.UNFOLD_ENV_FILE ?? resolve('..', 'unfold-spatial-intelligence-lab', '.env');
if (FAKE) process.env.MODEL_API_KEY = 'fixture-key-not-real';
if (!process.env.MODEL_API_KEY) { const line = readFileSync(envFile, 'utf8').split('\n').find((l) => l.startsWith('MODEL_API_KEY=')); if (line) process.env.MODEL_API_KEY = line.slice('MODEL_API_KEY='.length).trim().replace(/^["']|["']$/g, ''); }
const haveKey = Boolean(process.env.MODEL_API_KEY);
const photo = readFileSync(photoPath);
const sha256 = createHash('sha256').update(photo).digest('hex');
const dims = (() => { let o = 2; while (o + 9 < photo.length) { if (photo[o] !== 0xff) { o++; continue; } const m = photo[o + 1]!; const len = (photo[o + 2]! << 8) | photo[o + 3]!; if ([0xc0, 0xc1, 0xc2].includes(m)) return { height: (photo[o + 5]! << 8) | photo[o + 6]!, width: (photo[o + 7]! << 8) | photo[o + 8]! }; o += 2 + len; } return null; })();
const record: Record<string, unknown> = { DRY_RUN_WITH_PROVIDER_DOUBLE: FAKE, executedAt: new Date().toISOString(), keyAvailable: haveKey, photo: { source: 'https://commons.wikimedia.org/wiki/File:Doosan_tracked_excavator.jpg', sha256, expectedSha256: EXPECTED_SHA256, shaMatches: sha256 === EXPECTED_SHA256, bytes: photo.length, ...dims, mime: 'image/jpeg', note: 'Wikimedia Commons file as used by the PR #17 evidence; licence on the file page.' } };
const finish = (verdictIn: string, extra: Record<string, unknown> = {}) => { const verdict = FAKE ? `DRY RUN WITH A PROVIDER DOUBLE, NOT A META CALL. ${verdictIn.replace('real photo -> Meta Muse Spark', 'photo -> provider double')}` : verdictIn; Object.assign(record, { verdict }, extra); writeFileSync(join(out, 'run.json'), JSON.stringify(record, null, 2)); console.log(`${verdict}\n${JSON.stringify(record, null, 2).slice(0, 1800)}`); };
if (!haveKey) { finish('NOT VERIFIED: MODEL_API_KEY not available'); process.exit(0); }

const fakeProvider = async () => new Response(JSON.stringify({ id: 'req-dry-run', status: 'completed', output_text: JSON.stringify((await import('../../src/living/reconstruction/observation')).createOfflineImageObservation('image', 'dry-run', 'a'.repeat(64))), usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }), { status: 200, headers: { 'content-type': 'application/json' } });
const backend = createMetaServer({ maxMetaCalls: 2, ...(FAKE ? { fetchImpl: fakeProvider as unknown as typeof fetch } : {}) });
await new Promise<void>((r) => backend.listen(0, '127.0.0.1', r));
const backendPort = (backend.address() as { port: number }).port;
process.env.UNFOLD_API_TARGET = `http://127.0.0.1:${backendPort}`;
const vite = await createServer({ server: { host: '127.0.0.1', port: 5173, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const exchanges: Array<{ action: string; status: number; ms: number; body: any }> = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', async (r) => { if (!r.url().endsWith('/api/living/reconstruction')) return; const req = r.request(); let body: any = null; try { body = await r.json(); } catch { /* not json */ } exchanges.push({ action: req.postDataJSON()?.action ?? 'propose', status: r.status(), ms: Math.round(r.request().timing().responseEnd > 0 ? r.request().timing().responseEnd : 0), body }); });
  await page.goto('http://127.0.0.1:5173/living?debug-living=1&rm=1&agent=fixture');
  await page.waitForFunction(() => (window as any).__experience?.ready, null, { timeout: 120000 });
  assertEmpty: { const empty = await page.evaluate(() => ({ phase: (window as any).__experience.phase(), machine: (window as any).__experience.runtime.stage.machineVisible, workspace: document.querySelectorAll('.uw-root').length })); if (empty.phase !== 'empty' || empty.machine || empty.workspace) throw new Error(`not empty: ${JSON.stringify(empty)}`); }
  await page.locator('[data-kind="image"]').click();
  await page.setInputFiles('#ux-file', { name: 'Doosan_tracked_excavator.jpg', mimeType: 'image/jpeg', buffer: photo });
  await page.locator('.ux-preview img').waitFor();
  await page.screenshot({ path: join(out, '01-photo-selected.png') });
  const t0 = Date.now();
  await page.locator('[data-flow="submit"]').click();
  await page.waitForFunction(() => ['review', 'failed', 'unavailable', 'not_identified'].includes((window as any).__experience.phase()), null, { timeout: 150000 });
  const wallMs = Date.now() - t0;
  const phase = await page.evaluate(() => (window as any).__experience.phase());
  const propose = exchanges.find((e) => e.action === 'propose');
  Object.assign(record, { proposeRequest: { sourceKind: 'image', mode: 'live', via: 'UI file input -> Vite proxy -> backend -> Meta Muse Spark' }, proposeResponse: { status: propose?.status, wallClockMs: wallMs, uiPhase: phase, contract: propose?.body?.contract, sessionId: propose?.body?.sessionId, mode: propose?.body?.mode, status_: propose?.body?.status, meta: propose?.body?.meta ?? null, error: propose?.body?.error ?? null } });
  await page.screenshot({ path: join(out, '02-after-meta.png') });
  if (phase !== 'review') { finish(`PROPOSAL DID NOT REACH REVIEW (ui phase: ${phase})`, { pageErrors: errors }); }
  else {
    const flow = await page.evaluate(() => { const f = (window as any).__experience.flow(); return { provenance: f.provenance, sessionId: f.sessionId, observation: f.observation }; });
    writeFileSync(join(out, 'observation.json'), JSON.stringify(flow.observation, null, 2));
    const o = flow.observation;
    Object.assign(record, { observed: { machineType: o.machineType, entities: o.entities.map((e: any) => ({ id: e.id, kind: e.kind, label: e.label, status: e.status, confidence: e.confidence, evidence: e.evidence.length })), relations: o.relations.length, dimensions: o.dimensions.length, requests: o.requests.length, hypotheses: o.hypotheses.map((h: any) => h.statement), unknowns: o.unknowns }, uiProvenance: flow.provenance, sessionId: flow.sessionId });
    await page.screenshot({ path: join(out, '03-review.png') });

    // the stand-in reviewer (a script, not a person): see the policy in the report
    const decisions = await page.evaluate(() => {
      const x = (window as any).__experience; const log: string[] = [];
      for (const i of x.review().items) {
        if (i.status === 'hypothesis') { x.dispatch({ type: 'decide', id: i.id, decision: 'confirmed' }); log.push(`confirmed hypothesis ${i.id} (${i.kind})`); }
        else if (i.status === 'unknown') { x.dispatch({ type: 'correct', id: i.id, correction: { kind: i.kind, label: `${i.label} (indicado pelo revisor-script)` } }); log.push(`corrected unknown ${i.id} to kind ${i.kind}`); }
        else log.push(`left observed ${i.id} (${i.kind}) as observed`);
      }
      return { log, readiness: x.readiness() };
    });
    Object.assign(record, { scriptedReview: { performedBy: 'script (NOT a person)', policy: 'confirm every hypothesis entity; correct each unknown entity to its own kind; leave observed entities as observed; reject relations/statements; width 1.40 m declared fictitious', ...decisions } });
    if (decisions.readiness.status !== 'ready_for_engine') { finish(`REVIEW GATE 1 NOT READY: ${JSON.stringify(decisions.readiness)}`, { pageErrors: errors }); }
    else {
      await page.locator('#ux-enter').click();
      await page.fill('#gw-reviewer', 'revisor-script (nao e uma pessoa)'); await page.check('#gw-family'); await page.check('#gw-bucket');
      await page.fill('#gw-width', '1.4'); await page.fill('#gw-basis', 'valor ficticio do ensaio; a fotografia nao tem escala');
      await page.locator('[data-gw="extra-all"][data-decision="reject"]').click();
      await page.screenshot({ path: join(out, '04-server-step.png') });
      await page.locator('#ux-enter').click();
      await page.waitForFunction(() => (window as any).__experience.phase() === 'lab' || /bloqueou|expirou|motor n|falh|não passou/i.test(document.querySelector('#ux-gw-msg')?.textContent ?? ''), null, { timeout: 90000 });
      const reached = await page.evaluate(() => (window as any).__experience.phase());
      const review = exchanges.find((e) => e.action === 'review');
      Object.assign(record, { reviewResponse: { status: review?.status, contract: review?.body?.contract, validation: review?.body?.validation, provenance: review?.body?.provenance, geometry: review?.body?.geometry, reasons: review?.body?.reasons ?? null } });
      if (reached !== 'lab') { Object.assign(record, { stoppedAt: await page.locator('#ux-gw-msg').innerText() }); finish('REVIEW DID NOT OPEN THE LAB', { pageErrors: errors }); }
      else {
        await page.waitForFunction(() => (window as any).__workspace?.partPoses, null, { timeout: 60000 }); await page.waitForTimeout(1200);
        const lab = await page.evaluate(() => { const ws = (window as any).__workspace; const g = ws.model.parts.get('bucket'); const V = g.position.constructor; g.updateMatrixWorld(true); let min = Infinity, max = -Infinity; g.traverse((m: any) => { if (!m.isMesh) return; m.geometry.computeBoundingBox(); const bb = m.geometry.boundingBox; for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) { const v = new V(x, y, z).applyMatrix4(m.matrixWorld); min = Math.min(min, v.z); max = Math.max(max, v.z); } }); return { gates: document.querySelector('#ux-lab-gates')?.textContent, notice: document.querySelector('.uw-notices')?.textContent, look: ws.look, parts: ws.model.parts.size, bucketMeshWidthM: max - min, assemblyId: ws.options.assembly.id, engine: ws.engineFrame().solver }; });
        await page.screenshot({ path: join(out, '05-lab.png') });
        await page.evaluate(() => { const ws = (window as any).__workspace; ws.select('bucket'); ws.frameSelection(); }); await page.waitForTimeout(1500);
        await page.screenshot({ path: join(out, '06-lab-bucket.png') });
        finish('LIVE PATH COMPLETED: real photo -> Meta Muse Spark -> review (scripted) -> contract -> engine -> real workspace', { lab, pageErrors: errors });
      }
    }
  }
} finally { await browser.close(); await vite.close(); await new Promise<void>((r) => backend.close(() => r())); }
