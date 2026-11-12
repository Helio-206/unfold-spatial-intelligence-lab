import type { SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import { checkFile } from '../experience/intake';
import { autoOutlines } from './auto-segmentation';
import { createSodRunner, type SodRunner } from './sod';
import { selectStrategy, type StrategyInput } from './strategy';
import { decodeMask, REALITY_LIMITS } from './evidence';
import type { RealityHost } from './host';
import { mountContourEditor } from './contour-editor';
import { intakeDrawing, intakeOrbit, segmentGeneric, selectKeyFrames, type IntakeImage, type IntakeResult, type Refusal } from './intake';

/**
 * The /living intake for several views of one object (photographs around a turntable, photographs from declared angles, or three technical-drawing
 * views). It runs entirely in the browser: no model call, no upload. The person SEES each extracted outline before anything is built, and every
 * assumption the intake makes is written on screen. A refusal is shown as it is; nothing falls back to a generic object.
 */
export type RealityIntakeDeps = {
  host: RealityHost;
  /** test seam: decode a File to RGBA. Default decodes with the platform on a canvas, at most MAX_SIDE pixels on the long side. */
  decode?: (file: File) => Promise<IntakeImage>;
  /** optional automatic outline proposal for the editor's «Sugerir» (network / static background) */
  suggest?: (image: IntakeImage, signal?: AbortSignal) => Promise<Uint8Array | null>;
  onDone(result: { sha256: string; plan: SpatialPlanV2; title: string }): void;
  onCancel(): void;
};
type Mode = 'turntable' | 'orbit' | 'video' | 'drawing';
type Slot = { key: string; label: string; image: IntakeImage | null; azimuth: string; thumb: string };
const MAX_SIDE = 640;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const REFUSAL_COPY: Record<Refusal['code'], string> = {
  TOO_FEW_VIEWS: 'São precisas pelo menos 2 vistas do mesmo objecto para observar profundidade. Uma só fotografia segue o caminho de interpretação por IA.',
  TOO_MANY_VIEWS: `No máximo ${REALITY_LIMITS.maxViews} vistas.`,
  MASK_UNRELIABLE: 'O contorno automático não é credível nesta vista (fundo complexo, objecto cortado ou fragmentado). Use um fundo liso ou uma imagem PNG com fundo transparente.',
  EMPTY_MASK: 'Não foi encontrado nenhum objecto nesta vista.',
  DRAWING_INCONSISTENT: 'As três vistas do desenho não partilham as mesmas dimensões, por isso não descrevem um só objecto. Nada foi construído.',
  POSE_COUNT_MISMATCH: 'Indique um ângulo para cada vista.',
  MISSING_DRAWING_VIEW: 'Faltam vistas: o desenho precisa de frente, lado e topo.',
};

export const IMAGE_LIMITS = { maxPixels: 40_000_000 } as const;
/** Reads the pixel dimensions from the file header (PNG, JPEG, WebP) WITHOUT decoding, so an oversized image is refused before it can exhaust memory. */
export function peekImageSize(b: Uint8Array): { width: number; height: number } | null {
  const u32 = (o: number) => ((b[o]! << 24) | (b[o + 1]! << 16) | (b[o + 2]! << 8) | b[o + 3]!) >>> 0;
  if (b.length > 24 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { width: u32(16), height: u32(20) };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let o = 2;
    while (o + 9 < b.length) {
      if (b[o] !== 0xff) { o++; continue; }
      const marker = b[o + 1]!; if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { o += 2; continue; }
      const len = (b[o + 2]! << 8) | b[o + 3]!;
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) return { height: (b[o + 5]! << 8) | b[o + 6]!, width: (b[o + 7]! << 8) | b[o + 8]! };
      o += 2 + len;
    }
    return null;
  }
  if (b.length > 30 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) {
    const kind = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
    if (kind === 'VP8 ') return { width: (b[26]! | (b[27]! << 8)) & 0x3fff, height: (b[28]! | (b[29]! << 8)) & 0x3fff };
    if (kind === 'VP8L') { const v = b[21]! | (b[22]! << 8) | (b[23]! << 16) | (b[24]! << 24); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
    if (kind === 'VP8X') return { width: (b[24]! | (b[25]! << 8) | (b[26]! << 16)) + 1, height: (b[27]! | (b[28]! << 8) | (b[29]! << 16)) + 1 };
  }
  return null;
}

export async function decodeImageFile(file: File): Promise<IntakeImage> {
  const head = new Uint8Array(await file.slice(0, 65_536).arrayBuffer()), size = peekImageSize(head);
  if (!size || size.width < 1 || size.height < 1) throw new Error(`Não foi possível ler as dimensões de «${file.name}».`);
  if (size.width * size.height > IMAGE_LIMITS.maxPixels) throw new Error(`«${file.name}» tem ${(size.width * size.height / 1e6).toFixed(0)} megapíxeis; o máximo é ${IMAGE_LIMITS.maxPixels / 1e6}.`);
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height)), w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(bitmap, 0, 0, w, h); bitmap.close?.();
  const data = ctx.getImageData(0, 0, w, h);
  return { name: file.name, rgba: { width: w, height: h, data: data.data } };
}

