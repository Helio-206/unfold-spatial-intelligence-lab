/**
 * UNFOLD premium spatial experience (prototype): Reconstruction → Transition → Living Workspace, on the cinema stage.
 *
 *  - Reconstruction: the imported side elevation on a Paper sheet, the reconstruction's regions drawn by status
 *    (observed / hypothesis / unknown) and a one-item-at-a-time human review. Nothing is promoted without a decision.
 *  - Transition: the reviewed sheet hinges onto the floor (the fold), the machine grows out of it, the camera travels
 *    from the drawing's elevation to the hero view. Presentation only (clip plane, ghost materials); poses untouched.
 *  - Living Workspace: the machine dominant on a dark concrete stage; uncertainty is marked on the parts themselves.
 *
 * Query: ?phase=lab (skip to the lab with the demo review) · ?demo=reviewed · ?tier=… · ?rm=1 · ?livery=paper
 */
import '../../brand.css';
import './experience.css';
import * as THREE from 'three';
import { applyMotionTokens } from '../../motion/tokens';
import { CinemaRuntime, ReferencePoseSource, foundryVisualProvider, type CinemaTier } from '../cinema';
import { EXCAVATOR_ASSEMBLY_V1 } from '../contracts/fixtures/excavator.assembly.v1';
import { referencePoses } from '../visual-foundry/poses';
import { convexHull } from '../visual-foundry/geometry';
import { renderDrawing, type DrawingResult } from './drawing';
import { DRAWING_REFERENCE, ENTITY_PARTS, reconstructionFixture } from './reconstruction-fixture';
import { CATEGORY_LABEL, initialReview, labCategory, partCategories, reduceReview, summarize, type ReviewAction, type ReviewItem, type ReviewState } from './review';
import { applyDirection, type Direction, type LiveryName } from './stage-direction';
import { TRANSITION_TOTAL, transitionAt } from './transition';

type Phase = 'reconstruction' | 'transition' | 'lab';
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const STATUS_LABEL = { observed: 'observado', hypothesis: 'hipótese', unknown: 'desconhecido' } as const;
const DEMO: Array<[string, 'confirmed' | 'rejected']> = [['e_boom', 'confirmed'], ['e_boom_cyl', 'confirmed'], ['e_stick_cyl', 'confirmed'], ['e_bucket_cyl', 'rejected']];

