// V4 E1 browser integration against the REAL local backend:
//   browser -> Vite -> /api proxy -> createMetaServer with a persistent review store file.
// Only the paid plan-generation route is simulated. Adopt, review creation, decisions, persistence
// across a page reload and solver eligibility all use the real HTTP server. No paid calls.
// Run: node tests/e2e/v4-e1-review-browser.pw.mjs   (spawns and stops its own backend + Vite)
import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const backendPort = 8900, webPort = 5303;
const out = process.env.UNFOLD_V4_E1_OUT ?? `/tmp/unfold-v4-e1-browser-${process.pid}`; await mkdir(out, { recursive: true });
const children = [];
const start = (command, args, env, name) => {
  const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  child.stdout.on('data', (d) => process.stdout.write(`[${name}] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[${name}] ${d}`));
  children.push(child); return child;
};
const waitFor = async (url, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  for (;;) { try { const r = await fetch(url); if (r.ok) return; } catch { /* not up yet */ } if (Date.now() > deadline) throw new Error(`timeout waiting for ${url}`); await new Promise((r) => setTimeout(r, 250)); }
};

let browser;
try {
  start('./node_modules/.bin/tsx', ['server/index.ts'], { UNFOLD_BACKEND_PORT: String(backendPort), UNFOLD_LOCAL_TOKEN_FILE: `${out}/local-token`, UNFOLD_ACCEPTANCE_BUDGET_FILE: `${out}/budget.json`, UNFOLD_REVIEW_STORE_FILE: `${out}/reviews.json`, UNFOLD_LOCAL_ORIGINS: `http://127.0.0.1:${webPort}`, MODEL_API_KEY: '' }, 'backend');
  start('./node_modules/.bin/vite', ['--host', '127.0.0.1', '--port', String(webPort)], { UNFOLD_API_TARGET: `http://127.0.0.1:${backendPort}` }, 'vite');
  await waitFor(`http://127.0.0.1:${backendPort}/api/health`);
  await waitFor(`http://127.0.0.1:${webPort}/living`);

  const input = JSON.parse(await readFile('reports/fidelity-v4/hierarchical/plans/excavator-input.json', 'utf8'));
  // The prompt typed in this run is the plan's source: bind the fixture plan to its actual bytes so
  // the server-side source-hash verification is exercised, not bypassed.
  const { createHash } = await import('node:crypto');
  input.plan.source = { kind: 'text', sha256: createHash('sha256').update('Experiência local E1 com servidor real.', 'utf8').digest('hex') };
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROMIUM_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/spatial/v2/plan', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(input) }));

  const buildSpace = async () => {
    await page.goto(`http://127.0.0.1:${webPort}/living?debug-living&experimental-v4&rm=1`, { waitUntil: 'networkidle' });
    await page.click('[data-space="open"]'); await page.fill('#sp-text', 'Experiência local E1 com servidor real.'); await page.click('[data-sp="submit"]');
    await page.waitForSelector('.sp-root[data-phase="review"]'); await page.click('[data-sp="keep-all"]'); await page.check('#sp-ack'); await page.click('[data-sp="build"]');
    await page.waitForFunction(() => window.__space.session && window.__space.layer && !window.__space.layer.isBusy, null, { timeout: 40_000 });
  };
  await buildSpace();

  // Open the human-review panel from the workspace tools and decide on the first subject.
  await page.click('[data-extra="space-review"]');
  await page.waitForSelector('.sp-root[data-phase="relation-review"]');
  const panelText = await page.textContent('.sp-root');
  assert.match(panelText, /não há autenticação/);
  assert.match(panelText, /sha256/);
  const subjectCount = await page.locator('[data-review-decide="confirm"]').count();
  assert.ok(subjectCount > 0, `expected review subjects, got ${subjectCount}`);
  await page.fill('#review-name', 'Revisora E2E');
  await page.locator('[data-review-decide="confirm"]').first().click();
  await page.waitForFunction(() => window.__space.relationReview && window.__space.relationReview.decisions.length === 1 && window.__space.relationReview.reviewRevision === 1, null, { timeout: 20_000 });
  const reviewId = await page.evaluate(() => window.__space.currentReviewId);
  assert.ok(reviewId);
  // Policy continuity (E1.4): opening the review re-adopts the session as review_fenced, and the
  // server then rejects unfenced mutation attempts on it.
  const policy = await page.evaluate(async () => {
    const flow = window.__space;
    const unfenced = await fetch('/api/spatial/v2/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ contract: 'unfold.spatial-transaction.v2', sessionId: flow.session.id, baseRevision: flow.session.revision, idempotencyKey: 'e14-unfenced-1', operations: [{ contract: 'unfold.spatial-operation.v2', operationId: 'e14-op', kind: 'set-transform', componentId: flow.layer.currentPlan.components[0].id, nodeKey: null, value: flow.layer.currentPlan.components[0].transform }], provenance: { origin: 'inferred', evidence: 'policy probe' } }) }).then(async (r) => ({ status: r.status, code: (await r.json()).error?.code }));
    return { policy: flow.sessionPolicy, durability: flow.sessionDurability, unfenced };
  });
  assert.equal(policy.policy, 'review_fenced', JSON.stringify(policy));
  assert.equal(policy.unfenced.status, 403, JSON.stringify(policy));
  await page.screenshot({ path: `${out}/review-decided.png` });

  // Defer another subject (when one exists), then check solver eligibility through the real API.
  const deferred = await page.evaluate(async (id) => {
    const flow = window.__space;
    const subject = flow.relationReview.subjects.find((s) => !flow.relationReview.decisions.some((d) => d.subjectId === s.subjectId));
    if (!subject) return null;
    const reply = await fetch('/api/spatial/v2/reviews/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewId: id, baseReviewRevision: flow.relationReview.reviewRevision, subjectId: subject.subjectId, decision: 'defer', reviewerName: 'Revisora E2E' }) }).then((r) => r.json());
    return { subjectId: subject.subjectId, gate: reply.gate };
  }, reviewId);
  if (deferred) assert.ok(deferred.gate.deferredSubjectIds.includes(deferred.subjectId), JSON.stringify(deferred));

  // Full page reload: rebuild the Space and reopen the review — the decisions must still be there.
  await buildSpace();
  await page.click('[data-extra="space-review"]');
  await page.waitForSelector('.sp-root[data-phase="relation-review"]');
  await page.waitForFunction((id) => window.__space.currentReviewId === id && window.__space.relationReview.decisions.length >= 1, reviewId, { timeout: 20_000 });
  const reopened = await page.evaluate(() => ({ decisions: window.__space.relationReview.decisions.length, reviewer: window.__space.relationReview.decisions[0].reviewer.displayName, authenticated: window.__space.relationReview.decisions[0].reviewer.authenticated }));
  assert.equal(reopened.reviewer, 'Revisora E2E');
  assert.equal(reopened.authenticated, false);

  // Human approval path with a review-fenced atomic commit (E1.2): propose -> authorise -> the
  // server verifies the exact review revision inside the transaction -> one revision, inferred
  // provenance kept, grouped undo restores the plan exactly.
  await page.evaluate(() => window.__space.closeRelationReview());
  // Decide every contradicted subject first: the server gate must be eligible for the fence to pass.
  await page.evaluate(async () => {
    const flow = window.__space;
    for (const subject of flow.relationReview.subjects.filter((s) => s.geometrySupport === 'contradicted')) {
      // A later decision supersedes an earlier defer: every contradicted subject ends confirmed.
      const reply = await fetch('/api/spatial/v2/reviews/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewId: flow.relationReview.reviewId, baseReviewRevision: flow.relationReview.reviewRevision, subjectId: subject.subjectId, decision: 'confirm', reviewerName: 'Revisora E2E' }) }).then((r) => r.json());
      flow.relationReview = reply.review;
    }
  });
  const fenced = await page.evaluate(async () => {
    const flow = window.__space, layer = flow.layer;
    const { spatialPlanFingerprintV2 } = await import('/src/universal-spatial/api-client.ts');
    const review = flow.relationReview;
    const fingerprint = await spatialPlanFingerprintV2(layer.currentPlan);
    const [a, b] = layer.currentPlan.components;
    const move = (component, dx) => ({ contract: 'unfold.spatial-operation.v2', operationId: `e12-${component.id}`.slice(0, 80), kind: 'set-transform', componentId: component.id, nodeKey: null, value: { ...component.transform, position: [component.transform.position[0] + dx, component.transform.position[1], component.transform.position[2]] } });
    const before = JSON.stringify(layer.currentPlan), revisionBefore = flow.session.revision;
    const proposed = layer.proposeSolverEdit([move(a, 0.2), move(b, -0.2)], 'E1.2 fenced', 'Browser solver fixture (inferred).', {
      reviewBinding: { reviewId: review.reviewId, reviewRevision: review.reviewRevision, planFingerprint: fingerprint, sourceSha256: layer.currentPlan.source.sha256 },
    });
    layer.authorise(true); await layer.applyEdit();
    const applied = { revision: flow.session.revision, provenance: layer.currentPlan.components[0].provenance.transform, evidence: layer.currentPlan.components[0].provenance.evidence };
    const undone = await layer.undo();
    return { proposed, before, revisionBefore, applied, undone, revisionAfterUndo: flow.session.revision, restored: JSON.stringify(layer.currentPlan) === before };
  });
  assert.equal(fenced.proposed, true);
  assert.equal(fenced.applied.revision, fenced.revisionBefore + 1, 'one revision for the fenced transaction');
  assert.equal(fenced.applied.provenance, 'inferred', 'authorised solver geometry stays inferred');
  assert.match(fenced.applied.evidence, /Authorisation: a person authorised/);
  assert.equal(fenced.undone, true);
  assert.equal(fenced.restored, true);
  // A stale fence is rejected by the server without mutation: replay the same binding after another decision.
  const staleFence = await page.evaluate(async () => {
    const flow = window.__space, layer = flow.layer;
    const review = flow.relationReview;
    const reply = await fetch('/api/spatial/v2/reviews/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ reviewId: review.reviewId, baseReviewRevision: review.reviewRevision, subjectId: review.subjects[0].subjectId, decision: 'defer', reviewerName: 'Revisora E2E' }) }).then((r) => r.json());
    flow.relationReview = reply.review;
    return { revision: flow.session.revision };
  });
  assert.ok(staleFence.revision >= 2);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `${out}/review-reopened.png` });
  process.stdout.write(`${JSON.stringify({ case: 'v4-e1-review-browser', reviewId: reviewId.slice(0, 8), subjects: subjectCount, reopened, errors }, null, 2)}\n`);
} finally {
  await browser?.close().catch(() => {});
  for (const child of children) child.kill('SIGTERM');
}