export const VIDEO_LIMITS = { maxBytes: 40_000_000, maxSeconds: 60, candidateFrames: 24, keyFrames: 8, types: ['video/mp4', 'video/webm'] } as const;
export type VideoFrames = { frames: IntakeImage[]; times: number[]; duration: number };

/** Samples `candidateFrames` evenly spaced frames of a video (at most MAX_SIDE pixels on the long side). A video of one slow turn of the object is assumed. */
export async function decodeVideoFile(file: File): Promise<VideoFrames> {
  if (!(VIDEO_LIMITS.types as readonly string[]).includes(file.type)) throw new Error(`«${file.name}» não é MP4 nem WebM.`);
  if (file.size === 0 || file.size > VIDEO_LIMITS.maxBytes) throw new Error(`«${file.name}» tem de ter até ${VIDEO_LIMITS.maxBytes / 1e6} MB.`);
  const url = URL.createObjectURL(file), video = document.createElement('video'); video.muted = true; video.preload = 'auto'; video.src = url;
  try {
    await new Promise<void>((ok, bad) => { video.onloadedmetadata = () => ok(); video.onerror = () => bad(new Error('Não foi possível ler o vídeo.')); });
    if (!Number.isFinite(video.duration)) { // MediaRecorder WebM carries no duration until the end is reached
      await new Promise<void>((ok) => { const done = () => { video.removeEventListener('timeupdate', done); ok(); }; video.addEventListener('timeupdate', done); video.currentTime = 1e7; });
    }
    const duration = video.duration; if (!(duration > 0.5) || duration > VIDEO_LIMITS.maxSeconds) throw new Error(`O vídeo tem de durar entre 0,5 s e ${VIDEO_LIMITS.maxSeconds} s.`);
    const scale = Math.min(1, MAX_SIDE / Math.max(video.videoWidth, video.videoHeight)), w = Math.max(1, Math.round(video.videoWidth * scale)), h = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h; const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const frames: IntakeImage[] = [], times: number[] = [];
    for (let i = 0; i < VIDEO_LIMITS.candidateFrames; i++) {
      const t = ((i + 0.5) / VIDEO_LIMITS.candidateFrames) * duration;
      await new Promise<void>((ok, bad) => { video.onseeked = () => ok(); video.onerror = () => bad(new Error('Falha ao ler um fotograma.')); video.currentTime = t; });
      ctx.drawImage(video, 0, 0, w, h); frames.push({ name: `${file.name}@${t.toFixed(2)}s`, rgba: { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data } }); times.push(t);
    }
    return { frames, times, duration };
  } finally { URL.revokeObjectURL(url); video.removeAttribute('src'); video.load(); }
}

