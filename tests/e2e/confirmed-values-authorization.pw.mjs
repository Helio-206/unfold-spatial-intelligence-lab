// E2E real da autorização de valores confirmados na cena espacial (PR "fix/confirmed-values-authorization").
// Abre o editor em Chrome (Playwright), com a Meta SIMULADA: todos os /api/** são interceptados no browser, o spatial-agent
// responde com propostas fabricadas, e qualquer pedido para fora de localhost faz falhar a verificação "rede". Nenhuma chamada paga.
//
// Como correr (não há dependência nova no package.json):
//   npm i --no-save playwright-core@1.49.1
//   UNFOLD_API_TARGET=http://127.0.0.1:9 npx vite --port 5199 --strictPort &
//   node tests/e2e/confirmed-values-authorization.pw.mjs
// Variáveis: UNFOLD_E2E_URL, UNFOLD_E2E_OUT (por omissão reports/confirmed-values-authorization), CHROME_PATH.
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BASE = process.env.UNFOLD_E2E_URL ?? 'http://127.0.0.1:5199';
const OUT = resolve(process.env.UNFOLD_E2E_OUT ?? 'reports/confirmed-values-authorization');
const SHOTS = join(OUT, 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'unfold-e2e-'));
const makeSeed = (variant) => { const file = join(scratch, `seed-${variant}.json`); execFileSync(resolve('node_modules/.bin/tsx'), ['tests/e2e/confirmed-values-seed.ts', file, ...(variant === 'door-position' ? ['door-position'] : [])], { stdio: 'inherit' }); return readFileSync(file, 'utf8'); };
const seed = makeSeed('plain');
const seed2 = makeSeed('door-position');

const checks = [];
const findings = [];
const external = [];
let agentCalls = [];
let agentMode = 'resize';

