import lockupDark from '../../../design-system/logos/unfold-lockup-on-dark.svg';
import { EXCAVATOR_ASSEMBLY_V1 } from '../contracts/fixtures/excavator.assembly.v1';
import { CinemaRuntime, type CinemaStats } from './cinema-runtime';
import { SHOT_IDS, type ShotId } from './choreography';
import { CINEMA_TIERS, type CinemaTier } from './quality';
import { type PoseSample } from './pose-source';
import { articulatedStaticSource, createMotionSources, MOTION_LABEL, poselessStaticSource, type MotionKey } from './motion-sources';
import { CaptionState } from './caption';
import { Quaternion, Vector3 } from 'three';
import './cinema.css';

/**
 * `/cinema`: full-screen presentation stage. Chrome (top bar, shot rail, readout) uses the UNFOLD tokens and components; the 3D viewport is the dark theme.
 * Keys: 1-6 shots, T tour, L free look, Q quality, F full screen, H hide interface, Space play/pause the pose timeline (when a source has one), Esc leaves.
 */
const SHOT_LABEL: Record<ShotId, string> = { hero: 'Herói', profile: 'Perfil', bucket: 'Balde', reach: 'Alcance', top: 'Planta', orbit: 'Órbita' };
const TIER_LABEL: Record<CinemaTier, string> = { studio: 'Estúdio', balanced: 'Equilibrado', light: 'Leve' };
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export async function mountCinema(app: HTMLElement): Promise<CinemaRuntime> {
  const params = new URLSearchParams(location.search);
  const assembly = EXCAVATOR_ASSEMBLY_V1;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  app.innerHTML = `
    <main class="cinema" id="cinema-root" data-theme="dark">
      <div class="cinema-stage" id="cinema-stage"></div>
      <header class="cinema-top cinema-chrome">
        <a class="cinema-logo" href="/" aria-label="UNFOLD"><img src="${lockupDark}" alt="UNFOLD" height="24"></a>
        <p class="u-label cinema-title">Cinema · estúdio</p>
        <div class="cinema-actions" role="group" aria-label="Apresentação">
          <div class="cinema-seg" role="group" aria-label="Qualidade">${(['studio', 'balanced', 'light'] as CinemaTier[]).map((t) => `<button type="button" class="u-btn u-btn--outline" data-tier="${t}" aria-pressed="false">${TIER_LABEL[t]}</button>`).join('')}</div>
          <button type="button" class="u-btn u-btn--outline" id="cinema-hide" aria-pressed="false" title="Esconder a interface (H)">Esconder interface</button>
          <button type="button" class="u-btn u-btn--primary" id="cinema-fullscreen" aria-pressed="false" title="Ecrã inteiro (F)">Ecrã inteiro</button>
        </div>
      </header>
      <section class="cinema-motion cinema-chrome" aria-label="Movimento">
        <label class="u-label" for="cinema-motion">movimento</label>
        <select id="cinema-motion" class="u-input">${(Object.keys(MOTION_LABEL) as MotionKey[]).map((k) => `<option value="${k}">${MOTION_LABEL[k]}</option>`).join('')}</select>
        <input id="cinema-time" type="range" min="0" max="1" step="0.001" value="0" aria-label="Instante da reprodução" disabled>
        <output id="cinema-time-readout" class="u-data" for="cinema-time">0,00 s</output>
      </section>
      <nav class="cinema-shots cinema-chrome" aria-label="Planos de câmara">
        ${SHOT_IDS.map((id, i) => `<button type="button" class="u-btn u-btn--outline" data-shot="${id}" aria-pressed="false" title="${SHOT_LABEL[id]} (${i + 1})"><span class="u-data">${i + 1}</span> ${SHOT_LABEL[id]}</button>`).join('')}
        <i aria-hidden="true"></i>
        <button type="button" class="u-btn u-btn--ink" id="cinema-tour" aria-pressed="false" title="Percurso (T)">Percurso</button>
        <button type="button" class="u-btn u-btn--outline" id="cinema-free" aria-pressed="false" title="Câmara livre (L)">Livre</button>
        <button type="button" class="u-btn u-btn--outline" id="cinema-play" hidden title="Reproduzir movimento (Espaço)">Reproduzir</button>
      </nav>
      <aside class="cinema-readout cinema-chrome" aria-label="Estado da cena" data-theme="dark">
        <p class="u-label">montagem · <span id="ro-assembly">${esc(assembly.id)}</span></p>
        <dl class="u-readout">
          <div><dt>origem</dt><dd id="ro-origin">fixture · sem revisão</dd></div>
          <div><dt>geometria</dt><dd id="ro-geometry">proxy dos shapes do contrato</dd></div>
          <div><dt>pose</dt><dd id="ro-pose">referência</dd></div>
          <div><dt>origem</dt><dd id="ro-source">—</dd></div>
          <div><dt>estado</dt><dd id="ro-status">—</dd></div>
          <div><dt>componente</dt><dd id="ro-part">clique numa peça</dd></div>
          <div><dt>qualidade</dt><dd id="ro-tier">—</dd></div>
          <div><dt>frame</dt><dd id="ro-frame">—</dd></div>
        </dl>
        <p class="cinema-note u-small" id="ro-note">Montagem sintética: dimensões escolhidas por plausibilidade, não de um fabricante. A geometria detalhada vem da Visual Foundry.</p>
      </aside>
      <p class="cinema-caption u-label" id="cinema-caption" role="status" aria-live="polite"></p>
      <div class="cinema-fail" id="cinema-fail" hidden role="alert"><h2 class="u-title">Não foi possível desenhar a cena</h2><p class="u-small" id="cinema-fail-text"></p><button class="u-btn u-btn--outline" id="cinema-retry" type="button">Tentar de novo</button></div>
    </main>`;
  const $ = <T extends HTMLElement>(sel: string) => app.querySelector<T>(sel)!;
  const root = $('#cinema-root'); const caption = $('#cinema-caption');
  const captions = new CaptionState();
  const say = (text: string) => { caption.textContent = captions.notify(text); };

  // Geometry: the Visual Foundry excavator (default) or the proxy of the contract's shapes. Motion: the engine's scenario (default), the exported 15-frame sequence,
  // its two blocked examples, or the reference pose. Every source is checked against the effective assembly before it can be shown.
  const wantFoundry = params.get('visuals') !== 'proxy';
  const motionKey = (params.get('motion') === 'reference' ? 'reference' : (params.get('motion') as MotionKey | null) && (params.get('motion') as string) in MOTION_LABEL ? params.get('motion') : 'engine') as MotionKey;
  const sources = createMotionSources(assembly);
  const debugInitial = params.has('debug-cinema') ? params.get('initial') : null; // tests only: start from a static articulated or pose-less frame
  const foundry = wantFoundry ? await import('./foundry-provider').then((m) => m.foundryVisualProvider()) : undefined;
  let runtime: CinemaRuntime;
  try {
    runtime = await CinemaRuntime.create({
      host: $('#cinema-stage'), assembly, poseSource: debugInitial === 'articulated' ? articulatedStaticSource(assembly) : debugInitial === 'poseless' ? poselessStaticSource(assembly) : sources[motionKey](), provider: foundry,
      onInspect: (id) => inspect(id),
      tier: (params.get('tier') as CinemaTier | null), reducedMotion, pixelRatio: params.get('dpr') ? Number(params.get('dpr')) : undefined,
      onSample: (s) => showSample(s),
      onShot: (id) => { app.querySelectorAll<HTMLButtonElement>('[data-shot]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.shot === id))); $('#cinema-tour').setAttribute('aria-pressed', String(id === 'tour')); $('#cinema-free').setAttribute('aria-pressed', String(id === 'free')); },
      onDegrade: (level, s) => { say(level === 1 ? 'Dispositivo lento: oclusão ambiente desligada.' : 'Dispositivo lento: realce, sombras mais leves e resolução reduzida.'); markTier(s.tier); },
      onContextLost: () => { $('#cinema-fail').hidden = false; $('#cinema-fail-text').textContent = 'O contexto gráfico foi perdido. Recarregue para continuar.'; },
    });
  } catch (error) {
    $('#cinema-fail').hidden = false; $('#cinema-fail-text').textContent = `${error instanceof Error ? error.message : 'Erro desconhecido'} Este navegador precisa de WebGL2.`;
    $('#cinema-retry').addEventListener('click', () => location.reload()); throw error;
  }
  $('#cinema-retry').addEventListener('click', () => location.reload());

  function showSample(s: PoseSample): void {
    $('#ro-pose').textContent = s.status === 'reference' ? 'referência (fixture)' : s.poseBasis === 'none' ? 'sem pose' : `${s.poseBasis}${s.interpolated ? ' · suavizada entre dois quadros (sem medidas)' : ''}${s.origin === 'engine' ? ' · motor' : ''}`;
    $('#ro-source').textContent = ({ reference: 'pose de referência (fixture)', engine: s.interpolated ? 'motor · suavizada entre quadros, sem medidas' : 'motor de engenharia', fixture: 'fixture (não é do motor)', unverified: 'quadro válido, produtor desconhecido' })[s.origin];
    $('#ro-status').textContent = s.status === 'reference' ? 'sem movimento' : s.status;
    $('#ro-status').parentElement!.classList.toggle('is-unknown', s.status === 'blocked' || s.status === 'invalid_assembly');
    caption.textContent = captions.frame(s);
  }
  const markTier = (tier: CinemaTier) => { app.querySelectorAll<HTMLButtonElement>('[data-tier]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tier === tier))); };
  markTier(runtime.tier);
  $('#ro-geometry').textContent = runtime.visuals.source === 'visual-foundry' ? 'Visual Foundry (excavador canónico)' : 'proxy dos shapes do contrato';
  $('#ro-note').textContent = runtime.visuals.source === 'visual-foundry' ? 'Montagem sintética: dimensões escolhidas por plausibilidade, não de um fabricante. Poses: só quadros validados do motor de engenharia; o palco não interpola nem resolve laços.' : 'Montagem sintética: dimensões escolhidas por plausibilidade, não de um fabricante. Geometria de proxy; o modelo detalhado vem da Visual Foundry.';
  const readout = () => { const s: CinemaStats = runtime.stats(); $('#ro-tier').textContent = `${TIER_LABEL[s.tier]}${s.degrade ? ` · −${s.degrade}` : ''} · ${s.pixelRatio.toFixed(2)}×`; $('#ro-frame').textContent = `${s.lastFrameMs.toFixed(0)} ms · ${s.calls} chamadas`; };
  let readoutTimer = window.setInterval(readout, 800); readout();

  // --- controls ---------------------------------------------------------------------------------------------------
  app.querySelectorAll<HTMLButtonElement>('[data-shot]').forEach((b) => b.addEventListener('click', () => { runtime.cut(b.dataset.shot as ShotId); say(`Plano: ${SHOT_LABEL[b.dataset.shot as ShotId]}`); }));
  $('#cinema-tour').addEventListener('click', () => { runtime.tour(); say('Percurso: herói, perfil, balde, alcance.'); });
  $('#cinema-free').addEventListener('click', () => { runtime.free(); say('Câmara livre: arraste para rodar, role para aproximar.'); });
  app.querySelectorAll<HTMLButtonElement>('[data-tier]').forEach((b) => b.addEventListener('click', () => { runtime.setTier(b.dataset.tier as CinemaTier); markTier(runtime.tier); say(`Qualidade: ${TIER_LABEL[runtime.tier]}`); }));
  const play = $<HTMLButtonElement>('#cinema-play'); play.hidden = runtime.source.durationS <= 0;
  const togglePlay = () => { if (runtime.source.durationS <= 0) return; runtime.playPose(); play.textContent = runtime.playing ? 'Pausa' : 'Reproduzir'; };
  play.addEventListener('click', togglePlay);
  // motion source, timeline and canonical inspection
  const motionSel = $<HTMLSelectElement>('#cinema-motion'); const time = $<HTMLInputElement>('#cinema-time'); const timeOut = $('#cinema-time-readout');
  motionSel.value = motionKey;
  const syncTime = () => { const d = runtime.source.durationS; time.disabled = d <= 0; time.max = String(Math.max(d, 0)); time.value = String(runtime.timeS); timeOut.textContent = `${runtime.timeS.toFixed(2).replace('.', ',')} s${d > 0 ? ` / ${d.toFixed(2).replace('.', ',')} s` : ''}`; play.hidden = d <= 0; play.textContent = runtime.playing ? 'Pausa' : 'Reproduzir'; };
  let timeTimer = window.setInterval(syncTime, 150); syncTime();
  motionSel.addEventListener('change', () => { try { say(`Movimento: ${MOTION_LABEL[motionSel.value as MotionKey]}`); runtime.setPoseSource(sources[motionSel.value as MotionKey]()); /* the frame's own message (blocked reason, warning) is set by the sample and must win */ } catch (e) { say(`Fonte recusada: ${e instanceof Error ? e.message : String(e)}`); motionSel.value = 'reference'; } syncTime(); });
  time.addEventListener('input', () => { runtime.playPose(false); runtime.seekPose(Number(time.value)); syncTime(); });
  const inspect = (id: string | null) => {
    const el = $('#ro-part'); if (!id) { el.textContent = 'clique numa peça'; return; }
    const reg = runtime.visuals.registry; const owner = reg?.ownerOfPart(id); const own = reg?.get(id);
    el.textContent = `${own?.label ?? id} · ${id}${owner && owner.id !== id ? ` · ${owner.kind} ${owner.id}` : ''}${own ? ` · ${own.origin}/${own.validation}` : ''}`;
  };
  let down: { x: number; y: number; t: number } | null = null; const cv = runtime.renderer.domElement;
  cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  cv.addEventListener('pointerup', (e) => { if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5 && performance.now() - down.t < 500) runtime.pickPart(e.clientX, e.clientY); down = null; });

  const hideBtn = $('#cinema-hide'); const fsBtn = $('#cinema-fullscreen');
  let hideTimer = 0;
  const setHidden = (hidden: boolean) => { root.classList.toggle('is-presenting', hidden); hideBtn.setAttribute('aria-pressed', String(hidden)); if (!hidden) { root.classList.remove('is-idle'); } };
  const wake = () => { root.classList.remove('is-idle'); clearTimeout(hideTimer); if (root.classList.contains('is-presenting')) hideTimer = window.setTimeout(() => root.classList.add('is-idle'), 2400); };
  hideBtn.addEventListener('click', () => { setHidden(!root.classList.contains('is-presenting')); wake(); });
  root.addEventListener('pointermove', wake);
  const fullscreenOn = () => document.fullscreenElement === root;
  const toggleFullscreen = async () => {
    try { if (fullscreenOn()) await document.exitFullscreen(); else await root.requestFullscreen({ navigationUI: 'hide' }); }
    catch { say('Este navegador não permitiu o ecrã inteiro. Use H para esconder a interface.'); setHidden(true); }
  };
  fsBtn.addEventListener('click', () => void toggleFullscreen());
  document.addEventListener('fullscreenchange', () => { const on = fullscreenOn(); fsBtn.setAttribute('aria-pressed', String(on)); fsBtn.textContent = on ? 'Sair do ecrã inteiro' : 'Ecrã inteiro'; setHidden(on); wake(); runtime.renderNow(); });
  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    const n = Number(e.key); if (n >= 1 && n <= SHOT_IDS.length) { runtime.cut(SHOT_IDS[n - 1]!); say(`Plano: ${SHOT_LABEL[SHOT_IDS[n - 1]!]}`); return; }
    switch (e.key.toLowerCase()) {
      case 't': runtime.tour(); break; case 'l': runtime.free(); break; case 'f': void toggleFullscreen(); break;
      case 'h': setHidden(!root.classList.contains('is-presenting')); wake(); break;
      case 'q': { const order: CinemaTier[] = ['studio', 'balanced', 'light']; runtime.setTier(order[(order.indexOf(runtime.tier) + 1) % 3]!); markTier(runtime.tier); break; }
      case ' ': e.preventDefault(); togglePlay(); break;
      case 'escape': if (root.classList.contains('is-presenting') && !fullscreenOn()) setHidden(false); break;
      default: break;
    }
  });
  window.addEventListener('pagehide', (event) => {
    clearInterval(readoutTimer); clearInterval(timeTimer); clearTimeout(hideTimer);
    if (event.persisted) runtime.suspend(); else runtime.dispose();
  });
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    runtime.resume(); readout(); clearInterval(readoutTimer); readoutTimer = window.setInterval(readout, 800); clearInterval(timeTimer); timeTimer = window.setInterval(syncTime, 150);
  });
  if (params.get('ui') === '0') { setHidden(true); root.classList.add('is-idle'); clearTimeout(hideTimer); }

  if (params.has('debug-cinema')) {
    (window as unknown as { __unfoldCinema?: unknown }).__unfoldCinema = {
      runtime, stats: () => runtime.stats(), seekShot: (id: ShotId, t: number) => runtime.seekShot(id, t), renderNow: () => runtime.renderNow(), setTier: (t: CinemaTier) => { runtime.setTier(t); markTier(t); },
      camera: () => ({ position: runtime.camera.position.toArray(), target: runtime.controls.target.toArray(), fov: runtime.camera.fov }), canvas: () => runtime.renderer.domElement,
      ablate: (f: Parameters<CinemaRuntime['ablate']>[0]) => runtime.ablate(f), screenBox: (id: string) => runtime.screenBox(id), benchmark: (n?: number) => runtime.benchmark(n),
      pickAt: (x: number, y: number) => runtime.pickPart(x, y), setMotion: (k: string) => { motionSel.value = k; motionSel.dispatchEvent(new Event('change')); }, partScreenCenter: (id: string) => { const b = runtime.screenBox(id); return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null; },
      playTransportFrames: async (variant: 'basic' | 'poseless' = 'basic', autoplay = true) => { const [{ MotionFramePlayer }, { transportTestFrames }] = await Promise.all([import('./pose-source'), import('./test-frames')]); runtime.setPoseSource(new MotionFramePlayer(transportTestFrames({ poseless: variant === 'poseless' }), { assemblyId: assembly.id, partIds: assembly.parts.map((p) => p.id) })); play.hidden = false; if (autoplay) runtime.playPose(true, false); },
      tryBadSequence: async (kind: string) => { const [{ MotionFramePlayer }, { badSequence }] = await Promise.all([import('./pose-source'), import('./test-frames')]); try { runtime.setPoseSource(new MotionFramePlayer(badSequence(kind), { assemblyId: assembly.id, partIds: assembly.parts.map((p) => p.id) })); return 'ACEITE'; } catch (e) { return e instanceof Error ? e.message : String(e); } },
      machineVisible: () => ({ stage: runtime.stage.machineVisible, root: runtime.visuals.root.visible, mirror: runtime.stage.scene.getObjectByName('mirror')!.visible, contact: runtime.stage.contact.object.visible }),
      caption: () => caption.textContent,
      geometryStats: () => { let meshes = 0; let triangles = 0; runtime.visuals.root.traverse((o) => { const m = o as import('three').Mesh; if (!m.isMesh) return; meshes += 1; const g = m.geometry; triangles += (g.index ? g.index.count : g.attributes.position!.count) / 3; }); return { meshes, triangles: Math.round(triangles), parts: [...runtime.visuals.parts.keys()], source: runtime.visuals.source }; },
      hoseSignature: () => { let x = 0; let n = 0; runtime.visuals.root.traverse((o) => { const m = o as import('three').Mesh; if (m.isMesh && m.userData.displayOnly) { m.geometry.computeBoundingSphere(); const c = m.geometry.boundingSphere!.center; x += c.x * 3 + c.y * 5 + c.z * 7; n += 1; } }); return { sum: x, hoses: n }; },
      disposeNow: () => { runtime.dispose(); const i = runtime.renderer.info.memory; return { geometries: i.geometries, textures: i.textures, canvasInDom: document.contains(runtime.renderer.domElement) }; },
      poseApplications: () => runtime.poseApplications,
      reapply: () => { runtime.seekPose(0); },
      sourceInfo: () => ({ kind: runtime.source.kind, duration: runtime.source.durationS, time: runtime.timeS, playing: runtime.playing }),
      partWorld: (id: string) => { runtime.visuals.root.updateWorldMatrix(true, true); const o = runtime.visuals.parts.get(id); if (!o) return null; return { p: o.getWorldPosition(new Vector3()).toArray(), q: o.getWorldQuaternion(new Quaternion()).toArray() }; },
      sampleNow: () => runtime.source.sample(runtime.timeS), lastApply: () => runtime.lastApply, playPose: (on?: boolean, loop = false) => runtime.playPose(on, loop),
      pose: () => ({ timeS: runtime.timeS, playing: runtime.playing, kind: runtime.source.kind }), seekPose: (t: number) => runtime.seekPose(t),
      tiers: CINEMA_TIERS, ready: true,
    };
  }
  if (params.get('shot') && SHOT_IDS.includes(params.get('shot') as ShotId)) runtime.seekShot(params.get('shot') as ShotId, Number(params.get('t') ?? 0));
  return runtime;
}
