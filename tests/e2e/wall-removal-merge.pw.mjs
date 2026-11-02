// E2E real da remoção de uma parede que separa duas divisões (PR "feat/wall-removal-room-merge").
// Abre o editor em Chrome (Playwright) com a Meta SIMULADA: todos os /api/** são interceptados no browser, o spatial-agent responde
// com propostas fabricadas (ou como indisponível) e qualquer pedido para fora de localhost faz falhar a verificação "rede".
// Nenhuma chamada paga.
//
// Como correr (não há dependência nova no package.json):
//   npm i --no-save playwright-core@1.49.1
//   UNFOLD_API_TARGET=http://127.0.0.1:9 npx vite --port 5199 --strictPort &
//   node tests/e2e/wall-removal-merge.pw.mjs
// Variáveis: UNFOLD_E2E_URL, UNFOLD_E2E_OUT (por omissão reports/wall-removal-merge), CHROME_PATH, UNFOLD_E2E_ALL_SHOTS=1 (guarda todas as capturas).
import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const BASE = process.env.UNFOLD_E2E_URL ?? 'http://127.0.0.1:5199';
const OUT = resolve(process.env.UNFOLD_E2E_OUT ?? 'reports/wall-removal-merge');
const SHOTS = join(OUT, 'screenshots');
mkdirSync(SHOTS, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'unfold-e2e-merge-'));
const makeSeed = (variant) => {
  const file = join(scratch, `seed-${variant}.json`);
  execFileSync(resolve('node_modules/.bin/tsx'), ['tests/e2e/wall-removal-merge-seed.ts', file, ...(variant === 'plain' ? [] : [variant])], { stdio: 'ignore' });
  return { text: readFileSync(file, 'utf8'), meta: JSON.parse(readFileSync(`${file}.meta.json`, 'utf8')) };
};
const plain = makeSeed('plain');
const confirmed = makeSeed('confirmed');
const transformed = makeSeed('transformed');
const verifiedScale = makeSeed('verified-scale');
const seedNodes = JSON.parse(plain.text).scene.nodes;