export async function mountExperience(app: HTMLElement): Promise<void> {
  applyMotionTokens();
  const q = new URLSearchParams(location.search);
  const reducedMotion = q.has('rm') ? q.get('rm') === '1' : matchMedia('(prefers-reduced-motion: reduce)').matches;
  const assembly = EXCAVATOR_ASSEMBLY_V1;
  const observation = reconstructionFixture();
  let review: ReviewState = initialReview(observation);
  if (q.get('demo') === 'reviewed' || q.get('phase') === 'lab') for (const [id, decision] of DEMO) review = reduceReview(review, { type: 'decide', id, decision });
  let phase: Phase = 'reconstruction';

  app.innerHTML = `
    <div class="ux-root u-root" data-theme="dark" data-phase="reconstruction" data-reduced-motion="${reducedMotion}">
      <div class="ux-stage" id="ux-stage" aria-hidden="true"></div>
      <div class="ux-chips" id="ux-chips" aria-hidden="true"></div>
      <header class="ux-brand"><img src="/design-system/logos/unfold-lockup-on-dark.svg" alt="UNFOLD"><span class="u-label" id="ux-context">reconstrução · ${esc(DRAWING_REFERENCE)}</span></header>
      <section class="ux-recon" id="ux-recon" aria-label="Reconstrução">
        <figure class="ux-sheet" id="ux-sheet" data-theme="light"><img id="ux-sheet-img" alt="Alçado lateral da escavadora (desenho de fixture gerado a partir do modelo canónico)"><svg id="ux-regions" aria-hidden="true"></svg></figure>
        <p class="ux-sheet-note u-label">desenho de fixture, gerado a partir do modelo canónico sintético · as regiões vêm de uma reconstrução de fixture (sem chamada ao modelo)</p>
        <div class="ux-dock" id="ux-dock">
          <div class="ux-counts u-label" id="ux-counts" aria-live="polite"></div>
          <div class="ux-review" id="ux-review" aria-live="polite"></div>
          <div class="ux-go"><button class="u-btn u-btn--primary" id="ux-enter" type="button">Abrir no laboratório</button><p class="u-label" id="ux-enter-note"></p></div>
        </div>
      </section>
      <section class="ux-lab" id="ux-lab" aria-label="Laboratório" hidden>
        <div class="ux-lab-state u-label" id="ux-lab-state"></div>
        <nav class="ux-lab-tools" aria-label="Laboratório">
          <button class="u-btn u-btn--outline" id="ux-back" type="button">Rever reconstrução</button>
          <button class="u-btn u-btn--outline" id="ux-hero" type="button">Plano herói</button>
        </nav>
        <p class="ux-caption" id="ux-caption" role="status" aria-live="polite"></p>
      </section>
      <p class="ux-loading u-label" id="ux-loading">a preparar o palco…</p>
    </div>`;
  const $ = <T extends HTMLElement>(id: string) => app.querySelector<T>(`#${id}`)!;
  const root = app.querySelector<HTMLElement>('.ux-root')!;

  // the sheet first (it is the first thing a person sees), then the stage behind it
  const drawing: DrawingResult = renderDrawing(assembly);
  ($('ux-sheet-img') as HTMLImageElement).src = drawing.dataUrl;
  const runtime = await CinemaRuntime.create({
    host: $('ux-stage'), assembly, provider: foundryVisualProvider(), reducedMotion, tier: (q.get('tier') as CinemaTier | null),
    poseSource: new ReferencePoseSource(assembly.id, referencePoses().poses),
    onInspect: (id) => inspect(id),
  });
  const direction: Direction = applyDirection(runtime, (q.get('livery') as LiveryName | null) ?? 'graphite');
  runtime.director.release();
  $('ux-loading').hidden = true;
  const sheet3d = buildSheet3d(runtime, drawing);
  const views = cameraViews(runtime, drawing);

  // ------------------------------------------------------------------------------------------ reconstruction view
  const regionsSvg = $('ux-regions') as unknown as SVGSVGElement;
  regionsSvg.setAttribute('viewBox', `0 0 ${drawing.projection.px[0]} ${drawing.projection.px[1]}`);
  const entityHull = (id: string) => {
    const pts = (ENTITY_PARTS[id] ?? []).flatMap((p) => drawing.regions.get(p) ?? []);
    if (id === 'e_counterweight') { const r = drawing.regions.get('upper_body') ?? []; const xs = r.map((p) => p[0]); const maxX = Math.max(...xs); return r.filter((p) => p[0] > maxX - (maxX - Math.min(...xs)) * 0.3); }
    return pts;
  };
  /** Convex hull of the entity's parts, grown outward by `pad` px from its centroid: tight around diagonal parts. */
  const hullOf = (pts: Array<[number, number]>, pad = 14) => {
    const hull = convexHull(pts);
    const cx = hull.reduce((a, p) => a + p[0], 0) / hull.length, cy = hull.reduce((a, p) => a + p[1], 0) / hull.length;
    const grown = hull.map(([x, y]) => { const d = Math.hypot(x - cx, y - cy) || 1; return [x + ((x - cx) / d) * pad, y + ((y - cy) / d) * pad] as [number, number]; });
    const top = grown.reduce((a, p) => (p[1] < a[1] ? p : a), grown[0]!);
    return { points: grown.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' '), top };
  };
  function renderRegions() {
    regionsSvg.innerHTML = review.items.map((item) => {
      const pts = entityHull(item.id); if (pts.length < 3) return '';
      const h = hullOf(pts as Array<[number, number]>);
      const cat = labCategory(item); const focus = review.focusId === item.id;
      return `<g class="ux-region" data-status="${item.status}" data-cat="${cat}" data-focus="${focus}" data-id="${esc(item.id)}">
        <polygon points="${h.points}"/>
        <text x="${h.top[0].toFixed(1)}" y="${(h.top[1] - 12).toFixed(1)}" text-anchor="middle">${esc(item.label)} · ${esc(cat === 'confirmed' ? 'confirmado' : cat === 'rejected' ? 'rejeitado' : STATUS_LABEL[item.status])}</text></g>`;
    }).join('');
  }
  function renderReview() {
    const s = summarize(review);
    $('ux-counts').innerHTML = `<span><b>${s.confirmed}</b> confirmados</span><span><b>${s.observed}</b> observados</span><span><b>${s.pendingHypotheses}</b> hipóteses por rever</span><span><b>${s.unknown}</b> desconhecidos</span><span><b>${s.rejected}</b> rejeitados</span>`;
    const item = review.items.find((i) => i.id === review.focusId);
    $('ux-review').innerHTML = item ? reviewCard(item, review) : '';
    ($('ux-enter') as HTMLButtonElement).disabled = !s.canEnterLab;
    $('ux-enter-note').textContent = s.canEnterLab ? `${s.unknown} desconhecidos entram como desconhecidos` : `Decida ${s.pendingHypotheses} hipótese${s.pendingHypotheses === 1 ? '' : 's'} antes de continuar`;
    renderRegions();
  }
  const dispatch = (a: ReviewAction) => { review = reduceReview(review, a); renderReview(); };
  app.addEventListener('click', (e) => {
    const t = (e.target as Element).closest<HTMLElement | SVGElement>('[data-review], .ux-region'); if (!t) return;
    const d = (t as HTMLElement).dataset;
    if (d.review === 'confirm') dispatch({ type: 'decide', id: d.id!, decision: 'confirmed' });
    else if (d.review === 'reject') dispatch({ type: 'decide', id: d.id!, decision: 'rejected' });
    else if (d.review === 'undo') dispatch({ type: 'decide', id: d.id!, decision: 'pending' });
    else if (d.review === 'next') dispatch({ type: 'next' });
    else if (d.review === 'focus' || t.classList.contains('ux-region')) dispatch({ type: 'focus', id: d.id! });
  });
  window.addEventListener('keydown', (e) => {
    if (phase !== 'reconstruction' || (e.target as HTMLElement).closest('input, textarea')) return;
    const idx = review.items.findIndex((i) => i.id === review.focusId);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const n = review.items[(idx + (e.key === 'ArrowRight' ? 1 : review.items.length - 1)) % review.items.length]!; dispatch({ type: 'focus', id: n.id }); }
    else if (e.key === 'c' && review.focusId) dispatch({ type: 'decide', id: review.focusId, decision: 'confirmed' });
    else if (e.key === 'x' && review.focusId) dispatch({ type: 'decide', id: review.focusId, decision: 'rejected' });
  });
  renderReview();

  // ------------------------------------------------------------------------------------------ transition + lab
  let raf = 0;
  const categories = () => partCategories(review, ENTITY_PARTS);
  function setLabMaterials() {
    const cats = categories();
    direction.setMachineGhost([...cats].filter(([, c]) => c === 'rejected' || c === 'unknown').map(([p]) => p));
  }
  function enterLab(animated: boolean) {
    if (!summarize(review).canEnterLab) return;
    phase = 'transition'; root.dataset.phase = 'transition';
    $('ux-context').textContent = 'laboratório · revisão local, não gravada';
    $('ux-recon').hidden = true; runtime.resume();
    setLabMaterials();
    const t0 = performance.now();
    const step = () => {
      const f = transitionAt((performance.now() - t0) / 1000, reducedMotion || !animated);
      sheet3d.set(f.sheetAngle, f.sheetOpacity);
      direction.setReveal(f.reveal >= 1 ? null : f.reveal);
      views.blend(f.camera);
      root.style.setProperty('--ux-annotations', String(f.annotations));
      if (!f.done) { raf = requestAnimationFrame(step); return; }
      sheet3d.set(Math.PI / 2, 0.035); // the drawing stays on the floor as a trace, not a surface
      phase = 'lab'; root.dataset.phase = 'lab'; $('ux-lab').hidden = false; renderLab();
    };
    step();
  }
  function renderLab() {
    const s = summarize(review);
    $('ux-lab-state').innerHTML = `<span>revisão</span><b>${s.confirmed}</b> confirmados · <b>${s.observed}</b> observados · <b>${s.unknown}</b> desconhecidos · <b>${s.rejected}</b> rejeitados`;
    placeChips();
  }
  function placeChips() {
    if (phase !== 'lab') { $('ux-chips').innerHTML = ''; return; }
    // only uncertainty gets a mark on the part (unknown, rejected); observed-but-unconfirmed is counted in the summary
    const marks = review.items.filter((i) => ['unknown', 'rejected'].includes(labCategory(i)));
    const placed: Array<{ x: number; y: number }> = [];
    $('ux-chips').innerHTML = marks.map((i) => {
      const part = i.id === 'e_counterweight' ? 'upper_body' : (ENTITY_PARTS[i.id] ?? [])[0]; const b = part ? runtime.screenBox(part) : null; if (!b) return '';
      const cat = labCategory(i);
      let x = Math.min(Math.max(b.x + b.w / (i.id === 'e_counterweight' ? 1.25 : 2), 120), innerWidth - 120), y = Math.max(b.y + b.h / 2, 80);
      while (placed.some((p) => Math.abs(p.x - x) < 220 && Math.abs(p.y - y) < 30)) y += 32; // stack instead of overlapping
      placed.push({ x, y });
      return `<span class="ux-chip" data-cat="${cat}" style="left:${x}px;top:${y}px">${esc(i.label)} · ${esc(CATEGORY_LABEL[cat])}</span>`;
    }).join('');
  }
  function inspect(partId: string | null) {
    if (phase !== 'lab') return;
    if (!partId) { $('ux-caption').textContent = ''; return; }
    const c = categories().get(partId);
    const entry = runtime.visuals.registry?.ownerOfPart?.(partId);
    $('ux-caption').innerHTML = `<b>${esc(entry?.label ?? partId)}</b> <span class="u-label">${esc(c ? CATEGORY_LABEL[c] : 'sem entidade na reconstrução')} · geometria do fixture canónico</span>`;
  }
  $('ux-enter').addEventListener('click', () => enterLab(true));
  $('ux-back').addEventListener('click', () => {
    cancelAnimationFrame(raf); phase = 'reconstruction'; root.dataset.phase = 'reconstruction';
    $('ux-lab').hidden = true; $('ux-recon').hidden = false; $('ux-chips').innerHTML = '';
    $('ux-context').textContent = `reconstrução · ${DRAWING_REFERENCE}`;
    direction.setMachineGhost([]); direction.setReveal(0); sheet3d.set(0, 1); views.blend(0); runtime.suspend(); renderReview();
  });
  $('ux-hero').addEventListener('click', () => views.blend(1));
  runtime.controls.addEventListener('change', () => { if (phase === 'lab') requestAnimationFrame(placeChips); });
  addEventListener('resize', () => requestAnimationFrame(placeChips));

  direction.setReveal(0); sheet3d.set(0, 1); views.blend(0);
  if (q.get('phase') === 'lab') enterLab(false); else runtime.suspend();
  Object.assign(window, { __experience: { ready: true, phase: () => phase, review: () => review, summary: () => summarize(review), enterLab, runtime, dispatch, transitionAt, TRANSITION_TOTAL } });
}