function check(scenario, name, ok, observed) {
  checks.push({ scenario, name, ok: Boolean(ok), observed });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${scenario}] ${name}${ok ? '' : `  -> ${JSON.stringify(observed)}`}`);
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function openEditor(seedText = seed) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1180 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
  page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && u.protocol.startsWith('http')) external.push(r.url()); });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/spatial-agent') {
      const body = JSON.parse(route.request().postData() ?? '{}');
      agentCalls.push({ query: body.query, selectedId: body.scene?.selectedId });
      if (agentMode === 'unavailable') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'MODEL_API_KEY_MISSING', message: 'sem chave (simulado)' } }) });
      const target = { reference: 'selected', label: null, ordinal: null };
      const action = agentMode === 'remove'
        ? { kind: 'RemoveOpening', target, value: null, valueMode: null, unit: null, axis: null, opening: null }
        : { kind: 'Resize', target, value: 0.3, valueMode: 'increase_by', unit: 'm', axis: null, opening: null };
      const result = { schema: 'spatial_agent_result.v1', kind: 'PROPOSE_ACTION', text: agentMode === 'remove' ? 'Proponho remover a abertura seleccionada.' : 'Proponho aumentar a parede seleccionada em 30 cm.', basis: 'scene', evidenceIds: [body.scene.selectedId], question: null, action };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result, sceneRevisionId: body.scene.revisionId, meta: { simulated: true } }) });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: 'null' });
  });
  await page.goto(`${BASE}/demo`);
  await page.waitForSelector('#demo-open-spatial');
  await page.evaluate((s) => localStorage.setItem('unfold-spatial-scene.v1', s), seedText);
  await page.click('#demo-open-spatial');
  await page.waitForSelector('#component-list [data-scene-node]', { timeout: 30000 });
  await page.waitForTimeout(800);
  return { page, context, errors };
}

const ui = (page) => page.evaluate(() => ({
  scene: document.querySelector('#scene-state')?.textContent ?? '',
  previewStatus: document.querySelector('#preview-status')?.textContent ?? '',
  commitDisabled: document.querySelector('#commit-preview')?.disabled,
  cmdState: document.querySelector('#demo-command-state')?.textContent ?? '',
  cmdMsg: document.querySelector('#demo-command-message')?.textContent ?? '',
  prov: document.querySelector('#node-provenance')?.textContent ?? '',
  spatial: document.querySelector('#spatial-status')?.textContent ?? '',
  nodes: [...document.querySelectorAll('#component-list [data-scene-node]')].map((e) => e.dataset.sceneNode),
}));
const stored = (page) => page.evaluate(() => localStorage.getItem('unfold-spatial-scene.v1'));
const storedScene = async (page) => JSON.parse(await stored(page)).scene;
const node = (scene, id) => scene.nodes.find((n) => n.id === id);
const shot = (page, name) => page.screenshot({ path: `${SHOTS}/${name}.png` });
async function select(page, id) { await page.click(`[data-scene-node="${id}"]`); await page.waitForSelector('#inspector:not([hidden])'); await page.waitForTimeout(300); }
async function command(page, text) { await page.fill('#demo-question', text); await page.click('#demo-submit'); }
const waitText = (page, selector, re, timeout = 15000) => page.waitForFunction(([s, source]) => new RegExp(source).test(document.querySelector(s)?.textContent ?? ''), [selector, re.source], { timeout }).then(() => true, () => false);

try {
  // ---------------------------------------------------------------- A. parede com valores confirmados, edição directa
  {
    const sc = 'A confirmada';
    const { page, context, errors } = await openEditor();
    await select(page, 'wall-a');
    const before = await ui(page);
    check(sc, 'o inspector mostra a proveniência verified', /verified/.test(before.prov), before.prov);
    await shot(page, '01-parede-confirmada-seleccionada');

    await page.fill('#wall-length', '11');
    await page.click('#preview-wall');
    await page.waitForFunction(() => document.querySelector('#commit-preview')?.disabled === false);
    const preview = await ui(page);
    check(sc, 'o preview não mexe na revisão canónica nem na persistência', preview.scene === before.scene && (await stored(page)) === seed, { before: before.scene, after: preview.scene });
    check(sc, 'o botão de confirmação está activo e a cena diz que ainda não foi alterada', preview.commitDisabled === false && /ainda não foi alterada/.test(preview.previewStatus), preview.previewStatus);
    check(sc, 'o preview avisa que toca em valores confirmados e que «Aplicar» autoriza', /Atenção: esta alteração toca em valores confirmados/.test(preview.previewStatus) && /Parede 1/.test(preview.previewStatus) && /geometria/.test(preview.previewStatus) && /comprimento/.test(preview.previewStatus) && /«Aplicar» autoriza/.test(preview.previewStatus), preview.previewStatus);
    await shot(page, '02-parede-confirmada-preview-a-aguardar-clique');

    await page.waitForTimeout(1500);
    const idle = await ui(page);
    check(sc, 'sem clique, passado algum tempo nada foi aplicado', idle.scene === before.scene && (await stored(page)) === seed, idle.scene);

    await page.click('#cancel-preview');
    const cancelled = await ui(page);
    check(sc, 'cancelar deixa tudo como estava', cancelled.scene === before.scene && (await stored(page)) === seed && cancelled.commitDisabled === true, cancelled);

    await page.fill('#wall-length', '11');
    await page.click('#preview-wall');
    await page.waitForFunction(() => document.querySelector('#commit-preview')?.disabled === false);
    await page.click('#commit-preview');
    const applied = await waitText(page, '#preview-status', /aplicada/);
    const after = await ui(page);
    check(sc, 'com o clique de confirmação a alteração é aplicada', applied, after.previewStatus + ' | ' + after.spatial);
    const scene = await storedScene(page);
    const wall = node(scene, 'wall-a');
    check(sc, 'a geometria passou a 11 m', wall.geometry.sizeM[0] === 11, wall.geometry.sizeM);
    check(sc, 'geometria confirmada ficou corrected, com o valor anterior, a evidência e o id da autorização', wall.geometry.provenance.validation === 'corrected' && wall.geometry.provenance.sourceValue?.sizeM?.[0] === 10 && /autorizada/.test(wall.geometry.provenance.evidence ?? '') && typeof wall.geometry.provenance.authorizationId === 'string', wall.geometry.provenance);
    const length = wall.component.properties.length;
    check(sc, 'o parâmetro length confirmado ficou corrected com sourceValue 10 e o mesmo authorizationId', length.value === 11 && length.provenance.validation === 'corrected' && length.provenance.sourceValue === 10 && length.provenance.authorizationId === wall.geometry.provenance.authorizationId, length.provenance);
    check(sc, 'nada ficou unreviewed nem voltou a verified na parede', !JSON.stringify(wall).includes('"validation":"verified"') && ![wall.geometry.provenance, length.provenance].some((p) => p.validation === 'unreviewed'), 'verified/unreviewed encontrados');
    const doorWidth = node(scene, 'door-a').component.properties.width;
    check(sc, 'a largura confirmada da porta não foi tocada (continua verified, sem authorizationId)', doorWidth.provenance.validation === 'verified' && doorWidth.provenance.authorizationId === undefined, doorWidth.provenance);
    check(sc, 'a revisão avançou', after.scene !== before.scene, { before: before.scene, after: after.scene });
    await shot(page, '03-parede-confirmada-apos-clique-corrected');
    check(sc, 'o botão de confirmação ficou desactivado depois de aplicar (sem segunda aplicação)', after.commitDisabled === true, after.commitDisabled);
    check(sc, 'sem erros de consola', errors.length === 0, errors);
    await context.close();
  }

  // ---------------------------------------------------------------- B. parede sem nada confirmado
  {
    const sc = 'B sem confirmados';
    const { page, context, errors } = await openEditor();
    await select(page, 'wall-b');
    const before = await ui(page);
    await page.fill('#wall-length', '9');
    await page.click('#preview-wall');
    await page.waitForFunction(() => document.querySelector('#commit-preview')?.disabled === false);
    check(sc, 'o preview NÃO traz aviso de valores confirmados', !/Atenção|confirmados/.test((await ui(page)).previewStatus), (await ui(page)).previewStatus);
    await shot(page, '04-parede-sem-confirmados-preview');
    await page.click('#commit-preview');
    const applied = await waitText(page, '#preview-status', /aplicada/);
    const after = await ui(page);
    check(sc, 'a alteração é aplicada com o clique de sempre', applied, after.previewStatus + ' | ' + after.spatial);
    const wall = node(await storedScene(page), 'wall-b');
    const provenances = [wall.geometry.provenance, wall.component.properties.length.provenance, wall.component.properties.height.provenance, wall.transform.provenance.translationM];
    check(sc, 'geometria e comprimento novos', wall.geometry.sizeM[0] === 9 && wall.component.properties.length.value === 9, wall.geometry.sizeM);
    check(sc, 'tudo continua unreviewed e sem authorizationId (como antes da mudança)', provenances.every((p) => p.validation === 'unreviewed' && p.authorizationId === undefined), provenances);
    check(sc, 'a revisão avançou', after.scene !== before.scene, { before: before.scene, after: after.scene });
    await shot(page, '05-parede-sem-confirmados-apos-clique');
    check(sc, 'sem erros de consola', errors.length === 0, errors);
    await context.close();
  }

  // ---------------------------------------------------------------- C. remoção directa de uma abertura com valor confirmado
  {
    const sc = 'C remover porta confirmada';
    const { page, context, errors } = await openEditor();
    await select(page, 'door-a');
    const before = await ui(page);
    await page.click('#remove-opening');
    await page.waitForFunction(() => document.querySelector('#commit-preview')?.disabled === false);
    const preview = await ui(page);
    check(sc, 'o preview de remoção não altera a cena nem a persistência', preview.scene === before.scene && (await stored(page)) === seed, preview.scene);
    check(sc, 'o preview de remoção avisa o que toca (Porta: largura)', /Porta: largura/.test(preview.previewStatus) && /«Aplicar» autoriza/.test(preview.previewStatus), preview.previewStatus);
    await shot(page, '06-remocao-de-porta-confirmada-preview');
    await page.waitForTimeout(1000);
    check(sc, 'sem clique a porta continua na cena', (await ui(page)).nodes.includes('door-a'), (await ui(page)).nodes);
    await page.click('#commit-preview');
    const applied = await waitText(page, '#preview-status', /aplicada/);
    const after = await ui(page);
    check(sc, 'com o clique a porta é removida', applied && !after.nodes.includes('door-a'), after.nodes);
    check(sc, 'sem erros de consola', errors.length === 0, errors);
    await context.close();
  }

  // ---------------------------------------------------------------- D. caminho Muse (resposta simulada)
  {
    const sc = 'D Muse numa parede sem confirmados';
    agentMode = 'resize'; agentCalls = [];
    const { page, context, errors } = await openEditor();
    await select(page, 'wall-b');
    const before = await ui(page);
    await command(page, 'Aumenta esta parede em 30 centímetros.');
    const gotPreview = await page.waitForFunction(() => document.querySelector('#commit-preview')?.disabled === false, null, { timeout: 15000 }).then(() => true, () => false);
    const preview = await ui(page);
    check(sc, 'o Muse (simulado) foi consultado uma vez', agentCalls.length === 1, agentCalls);
    check(sc, 'a proposta do Muse gera um preview a aguardar confirmação', gotPreview && /AWAITING|PREVIEW/.test(preview.cmdState), preview);
    check(sc, 'o preview não altera a cena', preview.scene === before.scene && (await stored(page)) === seed, preview.scene);
    await shot(page, '07-muse-proposta-numa-parede-sem-confirmados-preview');
    await page.click('#commit-preview');
    const applied = await waitText(page, '#preview-status', /aplicada/);
    check(sc, 'só com o clique a proposta é aplicada', applied, (await ui(page)).previewStatus);
    const wall = node(await storedScene(page), 'wall-b');
    check(sc, 'a parede ficou com 10,3 m', Math.abs(wall.geometry.sizeM[0] - 10.3) < 1e-9, wall.geometry.sizeM);
    check(sc, 'o conteúdo criado pelo Muse fica unreviewed, sem authorizationId', [wall.geometry.provenance, wall.component.properties.length.provenance].every((p) => p.validation === 'unreviewed' && p.authorizationId === undefined), wall.geometry.provenance);
    check(sc, 'sem erros de consola', errors.length === 0, errors);
    await context.close();
  }
  {
    const sc = 'D Muse numa parede confirmada';
    agentMode = 'resize'; agentCalls = [];
    const { page, context, errors } = await openEditor();
    await select(page, 'wall-a');
    const before = await ui(page);
    await command(page, 'Aumenta esta parede em 30 centímetros.');
    await waitText(page, '#demo-command-state', /REJECTED|ERROR/);
    await page.waitForTimeout(500);
    const blocked = await ui(page);
    check(sc, 'o Muse (simulado) foi consultado', agentCalls.length === 1, agentCalls);
    check(sc, 'a proposta que toca um valor confirmado é bloqueada (REJECTED)', blocked.cmdState === 'REJECTED', blocked.cmdState + ' | ' + blocked.cmdMsg);
    check(sc, 'a mensagem explica porquê (em português, sem o código cru) e diz que nenhuma revisão foi aplicada', /Muse/.test(blocked.cmdMsg) && /confirmou/.test(blocked.cmdMsg) && /inspector/.test(blocked.cmdMsg) && !/MACHINE_CANNOT/.test(blocked.cmdMsg) && /Nenhuma revisão foi aplicada/.test(blocked.cmdMsg), blocked.cmdMsg);
    check(sc, 'o botão de confirmação continua desactivado e não há preview', blocked.commitDisabled === true, blocked.commitDisabled);
    check(sc, 'a revisão e a persistência não mudaram', blocked.scene === before.scene && (await stored(page)) === seed, blocked.scene);
    await shot(page, '08-muse-proposta-bloqueada-parede-confirmada');
    check(sc, 'sem erros de consola', errors.length === 0, errors);
    await context.close();
  }
  {
    const sc = 'D Muse a remover uma abertura confirmada';
    agentMode = 'remove'; agentCalls = [];
    const { page, context, errors } = await openEditor();
    await select(page, 'door-a');
    const before = await ui(page);
    await command(page, 'Remove esta abertura.');
    await waitText(page, '#demo-command-state', /REJECTED|ERROR/);
    await page.waitForTimeout(500);
    const blocked = await ui(page);
    check(sc, 'a remoção proposta pelo Muse é bloqueada, com explicação', blocked.cmdState === 'REJECTED' && /Muse/.test(blocked.cmdMsg) && !/MACHINE_CANNOT/.test(blocked.cmdMsg), blocked.cmdState + ' | ' + blocked.cmdMsg);
    check(sc, 'a porta continua na cena, sem preview, e a persistência não mudou', blocked.nodes.includes('door-a') && blocked.commitDisabled === true && (await stored(page)) === seed && blocked.scene === before.scene, blocked);
    await shot(page, '09-muse-remocao-bloqueada-porta-confirmada');
    check(sc, 'sem erros de consola', errors.length === 0, errors);
    await context.close();
  }

  // ---------------------------------------------------------------- E. Muse indisponível: parser local = humano
  {
    const sc = 'E Muse indisponível (parser local)';
    agentMode = 'unavailable'; agentCalls = [];
    const { page, context, errors } = await openEditor();
    await select(page, 'wall-a');
    const before = await ui(page);
    await command(page, 'Aumenta esta parede para 12 metros');
    const gotPreview = await page.waitForFunction(() => document.querySelector('#commit-preview')?.disabled === false, null, { timeout: 15000 }).then(() => true, () => false);
    const preview = await ui(page);
    check(sc, 'o comando local gera um preview (não é tratado como modelo)', gotPreview, preview.cmdState + ' | ' + preview.cmdMsg);
    check(sc, 'o preview não altera a cena', preview.scene === before.scene && (await stored(page)) === seed, preview.scene);
    await shot(page, '10-parser-local-parede-confirmada-preview');
    await page.click('#commit-preview');
    const applied = await waitText(page, '#preview-status', /aplicada/);
    const after = await ui(page);
    check(sc, 'com o clique é aplicado', applied, after.previewStatus + ' | ' + after.spatial + ' | ' + after.cmdMsg);
    const wall = node(await storedScene(page), 'wall-a');
    check(sc, 'a parede confirmada ficou corrected, com authorizationId, a 12 m', wall.geometry.sizeM[0] === 12 && wall.geometry.provenance.validation === 'corrected' && typeof wall.geometry.provenance.authorizationId === 'string', wall.geometry.provenance);
    await shot(page, '11-parser-local-parede-confirmada-apos-clique');
    check(sc, 'sem erros de consola', errors.length === 0, errors);
    await context.close();
  }


  // ---------------------------------------------------------------- A2. mover uma parede confirmada sem mudar o tamanho
  {
    const sc = 'A2 mover sem alterar';
    const { page, context, errors } = await openEditor();
    await select(page, 'wall-a');
    const before = await ui(page);
    await page.fill('#wall-x', '7');
    await page.click('#preview-wall');
    await page.waitForFunction(() => document.querySelector('#commit-preview')?.disabled === false);
    const preview = await ui(page);
    check(sc, 'o preview não avisa de valores confirmados (só a posição muda, e não está confirmada)', !/Atenção|confirmados/.test(preview.previewStatus), preview.previewStatus);
    await page.click('#commit-preview');
    await waitText(page, '#preview-status', /aplicada/);
    const wall = node(await storedScene(page), 'wall-a');
    check(sc, 'a parede moveu-se para x = 7', Math.abs(wall.transform.translationM[0] - 7) < 1e-9, wall.transform.translationM);
    check(sc, 'a geometria e o comprimento confirmados continuam verified, sem authorizationId (não foram tocados)', wall.geometry.provenance.validation === 'verified' && wall.component.properties.length.provenance.validation === 'verified' && !JSON.stringify(wall).includes('authorizationId'), [wall.geometry.provenance, wall.component.properties.length.provenance]);
    await shot(page, '12-mover-parede-confirmada-sem-alterar-tamanho');
    check(sc, 'sem erros de consola', errors.length === 0, errors);
    await context.close();
  }

  // ---------------------------------------------------------------- F. gizmo na porta com a posição confirmada (comando único)
  {
    const sc = 'F gizmo na porta confirmada';
    const { page, context, errors } = await openEditor(seed2);
    await select(page, 'door-a');
    await page.waitForTimeout(900);
    const before = await ui(page);
    await page.mouse.move(822, 646); await page.waitForTimeout(200); await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) { await page.mouse.move(822 - 60 * i / 8, 646 - 35 * i / 8); await page.waitForTimeout(40); }
    await page.mouse.up(); await page.waitForTimeout(700);
    const preview = await ui(page);
    check(sc, 'arrastar o gizmo cria um preview e não altera a cena', preview.commitDisabled === false && preview.scene === before.scene && (await stored(page)) === seed2, preview);
    check(sc, 'o preview avisa que toca na posição confirmada da porta', /Porta: posição/.test(preview.previewStatus) && /«Aplicar» autoriza/.test(preview.previewStatus), preview.previewStatus);
    await shot(page, '13-gizmo-porta-confirmada-preview');
    await page.click('#commit-preview');
    await waitText(page, '#preview-status', /aplicada/);
    const door = node(await storedScene(page), 'door-a');
    const p = door.transform.provenance.translationM;
    check(sc, 'a posição confirmada ficou corrected, com valor anterior, autorização e evidência', p.validation === 'corrected' && Array.isArray(p.sourceValue) && typeof p.authorizationId === 'string' && /autorizada/.test(p.evidence), p);
    check(sc, 'a largura confirmada da porta não foi tocada', door.component.properties.width.provenance.validation === 'verified', door.component.properties.width.provenance);
    check(sc, 'sem erros de consola', errors.length === 0, errors);
    await context.close();
  }

  // ---------------------------------------------------------------- G. gizmo na parede com a geometria confirmada (só translação)
  {
    const sc = 'G gizmo na parede confirmada';
    const { page, context, errors } = await openEditor();
    await select(page, 'wall-a');
    const before = await ui(page);
    await page.mouse.move(868, 673); await page.waitForTimeout(200); await page.mouse.down();
    for (let i = 1; i <= 8; i += 1) { await page.mouse.move(868 + 70 * i / 8, 673); await page.waitForTimeout(40); }
    await page.mouse.up(); await page.waitForTimeout(700);
    const preview = await ui(page);
    check(sc, 'arrastar o gizmo cria um preview e não altera a cena', preview.commitDisabled === false && preview.scene === before.scene && (await stored(page)) === seed, preview);
    await page.click('#commit-preview');
    await waitText(page, '#preview-status', /aplicada/);
    const wall = node(await storedScene(page), 'wall-a');
    check(sc, 'a parede moveu-se e a geometria confirmada continua verified (só a posição mudou)', wall.transform.translationM[0] > 6.5 && wall.geometry.provenance.validation === 'verified' && wall.geometry.sizeM[0] === 10, { x: wall.transform.translationM[0], geometry: wall.geometry.provenance.validation });
    check(sc, 'sem erros de consola', errors.length === 0, errors);
    await context.close();
  }

  check('rede', 'nenhum pedido saiu para fora de localhost (nenhuma chamada à Meta)', external.length === 0, external);
} catch (error) {
  findings.push({ crash: String(error?.stack ?? error) });
  console.log('CRASH', error);
} finally {
  await browser.close();
  writeFileSync(join(OUT, 'result.json'), JSON.stringify({ checks, findings, external }, null, 2) + '\n');
  process.exitCode = checks.some((c) => !c.ok) || findings.length ? 1 : 0;
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} verificações passaram; ${failed.length} falharam.`);
}
