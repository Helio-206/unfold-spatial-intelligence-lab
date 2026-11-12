/**
 * Living Intelligence in the real /living: open a Space (built from several views, no model call) -> understand (functional hypotheses, user-defined joint) -> move (joint
 * slider on the SAME scene, validated against the analytic chord ratio) -> limits -> experiment (reproducible) -> ask (simulated planner, labelled) -> change structure through
 * the Spatial Core (preview -> authorise -> transaction -> undo) -> save -> reopen: the mechanism and the experiments come back.
 * Run: npx tsx tests/e2e/living-intelligence.pw.ts
 */
import { chromium } from 'playwright-core';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createMetaServer } from '../../server/meta-server';

const out = resolve(process.env.UNFOLD_LI_OUT ?? 'reports/living-intelligence/e2e'), asset = process.env.UNFOLD_RE_ASSET ?? 'BoomBox';
mkdirSync(resolve(out, 'inputs'), { recursive: true });
let providerCalls = 0;
const backend = createMetaServer({ apiKey: 'fixture-key-not-real', fetchImpl: (async () => { providerCalls++; throw new Error('paid provider must not be called'); }) as unknown as typeof fetch });
await new Promise<void>((r) => backend.listen(0, '127.0.0.1', r));
process.env.UNFOLD_API_TARGET = `http://127.0.0.1:${(backend.address() as { port: number }).port}`;
const port = Number(process.env.UNFOLD_LI_PORT ?? 5173);
const vite = await createServer({ server: { host: '127.0.0.1', port, strictPort: true }, logLevel: 'error' });
await vite.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const results: Array<{ step: string; verdict: 'PASS' | 'FAIL'; detail: string }> = [];
const record = (step: string, ok: boolean, detail: string) => { results.push({ step, verdict: ok ? 'PASS' : 'FAIL', detail }); console.log(`${ok ? 'PASS' : 'FAIL'} ${step} — ${detail}`); };


const maker = await browser.newPage({ viewport: { width: 400, height: 300 } });
await maker.goto(`http://127.0.0.1:${port}/scripts/benchmark/reality-render.html`);
await maker.waitForFunction(() => (window as never as { __renderReady?: boolean }).__renderReady === true, null, { timeout: 60_000 });
const urls = await maker.evaluate(([url, a]) => (window as never as { __render: (u: string, a: number[], o: object) => Promise<string[]> }).__render(url as string, a as number[], { width: 400, height: 300, elevationDeg: 20 }), [`/reports/reality-engine/benchmark/assets/${asset}/${asset}.glb`, Array.from({ length: 8 }, (_, i) => i * 45)] as const);
const files = urls.map((u, i) => { const p = resolve(out, 'inputs', `view-${String(i).padStart(2, '0')}.png`); writeFileSync(p, Buffer.from(u.split(',')[1]!, 'base64')); return p; }); await maker.close();

const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }); await page.addInitScript('window.__name = (f) => f;');
const errors: string[] = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`http://127.0.0.1:${port}/living?debug-living=1&rm=1`, { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-space="open"]', { timeout: 60_000 }); await page.click('[data-space="open"]'); await page.waitForSelector('[data-sp="reality"]'); await page.click('[data-sp="reality"]'); await page.waitForSelector('[data-reality-intake]');
await page.fill('#rl-title', 'Objecto para mecanismo'); await page.fill('#rl-elev', '20'); await page.dispatchEvent('#rl-elev', 'change'); await page.setInputFiles('#rl-files', files);
await page.waitForFunction(() => document.querySelector('#rl-files')?.closest('label')?.textContent?.includes('8 vista'), null, { timeout: 60_000 });
await page.click('[data-rl="analyse"]'); await page.waitForSelector('[data-rl-canvas="7"]', { timeout: 60_000 });
// two assisted corrections guarantee a multi-part object whatever the watershed decides: split the first part by the x and the y plane (human edits, versioned)
await page.click('[data-rl="parts-open"]'); await page.waitForSelector('[data-rl-parts]'); for (const axis of ['x', 'y']) { const n = await page.locator('[data-rl-part]').count(); await page.selectOption('#rl-split-axis', axis); await page.click('[data-rl="part-split"]'); await page.waitForFunction((k) => document.querySelectorAll('[data-rl-part]').length > (k as number), n, { timeout: 30_000 }); }
if (await page.locator('#rl-ack-low').count()) await page.check('#rl-ack-low');
await page.click('[data-rl="build"]'); await page.waitForSelector('.sp-root[data-phase="review"]', { timeout: 120_000 }); await page.click('[data-sp="keep-all"]'); await page.check('#sp-ack'); await page.click('[data-sp="build"]');
await page.waitForFunction(() => (window as never as { __workspace: { spaceActive: boolean } }).__workspace.spaceActive, null, { timeout: 120_000 });
await page.waitForFunction(() => (window as never as { __space: { layer: { synced: boolean } | null } }).__space.layer?.synced === true, null, { timeout: 60_000 });
await page.waitForSelector('[data-living-intelligence]', { timeout: 30_000 }).catch(async (e) => { await page.screenshot({ path: resolve(out, 'fail.png') }); console.log('ERRS', errors.join(' | ')); throw e; }); await page.waitForTimeout(1200);
await page.screenshot({ path: resolve(out, '01-space-with-panel.png') });
const parts = await page.evaluate(() => (window as never as { __space: { layer: { currentPlan: { components: Array<{ id: string }> } } } }).__space.layer.currentPlan.components.map((c) => c.id));
record('0 Space construído a partir de vistas, painel «Inteligência do objecto» presente na mesma cena', parts.length >= 2, `${parts.length} componentes`);