function reviewCard(item: ReviewItem, state: ReviewState): string {
  const cat = labCategory(item);
  const pos = state.items.indexOf(item) + 1;
  const actions = item.decision !== 'pending'
    ? `<button class="u-btn u-btn--outline" data-review="undo" data-id="${esc(item.id)}" type="button">Desfazer</button>`
    : item.status === 'unknown'
      ? `<button class="u-btn u-btn--outline" data-review="reject" data-id="${esc(item.id)}" type="button">Rejeitar</button><span class="u-label">fica desconhecido: não há nada para confirmar</span>`
      : `<button class="u-btn u-btn--ink" data-review="confirm" data-id="${esc(item.id)}" type="button">Confirmar</button><button class="u-btn u-btn--outline" data-review="reject" data-id="${esc(item.id)}" type="button">Rejeitar</button>`;
  return `<article class="ux-card" data-status="${item.status}">
    <header><span class="u-label">${pos} / ${state.items.length}</span><span class="ux-status" data-status="${item.status}">${esc(STATUS_LABEL[item.status])}</span><span class="u-data">confiança ${item.confidence.toFixed(2)}</span>${cat === 'confirmed' || cat === 'rejected' ? `<span class="ux-decision">${esc(CATEGORY_LABEL[cat])}</span>` : ''}</header>
    <h2>${esc(item.label)}</h2>
    <p class="u-small">${esc(item.evidence[0] ?? 'Sem evidência.')}</p>
    <div class="ux-actions">${actions}<button class="ux-next" data-review="next" type="button" aria-label="Próxima hipótese por rever">próxima hipótese →</button></div>
  </article>`;
}

