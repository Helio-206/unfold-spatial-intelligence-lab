import lockupDark from '../../../design-system/logos/unfold-lockup-on-dark.svg';
import { EXCAVATOR_ASSEMBLY_V1 } from '../contracts/fixtures/excavator.assembly.v1';
import referencePose from '../contracts/fixtures/excavator.reference-pose.json';
import { CinemaRuntime, type CinemaStats } from './cinema-runtime';
import { SHOT_IDS, type ShotId } from './choreography';
import { CINEMA_TIERS, type CinemaTier } from './quality';
import { ReferencePoseSource, referencePartsFrom, type PoseSample } from './pose-source';
import { CaptionState } from './caption';
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
          <div><dt>estado</dt><dd id="ro-status">—</dd></div>
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

  const refParts = referencePartsFrom(referencePose);
  let runtime: CinemaRuntime;
  try {
    runtime = await CinemaRuntime.create({
      host: $('#cinema-stage'), assembly, poseSource: new ReferencePoseSource(assembly.id, refParts),
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
    $('#ro-pose').textContent = s.status === 'reference' ? 'referência (fixture)' : s.poseBasis === 'none' ? 'sem pose' : `${s.poseBasis}${s.interpolated ? ' · suavizada entre dois quadros (sem medidas)' : ''}`;
    $('#ro-status').textContent = s.status === 'reference' ? 'sem movimento' : s.status;
    $('#ro-status').parentElement!.classList.toggle('is-unknown', s.status === 'blocked' || s.status === 'invalid_assembly');
    caption.textContent = captions.frame(s);
  }
  const markTier = (tier: CinemaTier) => { app.querySelectorAll<HTMLButtonElement>('[data-tier]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tier === tier))); };
  markTier(runtime.tier);
  const readout = () => { const s: CinemaStats = runtime.stats(); $('#ro-tier').textContent = `${TIER_LABEL[s.tier]}${s.degrade ? ` · −${s.degrade}` : ''} · ${s.pixelRatio.toFixed(2)}×`; $('#ro-frame').textContent = `${s.lastFrameMs.toFixed(0)} ms · ${s.calls} chamadas`; };
  const readoutTimer = window.setInterval(readout, 800); readout();

  // --- controls ---------------------------------------------------------------------------------------------------
  app.querySelectorAll<HTMLButtonElement>('[data-shot]').forEach((b) => b.addEventListener('click', () => { runtime.cut(b.dataset.shot as ShotId); say(`Plano: ${SHOT_LABEL[b.dataset.shot as ShotId]}`); }));
  $('#cinema-tour').addEventListener('click', () => { runtime.tour(); say('Percurso: herói, perfil, balde, alcance.'); });
  $('#cinema-free').addEventListener('click', () => { runtime.free(); say('Câmara livre: arraste para rodar, role para aproximar.'); });
  app.querySelectorAll<HTMLButtonElement>('[data-tier]').forEach((b) => b.addEventListener('click', () => { runtime.setTier(b.dataset.tier as CinemaTier); markTier(runtime.tier); say(`Qualidade: ${TIER_LABEL[runtime.tier]}`); }));
  const play = $<HTMLButtonElement>('#cinema-play'); play.hidden = runtime.source.durationS <= 0;
  const togglePlay = () => { if (runtime.source.durationS <= 0) return; runtime.playPose(); play.textContent = runtime.playing ? 'Pausa' : 'Reproduzir'; };
  play.addEventListener('click', togglePlay);

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
  window.addEventListener('pagehide', () => { clearInterval(readoutTimer); runtime.dispose(); });
  if (params.get('ui') === '0') { setHidden(true); root.classList.add('is-idle'); clearTimeout(hideTimer); }

  if (params.has('debug-cinema')) {
    (window as unknown as { __unfoldCinema?: unknown }).__unfoldCinema = {
      runtime, stats: () => runtime.stats(), seekShot: (id: ShotId, t: number) => runtime.seekShot(id, t), renderNow: () => runtime.renderNow(), setTier: (t: CinemaTier) => { runtime.setTier(t); markTier(t); },
      camera: () => ({ position: runtime.camera.position.toArray(), target: runtime.controls.target.toArray(), fov: runtime.camera.fov }), canvas: () => runtime.renderer.domElement,
      ablate: (f: Parameters<CinemaRuntime['ablate']>[0]) => runtime.ablate(f), screenBox: (id: string) => runtime.screenBox(id), benchmark: (n?: number) => runtime.benchmark(n),
      playTransportFrames: async (variant: 'basic' | 'poseless' = 'basic', autoplay = true) => { const [{ MotionFramePlayer }, { transportTestFrames }] = await Promise.all([import('./pose-source'), import('./test-frames')]); runtime.setPoseSource(new MotionFramePlayer(transportTestFrames({ poseless: variant === 'poseless' }), { assemblyId: assembly.id, partIds: assembly.parts.map((p) => p.id) })); play.hidden = false; if (autoplay) runtime.playPose(true, false); },
      tryBadSequence: async (kind: string) => { const [{ MotionFramePlayer }, { badSequence }] = await Promise.all([import('./pose-source'), import('./test-frames')]); try { runtime.setPoseSource(new MotionFramePlayer(badSequence(kind), { assemblyId: assembly.id, partIds: assembly.parts.map((p) => p.id) })); return 'ACEITE'; } catch (e) { return e instanceof Error ? e.message : String(e); } },
      machineVisible: () => ({ stage: runtime.stage.machineVisible, root: runtime.visuals.root.visible, mirror: runtime.stage.scene.getObjectByName('mirror')!.visible, contact: runtime.stage.contact.object.visible }),
      caption: () => caption.textContent,
      pose: () => ({ timeS: runtime.timeS, playing: runtime.playing, kind: runtime.source.kind }), seekPose: (t: number) => runtime.seekPose(t),
      tiers: CINEMA_TIERS, ready: true,
    };
  }
  if (params.get('shot') && SHOT_IDS.includes(params.get('shot') as ShotId)) runtime.seekShot(params.get('shot') as ShotId, Number(params.get('t') ?? 0));
  return runtime;
}