// 1. understand: hypotheses are labelled, nothing confirmed; a user-defined joint is "user"
await page.click('[data-act="propose-mech"]'); await page.waitForSelector('[data-msg]');
const hyp = await page.locator('[data-joint] [data-cat]').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.cat));
record('1a mecanismo proposto pela geometria: todas as juntas são «hipótese», nenhuma confirmada', hyp.every((c) => c === 'hypothesis'), `${hyp.length} juntas propostas, categorias ${[...new Set(hyp)].join(',') || '—'}`);
// the rigid guesses between the three parts would close a rigid triangle with the hinge: the person rejects them (each rejection is a recorded event), then states the hinge
while (await page.locator('[data-joint] [data-act="reject"]').count()) await page.locator('[data-joint] [data-act="reject"]').first().click();
await page.click('summary:has-text("Definir junta")'); await page.selectOption('[data-sel="parent"]', parts[0]!); await page.selectOption('[data-sel="child"]', parts[1]!); await page.selectOption('[data-sel="kind"]', 'revolute'); await page.selectOption('[data-sel="axis"]', 'y'); await page.fill('[data-sel="min"]', '-40'); await page.fill('[data-sel="max"]', '40');
await page.dispatchEvent('[data-sel="min"]', 'change'); await page.dispatchEvent('[data-sel="max"]', 'change'); await page.click('[data-act="add-joint"]');
const userJoint = await page.evaluate(() => { const c = (window as never as { __intelligence: { mechanism: { joints: Array<{ id: string; claim: { origin: string }; kind: string }> } } }).__intelligence; return c.mechanism.joints.filter((j) => j.claim.origin === 'user').map((j) => j.id); });
const userCat = await page.locator(`[data-joint="${userJoint[0]}"] [data-cat]`).getAttribute('data-cat');
record('1b junta definida pelo utilizador aparece como «indicado/confirmado por si»', userJoint.length === 1 && userCat === 'user', `${userJoint[0]} · ${userCat}`);