export function mountRealityIntake(container: HTMLElement, deps: RealityIntakeDeps): { dispose(): void } {
  const decode = deps.decode ?? decodeImageFile;

  let editor: { index: number; dispose(): void } | null = null, abort: AbortController | null = null, videoTimes: number[] = [], videoDuration = 0, mode: Mode = 'turntable', elevation = '', slots: Slot[] = [], problem: string | null = null, result: IntakeResult | null = null, busy = false, disposed = false;
  const drawingSlots = (): Slot[] => [{ key: 'front', label: 'Frente', image: null, azimuth: '', thumb: '' }, { key: 'side', label: 'Lado direito', image: null, azimuth: '', thumb: '' }, { key: 'top', label: 'Topo', image: null, azimuth: '', thumb: '' }];
  const title = () => (container.querySelector<HTMLInputElement>('#rl-title')?.value.trim() || 'Objecto reconstruído de várias vistas').slice(0, 100);

  const thumbs = (r: IntakeResult | null) => (r ? r.views : []).map((v, i) => `<li class="sp-comp" data-rl-view="${i}"><div class="sp-comp-head"><b>${esc(v.name)}</b><span class="u-label">contorno ${v.maskSource === 'confirmed' ? 'confirmado' : `automático${v.maskMethod ? ` (${esc(v.maskMethod)}) · confirme visualmente` : ''}`} · ${v.reliable ? 'credível' : 'NÃO credível'} · ${(v.foregroundRatio * 100).toFixed(0)}% da imagem</span></div>${v.reasons.length ? `<p class="u-small">${esc(v.reasons.join('; '))}</p>` : ''}<canvas data-rl-canvas="${i}" width="120" height="90" aria-label="Contorno extraído de ${esc(v.name)}"></canvas>${v.maskSource === 'automatic' && v.reliable && mode !== 'video' && mode !== 'drawing' ? `<button class="u-btn u-btn--outline" type="button" data-rl-confirm="${i}" aria-label="Confirmar que o contorno de ${esc(v.name)} está certo">O contorno está certo</button>` : ''}</li>`).join('');
  const strategyHtml = (r: IntakeResult | null) => {
    if (!r) return '';
    const kind: StrategyInput['kind'] = mode === 'drawing' ? 'drawing-3view' : mode === 'video' ? 'video' : 'multi-image';
    const credible = !r.refusals.some((x) => x.code === 'MASK_UNRELIABLE' || x.code === 'EMPTY_MASK');
    const st = selectStrategy({ kind, views: r.views.length, outlinesCredible: credible, capture: r.capture ?? null, posesDeclared: mode === 'orbit' });
    return `<div data-rl-strategy="${st.id}"><p class="u-label">Estratégia escolhida: <b>${st.id}</b> · tecto de fidelidade: ${st.ceiling}${st.certified ? ' · configuração medida no benchmark' : ' · não certificada'}</p><ul>${[...st.reasons, ...st.limits].map((t) => `<li class="u-small">${esc(t)}</li>`).join('')}</ul>${st.requires.length ? `<p class="u-small"><b>Para melhorar:</b> ${st.requires.map(esc).join(' ')}</p>` : ''}</div>`;
  };
  const qualityHtml = (r: IntakeResult | null) => !r?.capture ? '' : `<div data-rl-capture><p class="u-label">Cobertura: ${r.capture.coverage.views} vistas · maior sector sem vista ${r.capture.coverage.azimuthMaxGapDeg.toFixed(0)}° · elevação ${r.capture.coverage.elevationMinDeg.toFixed(0)}° a ${r.capture.coverage.elevationMaxDeg.toFixed(0)}°</p>${r.capture.issues.length ? `<ul class="sp-list" aria-label="Qualidade e cobertura">${r.capture.issues.map((i) => `<li class="sp-comp" data-rl-issue="${i.code}" data-severity="${i.severity}"><div class="sp-comp-head"><b>${esc(i.message)}</b></div><p class="u-small">${esc(i.advice)}</p></li>`).join('')}</ul>` : '<p class="u-small">Sem avisos de qualidade ou cobertura. (Limiares heurísticos, não calibrados em fotografias reais.)</p>'}</div>`;
  const html = () => `<div class="sp-card sp-card--review" data-reality-intake>
    <div class="sp-head"><h1 class="sp-h1">Reconstruir a partir de várias vistas</h1><p class="u-label">reconstrução local · sem chamada à IA · nada sai do seu navegador</p></div>
    <p class="u-small">Dê várias imagens do mesmo objecto. O UNFOLD extrai o contorno de cada uma, cruza-os e constrói o sólido que todas permitem — um <b>limite superior</b> da forma. Concavidades e o que nenhuma vista mostra ficam como hipótese, e o que foi preciso assumir fica escrito.</p>
    <fieldset class="sp-field"><legend class="u-label">tipo de entrada</legend>
      <label><input type="radio" name="rl-mode" value="turntable" ${mode === 'turntable' ? 'checked' : ''}> Volta de mesa: o objecto roda, a câmara está fixa. Ângulos iguais assumidos pela ordem.</label>
      <label><input type="radio" name="rl-mode" value="orbit" ${mode === 'orbit' ? 'checked' : ''}> Ângulos que eu indico (graus, 0° = de frente)</label>
      <label><input type="radio" name="rl-mode" value="video" ${mode === 'video' ? 'checked' : ''}> Vídeo de uma volta do objecto (câmara fixa, velocidade constante)</label>
      <label><input type="radio" name="rl-mode" value="drawing" ${mode === 'drawing' ? 'checked' : ''}> Desenho técnico: frente, lado direito e topo, à mesma escala</label></fieldset>
    <label class="sp-field"><span class="u-label">nome</span><input id="rl-title" type="text" maxlength="100" placeholder="Ex.: candeeiro de mesa"></label>
    ${mode === 'drawing'
      ? `<div class="sp-row">${slots.map((s, i) => `<label class="sp-drop"><input type="file" data-rl-file-slot="${i}" accept="image/png,image/jpeg,image/webp"><span>${esc(s.label)}${s.image ? ` · ${esc(s.image.name)}` : ''}</span></label>`).join('')}</div>`
      : mode === 'video'
      ? `<label class="sp-drop"><input id="rl-video" type="file" accept="video/mp4,video/webm"><span>${slots.length ? `${slots.length} fotogramas candidatos · escolher outro vídeo` : '<u>escolha um vídeo</u>'}</span><span class="u-label">MP4 ou WebM · até ${VIDEO_LIMITS.maxBytes / 1e6} MB e ${VIDEO_LIMITS.maxSeconds} s · uma volta completa · os ${VIDEO_LIMITS.keyFrames} fotogramas com silhuetas mais diferentes são usados</span></label><label class="u-label">elevação da câmara (°) <input id="rl-elev" type="number" min="-90" max="90" step="1" value="${esc(elevation)}" style="width:84px"></label>`
      : `<label class="sp-drop"><input id="rl-files" type="file" multiple accept="image/png,image/jpeg,image/webp"><span>${slots.length ? `${slots.length} vista(s) · escolher outras` : '<u>escolha 2 a 24 imagens</u>'}</span><span class="u-label">PNG, JPEG ou WebP · fundo liso ou transparente · mesma distância e zoom</span></label>
         <label class="u-label">elevação da câmara (°) — deixe vazio se não sabe (assume-se 0° e fica registado) <input id="rl-elev" type="number" min="-90" max="90" step="1" value="${esc(elevation)}" style="width:84px"></label>
         ${mode === 'orbit' ? `<ul class="sp-list">${slots.map((s, i) => `<li class="sp-comp"><div class="sp-comp-head"><b>${esc(s.image?.name ?? s.label)}</b><label class="u-label">azimute (°) <input type="number" data-rl-az="${i}" value="${esc(s.azimuth)}" min="-360" max="360" step="1" style="width:84px"></label></div></li>`).join('')}</ul>` : ''}`}
    ${mode !== 'drawing' && slots.length ? `<ul class="sp-list" aria-label="Imagens">${slots.map((sl, i) => `<li class="sp-comp"><div class="sp-comp-head"><b>${esc(sl.image?.name ?? sl.label)}</b><span class="u-label">${sl.image?.mask ? 'contorno confirmado por si' : 'contorno automático'}</span><button class="uw-link" type="button" data-rl-edit="${i}">Ajustar contorno</button></div></li>`).join('')}</ul>` : ''}
    ${problem ? `<p class="sp-problem" role="alert">${esc(problem)}</p>` : ''}
    ${qualityHtml(result)}
    ${strategyHtml(result)}
    ${result ? `<ul class="sp-list" aria-label="Contornos extraídos">${thumbs(result)}</ul>${result.refusals.map((r) => `<p class="sp-problem" role="alert" data-rl-refusal="${r.code}">${esc(REFUSAL_COPY[r.code])}${r.viewName ? ` (${esc(r.viewName)})` : ''} <span class="u-label">${esc(r.detail)}</span></p>`).join('')}${result.evidence ? `<details open><summary class="u-label">O que foi assumido</summary><ul>${result.evidence.assumptions.map((a) => `<li class="u-small">${esc(a)}</li>`).join('')}</ul></details>` : ''}` : ''}
    <div class="sp-row"><button class="u-btn u-btn--outline" type="button" data-rl="cancel">Voltar</button><span class="sp-grow"></span>
      <button class="u-btn u-btn--outline" type="button" data-rl="analyse" ${busy ? 'disabled' : ''}>Analisar vistas</button>
      <button class="u-btn u-btn--primary" type="button" data-rl="build" ${busy || !result?.evidence ? 'disabled' : ''}>Reconstruir</button></div></div>`;

  const paint = () => {
    if (disposed) return;
    const keepTitle = container.querySelector<HTMLInputElement>('#rl-title')?.value ?? '';
    container.innerHTML = html();
    const input = container.querySelector<HTMLInputElement>('#rl-title'); if (input) input.value = keepTitle;
    result?.views.forEach((_, i) => drawMask(container.querySelector<HTMLCanvasElement>(`[data-rl-canvas="${i}"]`), i));

  };
  const drawMask = (canvas: HTMLCanvasElement | null, i: number) => {
    const ev = result?.evidence; if (!canvas || !ev) return;
    const v = ev.views[i]; if (!v) return; const m = decodeMask(v.maskRle, ev.res * ev.res), ctx = canvas.getContext('2d')!, img = ctx.createImageData(canvas.width, canvas.height);
    for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) { const k = (y * canvas.width + x) * 4, on = m[Math.floor((canvas.height - 1 - y) / canvas.height * ev.res) * ev.res + Math.floor(x / canvas.width * ev.res)]; img.data[k] = on ? 80 : 20; img.data[k + 1] = on ? 190 : 24; img.data[k + 2] = on ? 255 : 30; img.data[k + 3] = 255; }
    ctx.putImageData(img, 0, 0);
  };

  const take = async (files: File[], into?: number) => {
    problem = null; result = null; busy = true; paint();
    try {
      const decoded: Slot[] = [];
      for (const f of files) {
        const bad = checkFile(f); if (bad) { problem = bad.message; break; }
        decoded.push({ key: f.name, label: f.name, image: await decode(f), azimuth: '', thumb: '' });
      }
      if (!problem) {
        if (into !== undefined) { slots = slots.map((s, i) => (i === into ? { ...s, image: decoded[0]!.image } : s)); }
        else { if (decoded.length > REALITY_LIMITS.maxViews) problem = `No máximo ${REALITY_LIMITS.maxViews} vistas.`; else slots = decoded.map((s, i) => ({ ...s, azimuth: String(Math.round((360 * i) / decoded.length)) })); }
      }
    } catch { problem = 'Não foi possível ler uma das imagens.'; }
    busy = false; paint();
  };

  const elev = (): { elevationDeg?: number } => { const e = elevation.trim() === '' ? NaN : Number(elevation); return Number.isFinite(e) ? { elevationDeg: Math.max(-90, Math.min(90, e)) } : {}; };
  const takeVideo = async (file: File) => {
    problem = null; result = null; busy = true; paint();
    try { const v = await decodeVideoFile(file); slots = v.frames.map((f) => ({ key: f.name, label: f.name, image: f, azimuth: '', thumb: '' })); videoTimes = v.times; videoDuration = v.duration; }
    catch (e) { problem = e instanceof Error ? e.message : 'Não foi possível ler o vídeo.'; slots = []; }
    busy = false; paint();
  };
  let sodRunner: SodRunner | null = null;
  /** the images of the last analysis (with their automatic outlines) and the slot each came from, so a person can confirm an automatic outline as it is */
  let lastImages: IntakeImage[] = [], lastSlots: number[] = [];
  /** Gives every image without a person's outline the best automatic one (static background, salient network, colour), recording the method; the rest is left for the gate and the editor. */
  const withAutoOutlines = async (images: IntakeImage[]): Promise<IntakeImage[]> => {
    const todo = images.map((im, i) => (im.mask ? -1 : i)).filter((i) => i >= 0); if (!todo.length) return images;
    sodRunner ??= createSodRunner(); const outs = await autoOutlines(todo.map((i) => images[i]!.rgba), { sod: sodRunner }), out = images.slice();
    todo.forEach((i, k) => { const o = outs[k]!; if (o.mask && o.method) out[i] = { ...images[i]!, mask: o.mask, maskSource: 'automatic', maskMethod: `${o.method}${o.consensus ? ` · concordância ${(o.consensus * 100).toFixed(0)}%` : ' · sem confirmação por outra estratégia'}` }; });
    return out;
  };
  const analyse = async (): Promise<IntakeResult | null> => {
    problem = null; busy = true; paint();
    try { return await analyseNow(); } finally { busy = false; }
  };
  const analyseNow = async (): Promise<IntakeResult | null> => {
    if (mode === 'drawing') {
      const [front, side, top] = slots.map((s) => s.image);
      result = intakeDrawing({ ...(front ? { front } : {}), ...(side ? { side } : {}), ...(top ? { top } : {}) });
    } else if (mode === 'video') {
      // key frames by silhouette diversity; azimuth from the frame's time (constant angular speed over the whole clip) - assumed, not measured
      const candidates = await withAutoOutlines(slots.map((s) => s.image!).filter(Boolean));
      if (candidates.length < 2) { result = intakeOrbit(candidates); return result; }
      const masks = candidates.map((im) => ({ mask: im.mask ?? segmentGeneric(im.rgba).mask })), picks = selectKeyFrames(masks, VIDEO_LIMITS.keyFrames);
      result = intakeOrbit(picks.map((i) => candidates[i]!), { azimuthsDeg: picks.map((i) => 360 * (videoTimes[i]! / videoDuration)), azimuthsAssumed: true, mode: 'video', ...elev() });
    } else {
      const images = await withAutoOutlines(slots.map((s) => s.image!).filter(Boolean));
      lastImages = images; lastSlots = slots.map((s, i) => (s.image ? i : -1)).filter((i) => i >= 0);
      if (mode === 'orbit') {
        const az = slots.map((s) => Number(s.azimuth));
        if (az.some((a) => !Number.isFinite(a))) { problem = REFUSAL_COPY.POSE_COUNT_MISMATCH; result = null; return null; }
        result = intakeOrbit(images, { azimuthsDeg: az, ...elev() });
      } else result = intakeOrbit(images, elev());
    }
    return result;
  };

  const openEditor = (index: number) => {
    const sl = slots[index]; if (!sl?.image) return; editor?.dispose();
    const slot = document.createElement('div'); container.replaceChildren(slot);
    const mounted = mountContourEditor(slot, {
      image: sl.image, index, total: slots.length, initialMask: sl.image.mask ?? null,
      segment: (request, signal) => deps.host.segment(request, signal), suggest: async () => { const [o] = await withAutoOutlines([{ ...sl.image!, mask: undefined as never }]); return o?.mask ?? null; },
      onAccept: (mask) => { slots[index]!.image = { ...slots[index]!.image!, mask }; closeEditor(); result = null; paint(); },
      onCancel: () => { closeEditor(); paint(); },
      onNavigate: (delta) => { const n = index + delta; if (slots[n]?.image) openEditor(n); },
    });
    editor = { index, dispose: mounted.dispose };
  };
  const closeEditor = () => { editor?.dispose(); editor = null; };
  const onClick = (event: Event) => {
    const ed = (event.target as HTMLElement).closest<HTMLElement>('[data-rl-edit]');
    if (ed) { event.stopPropagation(); openEditor(Number(ed.dataset.rlEdit)); return; }
    const cf = (event.target as HTMLElement).closest<HTMLElement>('[data-rl-confirm]');
    if (cf) { // a person looked at the outline and says it is right: that is HUMAN CONFIRMATION (a different category from the automatic proposal)
      event.stopPropagation(); const k = Number(cf.dataset.rlConfirm), slotIndex = lastSlots[k], img = lastImages[k];
      if (slotIndex !== undefined && img?.mask) { slots[slotIndex]!.image = { ...img, maskSource: 'confirmed' }; delete (slots[slotIndex]!.image as { maskMethod?: string }).maskMethod; result = null; void analyse().then(() => paint()); }
      return;
    }
    const b = (event.target as HTMLElement).closest<HTMLElement>('[data-rl]'); if (!b) return;
    event.stopPropagation();
    const act = b.dataset.rl;
    if (act === 'cancel') { abort?.abort(); deps.onCancel(); }
    else if (act === 'analyse') { void analyse().then(() => paint()); }
    else if (act === 'build' && result?.evidence && !busy) {
      busy = true; paint();
      abort = new AbortController();
      void deps.host.create(result.evidence, title(), abort.signal).then((r) => { if (!disposed) deps.onDone({ sha256: r.sha256, plan: r.plan, title: r.plan.title }); }).catch((e) => { if (disposed || (e as DOMException)?.name === 'AbortError') return; problem = (e as { code?: string })?.code === 'REALITY_EMPTY_RECONSTRUCTION' ? 'As vistas não são consistentes entre si: o casco ficou vazio. Quase de certeza um ou mais contornos estão errados (ou a ordem das imagens não é a da volta). Abra «Ajustar contorno» nas vistas marcadas e volte a analisar. Nada foi construído.' : 'A reconstrução falhou. Nada foi construído.'; busy = false; paint(); });
    }
  };
  const onChange = (event: Event) => {
    const t = event.target as HTMLInputElement;
    if (t.name === 'rl-mode') { mode = t.value as Mode; slots = mode === 'drawing' ? drawingSlots() : []; result = null; problem = null; paint(); }
    else if (t.id === 'rl-files' && t.files) void take([...t.files]);
    else if (t.id === 'rl-video' && t.files?.[0]) void takeVideo(t.files[0]);
    else if (t.dataset.rlFileSlot !== undefined && t.files?.[0]) void take([t.files[0]], Number(t.dataset.rlFileSlot));
    else if (t.id === 'rl-elev') { elevation = t.value; result = null; }
    else if (t.dataset.rlAz !== undefined) { slots[Number(t.dataset.rlAz)]!.azimuth = t.value; result = null; }
  };
  container.addEventListener('click', onClick); container.addEventListener('change', onChange);
  paint();
  return { dispose() { disposed = true; abort?.abort(); editor?.dispose(); container.removeEventListener('click', onClick); container.removeEventListener('change', onChange); } };
}