const checks = [];
const external = [];
let agentCalls = [];
let agentMode = 'removeWall';
function check(scenario, name, ok, observed) {
  checks.push({ scenario, name, ok: Boolean(ok), observed });
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${scenario}] ${name}${ok ? '' : `  -> ${JSON.stringify(observed)}`}`);
}
const norm = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function openEditor(seed) {
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
      agentCalls.push(body.query);
      if (agentMode === 'unavailable') return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'MODEL_API_KEY_MISSING', message: 'sem chave (simulado)' } }) });
      const label = norm(body.query).match(/entre .+$/)?.[0]?.replace(/[.!?]+$/, '') ?? null;
      const action = { kind: 'RemoveWall', target: { reference: 'label', label, ordinal: null }, value: null, valueMode: null, unit: null, axis: null, opening: null };
      const result = { schema: 'spatial_agent_result.v1', kind: 'PROPOSE_ACTION', text: 'Proponho remover a parede entre as duas divisões.', basis: 'scene', evidenceIds: [body.scene.components[0].id], question: null, action };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result, sceneRevisionId: body.scene.revisionId, meta: { simulated: true } }) });
    }
    return route.fulfill({ status: 404, contentType: 'application/json', body: 'null' });
  });
  await page.goto(`${BASE}/demo`);
  await page.waitForSelector('#demo-open-spatial');
  await page.evaluate((s) => localStorage.setItem('unfold-spatial-scene.v1', s), seed.text);
  await page.click('#demo-open-spatial');
  await page.waitForSelector('#component-list [data-scene-node]', { timeout: 30000 });
  await page.waitForTimeout(800);
  return { page, context, errors, seed };
}

const revision = (page) => page.evaluate(() => Number(/R(\d+)/.exec(document.querySelector('#scene-state')?.textContent ?? '')?.[1] ?? NaN));
const stored = (page) => page.evaluate(() => localStorage.getItem('unfold-spatial-scene.v1'));
const storedTx = async (page) => JSON.parse(await stored(page));
const roomsOf = (scene) => scene.nodes.filter((n) => n.component?.kind === 'room');
const cardOf = (page) => page.evaluate(() => {
  const card = document.querySelector('#removal-card');
  return {
    hidden: !card || card.hidden,
    label: card?.querySelector('.u-label')?.textContent ?? '',
    title: card?.querySelector('h2')?.textContent ?? '',
    why: card?.querySelector('.removal-why')?.textContent ?? '',
    rows: Object.fromEntries([...(card?.querySelectorAll('.u-readout > div') ?? [])].map((d) => [d.querySelector('dt')?.textContent ?? '', d.querySelector('dd')?.textContent ?? ''])),
    unknownRows: [...(card?.querySelectorAll('.u-readout > div.is-unknown dt') ?? [])].map((d) => d.textContent),
    confirm: !!card?.querySelector('#removal-confirm'),
    close: !!card?.querySelector('#removal-close'),
  };
});
const ui = (page) => page.evaluate(() => ({
  previewStatus: document.querySelector('#preview-status')?.textContent ?? '',
  commitDisabled: document.querySelector('#commit-preview')?.disabled,
  cmdState: document.querySelector('#demo-command-state')?.textContent ?? '',
  cmdMsg: document.querySelector('#demo-command-message')?.textContent ?? '',
  spatial: document.querySelector('#spatial-status')?.textContent ?? '',
  list: [...document.querySelectorAll('#component-list [data-scene-node]')].map((e) => `${e.dataset.sceneNode}|${e.querySelector('span')?.textContent}`),
}));
const wantShots = new Set(['01', '02', '03', '04', '05', '06', '07', '08', '12', '13', '14']);
const shot = (page, name) => (process.env.UNFOLD_E2E_ALL_SHOTS || wantShots.has(name.slice(0, 2))) ? page.screenshot({ path: join(SHOTS, `${name}.png`) }) : Promise.resolve();
async function select(page, id) { await page.click(`[data-scene-node="${id}"]`); await page.waitForSelector('#inspector:not([hidden])'); await page.waitForTimeout(300); }
async function command(page, text) { await page.fill('#demo-question', text); await page.click('#demo-submit'); }
const waitFor = (page, fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout }).then(() => true, () => false);
const waitCard = (page) => waitFor(page, () => { const c = document.querySelector('#removal-card'); return c && !c.hidden && c.querySelector('h2'); });

try {
  // ------------------------------------------------------------------ 1. fusão limpa, confirmar, desfazer
  {
    const sc = '1 fusão limpa';
    const { page, context, errors, seed } = await openEditor(plain);
    const r0 = await revision(page);
    await select(page, seed.meta.sharedWall);
    await page.click('#preview-remove-wall');
    check(sc, 'o cartão aparece', await waitCard(page));
    await page.waitForTimeout(600);
    const card = await cardOf(page);
    check(sc, 'diz as duas divisões, a divisão que sai e a área calculada', card.rows['divisões'] === 'Sala + Cozinha → 1 divisão' && card.rows['área calculada'] === '21 m²', card.rows);
    check(sc, 'diz de que escala depende a área: fornecida pelo utilizador, por verificar, marcada como desconhecida', card.rows['escala'] === 'fornecida pelo utilizador · por verificar' && card.unknownRows.includes('escala'), card);
    check(sc, 'diz que a geometria das divisões ainda não foi revista', card.rows['geometria'] === 'das duas divisões por rever' && card.unknownRows.includes('geometria'), card.rows['geometria']);
    check(sc, 'não afirma escala verificada nem segurança estrutural', !/verificada|confirmada|segur/.test(JSON.stringify(card.rows)), card.rows);
    check(sc, 'a área conservada: 21 = 12 + 9', card.rows['área conservada'] === 'ok · 21 m² = 12 + 9 m²', card.rows['área conservada']);
    check(sc, 'o polígono é simples', card.rows['polígono simples'] === 'ok', card.rows['polígono simples']);
    check(sc, 'a estrutura é desconhecida, sem dados estruturais, e está marcada como desconhecida', card.rows['estrutura'] === 'desconhecida · sem dados estruturais' && card.unknownRows.includes('estrutura'), card);
    check(sc, 'tem o botão Confirmar e não é um cartão de bloqueio', card.confirm && card.label === 'pré-visualização' && !card.close, card);
    check(sc, 'o preview não altera a revisão nem a persistência', (await revision(page)) === r0 && (await stored(page)) === plain.text, await revision(page));
    await shot(page, '01-fusao-cartao-preview');
    await page.waitForTimeout(1000);
    check(sc, 'sem clique nada é aplicado', (await revision(page)) === r0 && (await stored(page)) === plain.text, await revision(page));

    await page.click('#removal-confirm');
    check(sc, 'confirmar aplica', await waitFor(page, () => /aplicada/.test(document.querySelector('#preview-status')?.textContent ?? '')));
    await page.waitForTimeout(400);
    const after = await storedTx(page);
    const rooms = roomsOf(after.scene);
    const merged = rooms.find((r) => r.label === 'Sala + Cozinha');
    check(sc, 'uma só revisão: R+1', (await revision(page)) === r0 + 1, { before: r0, after: await revision(page) });
    check(sc, 'uma só entrada de desfazer', after.undoStack.length === 1 && after.redoStack.length === 0, after.undoStack.length);
    check(sc, 'a revisão tem o nome da operação', /RemoveWall$/.test(after.scene.revision.operationId ?? ''), after.scene.revision.operationId);
    check(sc, 'três divisões: a fundida, o Corredor e a Despensa', rooms.length === 3 && !!merged, rooms.map((r) => r.label));
    check(sc, 'a parede e as duas divisões antigas desapareceram', ![seed.meta.sharedWall, 'sala', 'cozinha'].some((id) => after.scene.nodes.some((n) => n.id === id)), after.scene.nodes.length);
    const poly = merged?.geometry?.verticesM ?? [];
    const area = Math.abs(poly.reduce((sum, a, i) => { const b = poly[(i + 1) % poly.length]; return sum + a[0] * b[2] - b[0] * a[2]; }, 0)) / 2;
    check(sc, 'a área do polígono é 21 m² e a propriedade «area» também', Math.abs(area - 21) < 1e-9 && Math.abs(merged?.component?.properties?.area?.value - 21) < 1e-9, { area, prop: merged?.component?.properties?.area });
    check(sc, 'a divisão nova é derived e unreviewed, sem authorizationId', !JSON.stringify(merged).match(/"validation":"(verified|corrected)"|authorizationId/) && merged.geometry.provenance.source === 'derived', merged?.geometry?.provenance);
    check(sc, 'o cartão fechou', (await cardOf(page)).hidden);
    await shot(page, '02-fusao-aplicada');

    await page.evaluate(() => document.querySelector('#undo-scene').click());
    await page.waitForTimeout(800);
    const undone = await storedTx(page);
    check(sc, 'desfazer: volta a haver as duas divisões e a parede, com o conteúdo de antes', JSON.stringify(undone.scene.nodes) === JSON.stringify(seedNodes), undone.scene.nodes.length);
    check(sc, 'desfazer: uma só entrada desfeita (e a revisão avança 1)', (await revision(page)) === r0 + 2 && undone.redoStack.length === 1 && undone.undoStack.length === 0, { rev: await revision(page), redo: undone.redoStack.length });
    await shot(page, '03-fusao-desfeita');
    check(sc, 'sem erros de consola', errors.length === 0, errors);
    await context.close();
  }

  // ------------------------------------------------------------------ 2. bloqueios
  {
    const sc = '2 bloqueios';
    const { page, context, errors, seed } = await openEditor(plain);
    const r0 = await revision(page);
    await select(page, seed.meta.outerWall);
    await page.click('#preview-remove-wall');
    await waitCard(page); await page.waitForTimeout(600);
    let card = await cardOf(page);
    check(sc, 'uma só divisão: cartão de bloqueio com a razão numa frase', card.label === 'remoção bloqueada' && /abriria a divisão para fora/.test(card.why) && /ROOM_MERGE_SINGLE_ROOM/.test(card.why), card);
    check(sc, 'o cartão de bloqueio não tem Confirmar, só Fechar, e a estrutura continua desconhecida', !card.confirm && card.close && card.rows['estrutura'] === 'desconhecida · sem dados estruturais', card);
    check(sc, 'não promete a fusão («ainda não existe no motor» já não aparece)', !/ainda não existe/.test(JSON.stringify(card)), card);
    check(sc, 'nada foi aplicado e Aplicar está desactivado', (await revision(page)) === r0 && (await stored(page)) === plain.text && (await ui(page)).commitDisabled === true, await ui(page));
    await shot(page, '04-bloqueio-uma-so-divisao');
    await page.click('#removal-close'); await page.waitForTimeout(600);
    check(sc, 'Fechar fecha o cartão', (await cardOf(page)).hidden);

    await select(page, seed.meta.partialWall);
    await page.click('#preview-remove-wall');
    await waitCard(page); await page.waitForTimeout(600);
    card = await cardOf(page);
    check(sc, 'partilha parcial: bloqueada, com a razão', card.label === 'remoção bloqueada' && /não coincide com esta parede/.test(card.why) && /ROOM_MERGE_EDGE_MISMATCH/.test(card.why), card);
    check(sc, 'a cena continua intacta', (await revision(page)) === r0 && (await stored(page)) === plain.text, await revision(page));
    await shot(page, '05-bloqueio-partilha-parcial');
    check(sc, 'sem erros de consola', errors.length === 0, errors);
    await context.close();
  }

  // ------------------------------------------------------------------ 3. valores confirmados: o clique de autorização
  {
    const sc = '3 valores confirmados';
    const { page, context, errors, seed } = await openEditor(confirmed);
    const r0 = await revision(page);
    await select(page, seed.meta.sharedWall);
    await page.click('#preview-remove-wall');
    await waitCard(page); await page.waitForTimeout(600);
    const card = await cardOf(page);
    check(sc, 'o cartão avisa que toca em valores confirmados e quais (com os nomes)', /Atenção: esta alteração toca em valores confirmados/.test(card.why) && /Sala: área/.test(card.why) && /Cozinha: geometria/.test(card.why) && /«Aplicar» autoriza/.test(card.why), card.why);
    check(sc, 'mostra a mesma fusão (21 m²) e a escala por verificar', card.rows['divisões'] === 'Sala + Cozinha → 1 divisão' && card.rows['área calculada'] === '21 m²' && card.rows['escala'] === 'fornecida pelo utilizador · por verificar', card.rows);
    check(sc, 'o preview não altera nada e passado tempo continua igual', (await revision(page)) === r0 && (await stored(page)) === confirmed.text, await revision(page));
    await shot(page, '06-fusao-valores-confirmados-cartao');
    await page.waitForTimeout(1200);
    check(sc, 'sem o clique, nada se aplica', (await revision(page)) === r0 && (await stored(page)) === confirmed.text, await revision(page));
    await page.click('#removal-cancel'); await page.waitForTimeout(500);
    check(sc, 'cancelar deixa tudo como estava', (await revision(page)) === r0 && (await stored(page)) === confirmed.text && (await cardOf(page)).hidden, await revision(page));

    await select(page, seed.meta.sharedWall);
    await page.click('#preview-remove-wall'); await waitCard(page);
    await page.click('#removal-confirm');
    check(sc, 'com o clique de confirmação aplica-se', await waitFor(page, () => /aplicada/.test(document.querySelector('#preview-status')?.textContent ?? '')));
    await page.waitForTimeout(400);
    const after = await storedTx(page);
    const merged = roomsOf(after.scene).find((r) => r.label === 'Sala + Cozinha');
    check(sc, 'uma só revisão', (await revision(page)) === r0 + 1, await revision(page));
    check(sc, 'a divisão nova não herda o confirmado (nem a área da Sala nem a geometria da Cozinha)', !!merged && !JSON.stringify(merged).match(/"validation":"(verified|corrected)"|authorizationId/) && merged.component.properties.area.value === 21, merged?.component?.properties?.area);
    check(sc, 'os valores antigos saíram com as divisões antigas', !after.scene.nodes.some((n) => ['sala', 'cozinha'].includes(n.id)), after.scene.nodes.length);
    check(sc, 'sem erros de consola', errors.length === 0, errors);
    await context.close();
  }

  // ------------------------------------------------------------------ 4. comando de texto, caminho Muse (simulado)
  {
    const sc = '4 comando via Muse';
    agentMode = 'removeWall'; agentCalls = [];
    const { page, context, errors } = await openEditor(plain);
    const r0 = await revision(page);
    await command(page, 'Remove a parede entre a cozinha e a sala');
    check(sc, 'o cartão aparece', await waitCard(page));
    await page.waitForTimeout(600);
    const card = await cardOf(page);
    const state = await ui(page);
    check(sc, 'o Muse (simulado) foi consultado uma vez', agentCalls.length === 1, agentCalls);
    check(sc, 'o cartão mostra a fusão calculada e o estado é «a aguardar confirmação»', card.rows['divisões'] === 'Sala + Cozinha → 1 divisão' && card.rows['área calculada'] === '21 m²' && /AWAITING/.test(state.cmdState), { card: card.rows, state: state.cmdState });
    check(sc, 'a proposta não altera nada até ao clique humano', (await revision(page)) === r0 && (await stored(page)) === plain.text, await revision(page));
    await shot(page, '07-comando-muse-cartao');
    await page.click('#removal-confirm');
    check(sc, 'o clique humano aplica', await waitFor(page, () => /aplicada/.test(document.querySelector('#preview-status')?.textContent ?? '')));
    const after = await storedTx(page);
    check(sc, 'uma divisão fundida, unreviewed, uma revisão', roomsOf(after.scene).length === 3 && (await revision(page)) === r0 + 1 && !JSON.stringify(roomsOf(after.scene).find((r) => r.label === 'Sala + Cozinha')).match(/verified|corrected/), await revision(page));
    check(sc, 'sem erros de consola', errors.length === 0, errors);
    await context.close();
  }
  {
    const sc = '4 Muse sobre valores confirmados';
    agentMode = 'removeWall'; agentCalls = [];
    const { page, context, errors } = await openEditor(confirmed);
    const r0 = await revision(page);
    await command(page, 'Remove a parede entre a cozinha e a sala');
    await waitFor(page, () => /REJECTED|ERROR/.test(document.querySelector('#demo-command-state')?.textContent ?? ''));
    await page.waitForTimeout(800);
    const state = await ui(page); const card = await cardOf(page);
    check(sc, 'a proposta do Muse que toca valores confirmados é recusada, com a razão por extenso', state.cmdState === 'REJECTED' && /Muse/.test(state.cmdMsg) && /confirmou/.test(state.cmdMsg) && !/MACHINE_CANNOT/.test(state.cmdMsg), state.cmdState + ' | ' + state.cmdMsg);
    check(sc, 'o cartão mostra o bloqueio e não há Confirmar', card.label === 'remoção bloqueada' && !card.confirm, card);
    check(sc, 'nada se aplicou: revisão e persistência intactas', (await revision(page)) === r0 && (await stored(page)) === confirmed.text, await revision(page));
    await shot(page, '08-muse-recusado-valores-confirmados');
    check(sc, 'sem erros de consola', errors.length === 0, errors);
    await context.close();
  }
  {
    const sc = '4 Muse indisponível, parser local (PT) sobre confirmados';
    agentMode = 'unavailable'; agentCalls = [];
    const { page, context, errors } = await openEditor(confirmed);
    const r0 = await revision(page);
    await command(page, 'remove a parede entre a sala e a cozinha');
    check(sc, 'o parser local trata o comando como humano: há cartão com Confirmar', await waitCard(page) && (await cardOf(page)).confirm, await cardOf(page));
    check(sc, 'ainda nada aplicado', (await revision(page)) === r0 && (await stored(page)) === confirmed.text, await revision(page));
    await page.click('#removal-confirm');
    check(sc, 'o clique autoriza e aplica', await waitFor(page, () => /aplicada/.test(document.querySelector('#preview-status')?.textContent ?? '')));
    check(sc, 'uma só revisão', (await revision(page)) === r0 + 1, await revision(page));
    check(sc, 'sem erros de consola', errors.length === 0, errors);
    await context.close();
  }

  // ------------------------------------------------------------------ 5. nomes pela interface e comando em inglês
  {
    const sc = '5 nomes e inglês';
    agentMode = 'unavailable'; agentCalls = [];
    const { page, context, errors, seed } = await openEditor(plain);
    const r0 = await revision(page);
    await select(page, 'cozinha');
    check(sc, 'o inspector de uma divisão tem o campo do nome', await page.evaluate(() => !document.querySelector('#room-fields').hidden), 'room-fields hidden');
    await page.fill('#room-name', 'Kitchen'); await page.click('#preview-room-name');
    await waitFor(page, () => document.querySelector('#commit-preview')?.disabled === false);
    check(sc, 'o preview do nome não altera nada', (await stored(page)) === plain.text, await ui(page));
    await page.click('#commit-preview'); await page.waitForTimeout(600);
    await select(page, 'sala');
    await page.fill('#room-name', 'Living room'); await page.click('#preview-room-name');
    await waitFor(page, () => document.querySelector('#commit-preview')?.disabled === false);
    await page.click('#commit-preview'); await page.waitForTimeout(600);
    const named = await storedTx(page);
    const nameProp = (id) => named.scene.nodes.find((n) => n.id === id).properties.name;
    check(sc, 'o nome fica como propriedade escrita por uma pessoa (source user, unreviewed, sem confirmação)', nameProp('cozinha').value === 'Kitchen' && nameProp('cozinha').provenance.source === 'user' && nameProp('cozinha').provenance.validation === 'unreviewed' && nameProp('sala').value === 'Living room', [nameProp('cozinha'), nameProp('sala')]);
    check(sc, 'a lista e o inspector mostram o nome', (await ui(page)).list.some((row) => row === 'cozinha|Kitchen') && (await page.evaluate(() => document.querySelector('#node-label').textContent)) === 'Living room', (await ui(page)).list);
    const r1 = await revision(page);

    await command(page, 'remove wall between kitchen and living room');
    check(sc, 'o comando em inglês gera o cartão', await waitCard(page));
    await page.waitForTimeout(500);
    const card = await cardOf(page);
    check(sc, 'o cartão usa os nomes que a pessoa deu: «Living room + Kitchen → 1 divisão», 21 m²', card.rows['divisões'] === 'Living room + Kitchen → 1 divisão' && card.rows['área calculada'] === '21 m²', card.rows);
    await page.click('#removal-confirm');
    check(sc, 'confirmar aplica uma só revisão', await waitFor(page, () => /aplicada/.test(document.querySelector('#preview-status')?.textContent ?? '')) && (await revision(page)) === r1 + 1, await revision(page));
    check(sc, 'sem erros de consola', errors.length === 0, errors);
    await context.close();
  }
  {
    const sc = '5 recusas do comando';
    agentMode = 'unavailable'; agentCalls = [];
    const { page, context, errors } = await openEditor(plain);
    const r0 = await revision(page);
    for (const [text, expected] of [
      ['remove a parede entre a cozinha e a varanda', /varanda/],
      ['remove a parede entre a sala e a despensa', /não partilham/],
      ['remove a parede entre a sala e a sala', /diferentes/],
      ['remove a parede W99', /W99|w99/],
    ]) {
      await command(page, text);
      await waitFor(page, () => /REJECTED|CLARIFICATION/.test(document.querySelector('#demo-command-state')?.textContent ?? ''));
      await page.waitForTimeout(600);
      const state = await ui(page);
      check(sc, `«${text}» é recusado com a razão e sem alterar nada`, expected.test(state.cmdMsg) && (await revision(page)) === r0 && (await stored(page)) === plain.text && (await cardOf(page)).hidden, state.cmdState + ' | ' + state.cmdMsg);
    }
    check(sc, 'sem erros de consola', errors.length === 0, errors);
    await context.close();
  }

  // ------------------------------------------------------------------ 7. divisão com transformação própria: bloqueada, cena intacta
  {
    const sc = '7 divisão transformada';
    const { page, context, errors, seed } = await openEditor(transformed);
    const r0 = await revision(page);
    await select(page, seed.meta.sharedWall);
    await page.click('#preview-remove-wall');
    check(sc, 'o cartão aparece', await waitCard(page));
    await page.waitForTimeout(600);
    const card = await cardOf(page);
    check(sc, 'cartão de bloqueio com o código e a razão por extenso (referencial próprio)', card.label === 'remoção bloqueada' && /ROOM_MERGE_UNSUPPORTED_TRANSFORM/.test(card.why) && /referencial da cena/.test(card.why), card.why);
    check(sc, 'não há Confirmar, só Fechar; a estrutura continua desconhecida', !card.confirm && card.close && card.rows['estrutura'] === 'desconhecida · sem dados estruturais', card);
    check(sc, 'o bloqueio não mostra área nem escala (não há fusão)', !card.rows['área calculada'] && !card.rows['escala'], card.rows);
    check(sc, 'nada foi aplicado: revisão, persistência e Aplicar intactos', (await revision(page)) === r0 && (await stored(page)) === transformed.text && (await ui(page)).commitDisabled === true, await ui(page));
    await shot(page, '12-bloqueio-divisao-transformada');
    await page.click('#removal-close'); await page.waitForTimeout(600);
    check(sc, 'Fechar fecha o cartão e continua tudo igual', (await cardOf(page)).hidden && (await stored(page)) === transformed.text, { hidden: (await cardOf(page)).hidden, same: (await stored(page)) === transformed.text });
    check(sc, 'sem erros de consola', errors.length === 0, errors);
    await context.close();
  }

  // ------------------------------------------------------------------ 8. editar a parede exterior, fundir, editar outra vez, desfazer e refazer
  {
    const sc = '8 editar, fundir, editar';
    const { page, context, errors, seed } = await openEditor(plain);
    const r0 = await revision(page);
    const edit = async (id, dx) => {
      await select(page, id);
      const x = await page.inputValue('#wall-x');
      await page.fill('#wall-x', String(Number(x) + dx));
      await page.click('#preview-wall');
      await waitFor(page, () => document.querySelector('#commit-preview')?.disabled === false);
      await page.click('#commit-preview');
      await page.waitForTimeout(700);
    };
    const polyOf = (scene, id) => scene.nodes.find((n) => n.id === id)?.geometry?.verticesM ?? [];
    const areaOf = (poly) => Math.abs(poly.reduce((sum, a, i) => { const b = poly[(i + 1) % poly.length]; return sum + a[0] * b[2] - b[0] * a[2]; }, 0)) / 2;
    const boundaryOk = (scene, room) => {
      const refs = JSON.parse(room.component.properties.boundaryRefs.value);
      const byId = new Map(scene.nodes.map((n) => [n.id, n]));
      const n = room.geometry.verticesM.length;
      return room.component.dependsOn.every((id) => byId.get(id)?.component?.kind === 'wall' && refs.some((r) => r.wallId === id))
        && refs.every((r) => room.component.dependsOn.includes(r.wallId) && byId.has(r.wallId) && r.startIndex >= 0 && r.endIndex >= 0 && r.startIndex < n && r.endIndex < n && r.startIndex !== r.endIndex)
        && !refs.some((r) => r.wallId === seed.meta.sharedWall) && !room.component.dependsOn.includes(seed.meta.sharedWall);
    };

    await edit(seed.meta.outerWall, -1);
    const e1 = await storedTx(page);
    check(sc, 'editar a parede exterior da Sala alarga a Sala (5 × 3 = 15 m²) por uma só revisão', Math.abs(areaOf(polyOf(e1.scene, 'sala')) - 15) < 1e-9 && (await revision(page)) === r0 + 1, { area: areaOf(polyOf(e1.scene, 'sala')), rev: await revision(page) });

    await select(page, seed.meta.sharedWall);
    await page.click('#preview-remove-wall');
    check(sc, 'o cartão da fusão aparece depois da edição', await waitCard(page));
    await page.waitForTimeout(600);
    const card = await cardOf(page);
    check(sc, 'a área calculada vem do polígono editado: 15 + 9 = 24 m², com a escala por verificar', card.rows['área calculada'] === '24 m²' && card.rows['área conservada'] === 'ok · 24 m² = 15 + 9 m²' && card.rows['escala'] === 'fornecida pelo utilizador · por verificar', card.rows);
    await shot(page, '13-fusao-depois-de-editar-parede');
    await page.click('#removal-confirm');
    check(sc, 'confirmar aplica a fusão', await waitFor(page, () => /aplicada/.test(document.querySelector('#preview-status')?.textContent ?? '')));
    await page.waitForTimeout(500);
    const m1 = await storedTx(page);
    const merged1 = roomsOf(m1.scene).find((r) => r.label === 'Sala + Cozinha');
    check(sc, 'a divisão fundida tem 24 m² e as referências completas: todas as paredes de que depende, nenhuma da removida', !!merged1 && Math.abs(areaOf(merged1.geometry.verticesM) - 24) < 1e-9 && boundaryOk(m1.scene, merged1), merged1?.component);
    check(sc, 'uma só revisão para a fusão (R+2)', (await revision(page)) === r0 + 2, await revision(page));

    await edit(seed.meta.outerWall, -1);
    const e2 = await storedTx(page);
    const merged2 = roomsOf(e2.scene).find((r) => r.label === 'Sala + Cozinha');
    const minX = Math.min(...merged2.geometry.verticesM.map((v) => v[0]));
    check(sc, 'editar a mesma parede outra vez depois da fusão faz a divisão fundida seguir (x mínimo −2, 27 m²)', Math.abs(minX + 2) < 1e-9 && Math.abs(areaOf(merged2.geometry.verticesM) - 27) < 1e-9 && boundaryOk(e2.scene, merged2), { minX, area: areaOf(merged2.geometry.verticesM) });
    check(sc, 'a divisão fundida continua derivada e por rever', !JSON.stringify(merged2).match(/"validation":"(verified|corrected)"|authorizationId/), merged2?.geometry?.provenance);
    const finalNodes = JSON.stringify(e2.scene.nodes);
    await shot(page, '14-editar-depois-de-fundir');

    for (let i = 0; i < 3; i += 1) { await page.evaluate(() => document.querySelector('#undo-scene').click()); await page.waitForTimeout(700); }
    const undone = await storedTx(page);
    check(sc, 'desfazer três vezes devolve a cena inicial, com o conteúdo de antes', JSON.stringify(undone.scene.nodes) === JSON.stringify(seedNodes) && undone.undoStack.length === 0 && undone.redoStack.length === 3, { undo: undone.undoStack.length, redo: undone.redoStack.length });
    for (let i = 0; i < 3; i += 1) { await page.evaluate(() => document.querySelector('#redo-scene').click()); await page.waitForTimeout(700); }
    const redone = await storedTx(page);
    check(sc, 'refazer três vezes repõe exactamente o estado depois da segunda edição', JSON.stringify(redone.scene.nodes) === finalNodes && redone.redoStack.length === 0, { undo: redone.undoStack.length, redo: redone.redoStack.length });
    check(sc, 'sem erros de consola', errors.length === 0, errors);
    await context.close();
  }

  // ------------------------------------------------------------------ 9. escala verificada: o cartão diz «verificada» (e só então)
  {
    const sc = '9 escala verificada';
    const { page, context, errors, seed } = await openEditor(verifiedScale);
    const r0 = await revision(page);
    await select(page, seed.meta.sharedWall);
    await page.click('#preview-remove-wall');
    check(sc, 'o cartão aparece', await waitCard(page));
    await page.waitForTimeout(600);
    const card = await cardOf(page);
    check(sc, 'a escala aparece como verificada e sem marca de desconhecida', card.rows['escala'] === 'fornecida pelo utilizador · verificada' && !card.unknownRows.includes('escala'), card);
    check(sc, 'a geometria das duas divisões aparece como confirmada', card.rows['geometria'] === 'das duas divisões confirmada' && !card.unknownRows.includes('geometria'), card.rows['geometria']);
    check(sc, 'a estrutura continua desconhecida, mesmo com escala verificada', card.rows['estrutura'] === 'desconhecida · sem dados estruturais' && card.unknownRows.includes('estrutura'), card);
    check(sc, 'o preview não altera nada', (await revision(page)) === r0 && (await stored(page)) === verifiedScale.text, await revision(page));
    check(sc, 'sem erros de consola', errors.length === 0, errors);
    await context.close();
  }

  // ------------------------------------------------------------------ 6. os outros laboratórios continuam a abrir
  for (const [name, path, selector] of [['Four-Bar Lab', '/demo', '#demo-question'], ['Circuit Lab', '/circuit', '.circuit-lab, [class*="cl-"], svg'], ['editor espacial', '/spatial-editor', '.spatial-lab']]) {
    const sc = `6 ${name}`;
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });
    page.on('request', (r) => { const u = new URL(r.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && u.protocol.startsWith('http')) external.push(r.url()); });
    await page.route('**/api/**', (route) => route.fulfill({ status: 404, contentType: 'application/json', body: 'null' }));
    await page.goto(`${BASE}${path}`);
    const opened = await page.waitForSelector(selector, { timeout: 30000 }).then(() => true, () => false);
    await page.waitForTimeout(1200);
    check(sc, 'abre', opened, path);
    check(sc, 'sem erros de consola nem excepções', errors.length === 0, errors);
    await shot(page, `${{ 'Four-Bar Lab': '09-four-bar-lab', 'Circuit Lab': '10-circuit-lab', 'editor espacial': '11-editor-espacial' }[name]}`);
    await context.close();
  }

  check('rede', 'nenhum pedido saiu para fora de localhost (nenhuma chamada à Meta)', external.length === 0, external);
} catch (error) {
  checks.push({ scenario: 'crash', name: 'o script terminou sem excepções', ok: false, observed: String(error?.stack ?? error) });
  console.log('CRASH', error);
} finally {
  await browser.close();
  writeFileSync(join(OUT, 'result.json'), JSON.stringify({ checks, external }, null, 2) + '\n');
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} verificações passaram; ${failed.length} falharam.`);
  process.exitCode = failed.length ? 1 : 0;
}