// 2. move: the same scene; chord ratio is analytic (2 r sin(theta/2) -> ratio sin(t2/2)/sin(t1/2)), scale free
const centres = async () => page.evaluate(([a, b]) => { const l = (window as never as { __space: { layer: { componentWorldCentre(id: string): number[] | null } } }).__space.layer; return { child: l.componentWorldCentre(b as string), parent: l.componentWorldCentre(a as string) }; }, [parts[0]!, parts[1]!] as const);
const rest = await centres();
const setSlider = async (v: number) => { await page.evaluate(([id, val]) => { const el = document.querySelector(`[data-act="slider"][data-id="${id}"]`) as HTMLInputElement; el.value = String(val); el.dispatchEvent(new Event('input', { bubbles: true })); }, [userJoint[0]!, v] as const); await page.waitForTimeout(150); };
const dist = (a: number[], b: number[]) => Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
await setSlider(0.3); const p1 = await centres(); await setSlider(0.6); const p2 = await centres(); await page.screenshot({ path: resolve(out, '02-moved.png') });
const c1 = dist(p1.child!, rest.child!), c2 = dist(p2.child!, rest.child!), expected = Math.sin(0.3) / Math.sin(0.15), parentMoved = dist(p2.parent!, rest.parent!);
const status = await page.getAttribute('[data-status]', 'data-status'), statusText = await page.locator('[data-status]').innerText();
record('2 mover a junta no Space move só o filho, e o deslocamento segue a rotação analítica (razão das cordas)', c1 > 1e-6 && Math.abs(c2 / c1 - expected) < 0.02 && parentMoved < 1e-9 && status === 'solved', `razão medida ${(c2 / c1).toFixed(4)} vs ${expected.toFixed(4)}, pai deslocado ${parentMoved.toExponential(1)}, estado ${status}`);
record('2b o painel diz que é cinemática e não simulação física, e em que se baseia', /não é uma simulação física/.test(statusText) && /Assenta em/.test(statusText), statusText.replace(/\s+/g, ' ').slice(0, 140));
await page.evaluate((id) => (window as never as { __intelligence: { setJoint(id: string, v: number): unknown } }).__intelligence.setJoint(id, 1.2), userJoint[0]!); await page.waitForTimeout(200); const over = await page.getAttribute('[data-status]', 'data-status'); const overText = await page.locator('[data-status]').innerText();
record('3 fora dos limites (40°): estado «limit_violated» visível, com o limite', over === 'limit_violated' && /fora de/.test(overText), `${over} · ${overText.replace(/\s+/g, ' ').slice(0, 100)}`);
await page.click('[data-act="reset"]'); const back = await centres();
record('3b repor devolve a posição original exactamente', dist(back.child!, rest.child!) < 1e-9, `desvio ${dist(back.child!, rest.child!).toExponential(1)}`);

// 4. experiments: reproducible; dynamics refuses without parameters; hypothetical is labelled
await page.click('[data-sec="experiments"] summary'); await page.waitForSelector('[data-act="run-sweep"]', { state: 'visible' }); await page.click('[data-act="run-sweep"]'); await page.waitForSelector('[data-exp]');
await page.click('[data-act="repro"]'); const repro = await page.locator('[data-repro]').first().innerText();
record('4a experiência de varrimento corre e REPRODUZ com resultado idêntico', /reproduzida: resultado idêntico/.test(repro), repro);
await page.click('[data-act="run-dyn"]'); const needText = await page.locator('[data-need]').innerText();
record('4b dinâmica sem parâmetros não corre como física e diz o que falta', /precisa de/.test(needText) && /gravidade/.test(needText), needText.replace(/\s+/g, ' ').slice(0, 140));
await page.click('[data-act="mass-hyp"]'); await page.click('[data-act="run-dyn"]'); await page.waitForFunction(() => /HIPOTÉTICA/.test(document.querySelector('[data-sec="experiments"]')?.textContent ?? ''), null, { timeout: 30_000 });
record('4c com massa assumida a experiência fica marcada HIPOTÉTICA', true, 'etiqueta presente');

// 5. ask: grounded, simulated planner labelled; proposals never apply by themselves
const planBefore = await page.evaluate(() => JSON.stringify((window as never as { __space: { layer: { currentPlan: unknown } } }).__space.layer.currentPlan));
const ask = async (q: string) => { const n = await page.locator('[data-turn]').count(); await page.fill('[data-ask-input]', q); await page.click('[data-ask] button'); await page.waitForFunction((k) => document.querySelectorAll('[data-turn]').length >= (k as number) + 1, n, { timeout: 30_000 }); };
await ask('Porque é que esta peça não consegue rodar mais de 90 graus?');
const turnText = await page.locator('[data-turn]').last().innerText(), cats = await page.locator('[data-turn]').last().locator('[data-stmt-cat]').evaluateAll((els) => els.map((e) => `${(e as HTMLElement).dataset.stmtCat}:${(e as HTMLElement).dataset.grounded}`));
record('5 pergunta ao objecto: resposta calculada e fundamentada, rotulada SIMULADO (não é o Muse Spark)', /SIMULADO/.test(turnText) && cats.some((c) => c === 'computed:true') && /limite|sobrepõem|solução/.test(turnText), cats.join(' '));
await ask('Move esta articulação 30 graus'); const proposals = await page.locator('[data-proposal]').count(); const planAfterAsk = await page.evaluate(() => JSON.stringify((window as never as { __space: { layer: { currentPlan: unknown } } }).__space.layer.currentPlan));
record('5b uma proposta de movimento fica pendente: nada é aplicado ao Space', proposals >= 1 && planAfterAsk === planBefore, `${proposals} proposta(s), plano idêntico ${planAfterAsk === planBefore}`);
await page.screenshot({ path: resolve(out, '03-ask.png') });