/** The drawing as a plane in the scene, hinged on its bottom edge at floor level, registered with the elevation camera. */
function buildSheet3d(runtime: CinemaRuntime, drawing: DrawingResult) {
  const tex = new THREE.TextureLoader().load(drawing.dataUrl, () => runtime.controls.dispatchEvent({ type: 'change' }));
  tex.colorSpace = THREE.SRGBColorSpace;
  const { widthM, heightM, centre } = drawing.projection;
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(widthM, heightM), mat);
  plane.rotation.y = Math.PI; // faces −Z (the elevation camera); the image reads correctly from there
  const bottom = centre[1] - heightM / 2;
  plane.position.set(0, heightM / 2, 0);
  const hinge = new THREE.Group(); hinge.name = 'experience:sheet'; hinge.position.set(centre[0], bottom + 0.004, SHEET_Z); hinge.add(plane);
  runtime.stage.scene.add(hinge);
  return {
    set(angle: number, opacity: number) { hinge.rotation.x = -angle; mat.opacity = opacity; hinge.visible = opacity > 0.01; runtime.controls.dispatchEvent({ type: 'change' }); },
  };
}
const SHEET_Z = -1.9;

/** Elevation camera (registered with the sheet) and the hero three-quarter view; blend 0 → 1. */
function cameraViews(runtime: CinemaRuntime, drawing: DrawingResult) {
  const cam = runtime.camera; const { widthM, heightM, centre } = drawing.projection;
  const dist = 60;
  const sideFov = (2 * Math.atan(heightM / 2 / dist) * 180) / Math.PI;
  const side = { pos: new THREE.Vector3(centre[0], centre[1], SHEET_Z - dist), target: new THREE.Vector3(centre[0], centre[1], SHEET_Z), fov: sideFov };
  const box = new THREE.Box3().setFromObject(runtime.visuals.root); const c = box.getCenter(new THREE.Vector3());
  // hero: low, three-quarter from the front-left, arm on the left of frame (the reference's composition)
  const heroTarget = new THREE.Vector3(c.x - 0.2, c.y - 0.35, c.z);
  const heroDir = new THREE.Vector3(0.62, 0.12, -0.78).normalize();
  // portrait screens: keep the whole machine width inside the horizontal field of view
  const aspect = Math.max(0.3, runtime.renderer.domElement.clientWidth / Math.max(1, runtime.renderer.domElement.clientHeight));
  const hfov = 2 * Math.atan(Math.tan((30 * Math.PI) / 360) * aspect);
  const widthFit = (box.getSize(new THREE.Vector3()).x * 0.55) / Math.tan(hfov / 2);
  const hero = { pos: heroTarget.clone().addScaledVector(heroDir, Math.max(15.5, widthFit)), target: heroTarget, fov: 30 };
  void widthM;
  const maxBefore = runtime.controls.maxDistance;
  return {
    blend(k: number) {
      // the registered elevation camera sits far away; lift the orbit limit only while travelling, restore it at the hero view
      runtime.controls.maxDistance = k < 1 ? Infinity : Math.max(maxBefore, hero.pos.distanceTo(hero.target) * 1.25);
      // travel on a wide arc (through a point pulled away from the machine) so the camera never crosses it
      const mid = side.pos.clone().lerp(hero.pos, 0.5).add(new THREE.Vector3(0, 3, -8));
      const a = side.pos.clone().lerp(mid, k), b = mid.clone().lerp(hero.pos, k);
      cam.position.copy(a.lerp(b, k));
      runtime.controls.target.copy(side.target.clone().lerp(hero.target, k));
      cam.fov = side.fov + (hero.fov - side.fov) * k; cam.updateProjectionMatrix();
      cam.lookAt(runtime.controls.target);
      runtime.controls.update(); runtime.controls.dispatchEvent({ type: 'change' });
    },
  };
}