// 6. structure through the Spatial Core: preview -> authorise -> commit -> undo
const target = parts.at(-1)!; await page.evaluate((id) => (window as never as { __workspace: { select(id: string): void } }).__workspace.select(id), target); await page.waitForTimeout(400);
await page.click('[data-sec="structure"] summary'); await page.click('[data-act="remove"]'); await page.waitForSelector('.sp-pending, [data-apply]', { timeout: 15_000 });
const countBefore = parts.length;
await page.evaluate(() => { const a = document.querySelector('[data-auth]') as HTMLInputElement | null; if (a && !a.checked) a.click(); }); await page.screenshot({ path: resolve(out, '05-pending.png') }); if (await page.locator('[data-reality-review] [data-rr="toggle"]').count()) await page.click('[data-reality-review] [data-rr="toggle"]'); /* the Reality review panel floats over the inspector at this width */ await page.click('[data-apply]', { timeout: 8000 });
await page.waitForFunction((n) => (window as never as { __space: { layer: { currentPlan: { components: unknown[] } } } }).__space.layer.currentPlan.components.length === (n as number) - 1, countBefore, { timeout: 30_000 });
const mechNote = await page.evaluate(() => (window as never as { __intelligence: { mechanism: { parts: string[] } | null } }).__intelligence.mechanism?.parts.length);
record('6a remover um componente é uma transacção do Spatial Core (pré-visualização, autorização, commit) e o mecanismo acompanha', mechNote === countBefore - 1, `componentes ${countBefore} → ${countBefore - 1}, partes do mecanismo ${mechNote}`);
await page.evaluate(() => (window as never as { __space: { layer: { undo(): Promise<boolean> } } }).__space.layer.undo()); await page.waitForFunction((n) => (window as never as { __space: { layer: { currentPlan: { components: unknown[] } } } }).__space.layer.currentPlan.components.length === (n as number), countBefore, { timeout: 30_000 });
record('6b desfazer repõe o componente removido', true, `componentes de novo ${countBefore}`);

// 7. save and reopen: mechanism and experiments come back
const expBefore = await page.locator('[data-exp]').count();
const saved = await page.evaluate(async () => { const s = (window as never as { __space: { save(): Promise<boolean>; savedId: string | null; openRecord(id: string): Promise<boolean> } }).__space; const ok = await s.save(), id = s.savedId; return { ok, id, reopened: id ? await s.openRecord(id) : false }; });
await page.waitForSelector('[data-living-intelligence]', { timeout: 30_000 }); await page.waitForTimeout(1500);
const after = await page.evaluate(() => { const c = (window as never as { __intelligence: { mechanism: { joints: Array<{ claim: { origin: string } }> } | null; experiments: Array<{ id: string }> } }).__intelligence; return { joints: c.mechanism?.joints.length ?? 0, experiments: c.experiments.length, userJoints: c.mechanism?.joints.filter((j) => j.claim.origin === 'user').length ?? 0 }; });
await page.click('[data-sec="experiments"] summary'); await page.click('[data-act="repro"]'); 
const reRepro = await page.locator('[data-repro]').first().innerText();
await page.screenshot({ path: resolve(out, '04-reopened.png') });
record('7 guardar e reabrir: o mecanismo (com a origem das juntas) e as experiências voltam, e a experiência ainda reproduz', saved.ok && saved.reopened && after.userJoints === 1 && after.experiments >= expBefore && /idêntico/.test(reRepro), `save=${saved.ok} reopen=${saved.reopened} juntas ${after.joints} (utilizador ${after.userJoints}) experiências ${after.experiments} · ${reRepro}`);
record('8 sem erros de browser', errors.length === 0, errors.join(' | ') || 'limpo');
record('9 nenhuma chamada paga (o agente correu simulado)', providerCalls === 0, `provider=${providerCalls}`);
writeFileSync(resolve(out, 'e2e-result.json'), JSON.stringify({ results }, null, 2));
await browser.close(); await vite.close(); await new Promise<void>((r) => backend.close(() => r()));
if (results.some((r) => r.verdict === 'FAIL')) process.exit(1);
