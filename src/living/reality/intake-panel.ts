import type { SpatialPlanV2 } from '../../universal-spatial/contracts-v2';
import { checkFile } from '../experience/intake';
import { selectStrategy, type StrategyInput } from './strategy';
import { decodeMask, REALITY_LIMITS } from './evidence';
import type { RealityHost } from './host';
import type { Point, SegmentationHint } from './interactive-segmentation';
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
  onDone(result: { sha256: string; plan: SpatialPlanV2; title: string }): void;
  onCancel(): void;
};
type Mode = 'turntable' | 'orbit' | 'video' | 'drawing';
type Slot = { key: string; label: string; image: IntakeImage | null; azimuth: string; thumb: string };
const MAX_SIDE = 640;
const EDIT_W = 560, EDIT_H = (im: IntakeImage) => Math.max(1, Math.round((EDIT_W * im.rgba.height) / im.rgba.width));
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
  type Editor = { index: number; tool: 'box' | 'fg' | 'bg'; box: { x0: number; y0: number; x1: number; y1: number } | null; fg: Point[]; bg: Point[]; mask: Uint8Array | null; busy: boolean; note: string | null; canvas: HTMLCanvasElement | null; dragging: boolean; scale: number };
  let editor: Editor | null = null, abort: AbortController | null = null, videoTimes: number[] = [], videoDuration = 0, mode: Mode = 'turntable', elevation = '', slots: Slot[] = [], problem: string | null = null, result: IntakeResult | null = null, busy = false, disposed = false;
  const drawingSlots = (): Slot[] => [{ key: 'front', label: 'Frente', image: null, azimuth: '', thumb: '' }, { key: 'side', label: 'Lado direito', image: null, azimuth: '', thumb: '' }, { key: 'top', label: 'Topo', image: null, azimuth: '', thumb: '' }];
  const title = () => (container.querySelector<HTMLInputElement>('#rl-title')?.value.trim() || 'Objecto reconstruído de várias vistas').slice(0, 100);

  const thumbs = (r: IntakeResult | null) => (r ? r.views : []).map((v, i) => `<li class="sp-comp" data-rl-view="${i}"><div class="sp-comp-head"><b>${esc(v.name)}</b><span class="u-label">contorno ${v.maskSource === 'confirmed' ? 'confirmado' : 'automático'} · ${v.reliable ? 'credível' : 'NÃO credível'} · ${(v.foregroundRatio * 100).toFixed(0)}% da imagem</span></div>${v.reasons.length ? `<p class="u-small">${esc(v.reasons.join('; '))}</p>` : ''}<canvas data-rl-canvas="${i}" width="120" height="90" aria-label="Contorno extraído de ${esc(v.name)}"></canvas></li>`).join('');
  const editorHtml = (e: Editor) => `<div class="sp-card sp-card--review" data-reality-intake data-rl-editor>
    <div class="sp-head"><h1 class="sp-h1">Ajustar o contorno · ${esc(slots[e.index]?.image?.name ?? '')}</h1><p class="u-label">segmentação interactiva · local · nada sai do seu navegador</p></div>
    <p class="u-small">Desenhe uma <b>caixa</b> à volta do objecto, depois marque com o pincel <b>objecto</b> (verde) o que falta e <b>fundo</b> (vermelho) o que sobra, e calcule. Repita até o contorno estar certo. O contorno que confirmar fica registado como confirmado por si, não como medição.</p>
    <fieldset class="sp-field"><legend class="u-label">ferramenta</legend>
      <label><input type="radio" name="rl-tool" value="box" ${e.tool === 'box' ? 'checked' : ''}> caixa</label>
      <label><input type="radio" name="rl-tool" value="fg" ${e.tool === 'fg' ? 'checked' : ''}> pincel objecto</label>
      <label><input type="radio" name="rl-tool" value="bg" ${e.tool === 'bg' ? 'checked' : ''}> pincel fundo</label></fieldset>
    <canvas data-rl-edit-canvas width="${EDIT_W}" height="${EDIT_H(slots[e.index]!.image!)}" style="max-width:100%;touch-action:none;cursor:crosshair;border:1px solid var(--line)" aria-label="Imagem para ajustar o contorno"></canvas>
    ${e.note ? `<p class="u-small" role="status">${esc(e.note)}</p>` : ''}
    <div class="sp-row"><button class="u-btn u-btn--outline" type="button" data-rl="edit-cancel">Cancelar</button><button class="u-btn u-btn--outline" type="button" data-rl="edit-clear">Limpar traços</button><span class="sp-grow"></span>
      <button class="u-btn u-btn--outline" type="button" data-rl="edit-run" ${e.busy ? 'disabled' : ''}>${e.busy ? 'a calcular…' : 'Calcular contorno'}</button>
      <button class="u-btn u-btn--primary" type="button" data-rl="edit-accept" ${e.mask && !e.busy ? '' : 'disabled'}>Usar este contorno</button></div></div>`;
  const strategyHtml = (r: IntakeResult | null) => {
    if (!r) return '';
    const kind: StrategyInput['kind'] = mode === 'drawing' ? 'drawing-3view' : mode === 'video' ? 'video' : 'multi-image';
    const credible = !r.refusals.some((x) => x.code === 'MASK_UNRELIABLE' || x.code === 'EMPTY_MASK');
    const st = selectStrategy({ kind, views: r.views.length, outlinesCredible: credible, capture: r.capture ?? null, posesDeclared: mode === 'orbit' });
    return `<div data-rl-strategy="${st.id}"><p class="u-label">Estratégia escolhida: <b>${st.id}</b> · tecto de fidelidade: ${st.ceiling}${st.certified ? ' · configuração medida no benchmark' : ' · não certificada'}</p><ul>${[...st.reasons, ...st.limits].map((t) => `<li class="u-small">${esc(t)}</li>`).join('')}</ul>${st.requires.length ? `<p class="u-small"><b>Para melhorar:</b> ${st.requires.map(esc).join(' ')}</p>` : ''}</div>`;
  };
  const qualityHtml = (r: IntakeResult | null) => !r?.capture ? '' : `<div data-rl-capture><p class="u-label">Cobertura: ${r.capture.coverage.views} vistas · maior sector sem vista ${r.capture.coverage.azimuthMaxGapDeg.toFixed(0)}° · elevação ${r.capture.coverage.elevationMinDeg.toFixed(0)}° a ${r.capture.coverage.elevationMaxDeg.toFixed(0)}°</p>${r.capture.issues.length ? `<ul class="sp-list" aria-label="Qualidade e cobertura">${r.capture.issues.map((i) => `<li class="sp-comp" data-rl-issue="${i.code}" data-severity="${i.severity}"><div class="sp-comp-head"><b>${esc(i.message)}</b></div><p class="u-small">${esc(i.advice)}</p></li>`).join('')}</ul>` : '<p class="u-small">Sem avisos de qualidade ou cobertura. (Limiares heurísticos, não calibrados em fotografias reais.)</p>'}</div>`;
  const html = () => editor ? editorHtml(editor) : `<div class="sp-card sp-card--review" data-reality-intake>
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
    if (editor) { editor.canvas = container.querySelector<HTMLCanvasElement>('[data-rl-edit-canvas]'); drawEditor(); }
  };
  const brush = (im: IntakeImage) => Math.max(3, Math.round(0.0146 * Math.max(im.rgba.width, im.rgba.height)));
  const drawEditor = () => {
    const e = editor; if (!e?.canvas) return; const im = slots[e.index]!.image!, c = e.canvas, ctx = c.getContext('2d')!, { width: w, height: h, data } = im.rgba;
    const scale = w / c.width, out = ctx.createImageData(c.width, c.height); e.scale = scale;
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) { const sx = Math.min(w - 1, Math.floor(x * scale)), sy = Math.min(h - 1, Math.floor(y * scale)), si = (sy * w + sx) * 4, o = (y * c.width + x) * 4, on = e.mask ? e.mask[sy * w + sx]! : 0; out.data[o] = on ? data[si]! * 0.55 + 40 : data[si]!; out.data[o + 1] = on ? data[si + 1]! * 0.55 + 110 : data[si + 1]!; out.data[o + 2] = on ? data[si + 2]! * 0.55 + 120 : data[si + 2]!; out.data[o + 3] = 255; }
    ctx.putImageData(out, 0, 0);
    if (e.box) { ctx.strokeStyle = '#ffd24d'; ctx.lineWidth = 2; ctx.strokeRect(e.box.x0 / scale, e.box.y0 / scale, (e.box.x1 - e.box.x0) / scale, (e.box.y1 - e.box.y0) / scale); }
    const r = brush(im) / scale; for (const [p, col] of [[e.fg, '#2ecc71'], [e.bg, '#ff5a4d']] as const) { ctx.fillStyle = col; for (const [x, y] of p) { ctx.beginPath(); ctx.arc(x / scale, y / scale, r, 0, Math.PI * 2); ctx.fill(); } }
  };
  const toImage = (ev: PointerEvent, e: Editor): Point => { const r = e.canvas!.getBoundingClientRect(); return [((ev.clientX - r.left) / r.width) * e.canvas!.width * e.scale, ((ev.clientY - r.top) / r.height) * e.canvas!.height * e.scale]; };
  let boxStart: Point | null = null;
  const onPointerDown = (ev: PointerEvent) => { const e = editor; if (!e?.canvas || ev.target !== e.canvas) return; e.dragging = true; e.canvas.setPointerCapture?.(ev.pointerId); const p = toImage(ev, e); if (e.tool === 'box') { boxStart = p; e.box = { x0: p[0], y0: p[1], x1: p[0], y1: p[1] }; } else (e.tool === 'fg' ? e.fg : e.bg).push(p); drawEditor(); };
  const onPointerMove = (ev: PointerEvent) => { const e = editor; if (!e?.dragging || !e.canvas) return; const p = toImage(ev, e); if (e.tool === 'box' && boxStart) e.box = { x0: Math.min(boxStart[0], p[0]), y0: Math.min(boxStart[1], p[1]), x1: Math.max(boxStart[0], p[0]), y1: Math.max(boxStart[1], p[1]) }; else if (e.tool !== 'box') { const list = e.tool === 'fg' ? e.fg : e.bg, last = list.at(-1); if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) >= brush(slots[e.index]!.image!) * 0.6) list.push(p); } drawEditor(); };
  const onPointerUp = () => { if (editor) editor.dragging = false; boxStart = null; };
  container.addEventListener('pointerdown', onPointerDown); container.addEventListener('pointermove', onPointerMove); container.addEventListener('pointerup', onPointerUp);
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
  const analyse = (): IntakeResult | null => {
    problem = null;
    if (mode === 'drawing') {
      const [front, side, top] = slots.map((s) => s.image);
      result = intakeDrawing({ ...(front ? { front } : {}), ...(side ? { side } : {}), ...(top ? { top } : {}) });
    } else if (mode === 'video') {
      // key frames by silhouette diversity; azimuth from the frame's time (constant angular speed over the whole clip) - assumed, not measured
      const candidates = slots.map((s) => s.image!).filter(Boolean);
      if (candidates.length < 2) { result = intakeOrbit(candidates); return result; }
      const masks = candidates.map((im) => ({ mask: segmentGeneric(im.rgba).mask })), picks = selectKeyFrames(masks, VIDEO_LIMITS.keyFrames);
      result = intakeOrbit(picks.map((i) => candidates[i]!), { azimuthsDeg: picks.map((i) => 360 * (videoTimes[i]! / videoDuration)), azimuthsAssumed: true, mode: 'video', ...elev() });
    } else {
      const images = slots.map((s) => s.image!).filter(Boolean);
      if (mode === 'orbit') {
        const az = slots.map((s) => Number(s.azimuth));
        if (az.some((a) => !Number.isFinite(a))) { problem = REFUSAL_COPY.POSE_COUNT_MISMATCH; result = null; return null; }
        result = intakeOrbit(images, { azimuthsDeg: az, ...elev() });
      } else result = intakeOrbit(images, elev());
    }
    return result;
  };

  const runEditor = () => {
    const e = editor; if (!e || e.busy) return; const im = slots[e.index]!.image!;
    if (!e.box && !e.fg.length) { e.note = 'Desenhe primeiro uma caixa à volta do objecto.'; paint(); return; }
    e.busy = true; e.note = 'A calcular o contorno…'; paint();
    const hint: SegmentationHint = { ...(e.box ? { box: e.box } : {}), foreground: e.fg, background: e.bg, brushRadius: brush(im) };
    void deps.host.segment({ rgba: { width: im.rgba.width, height: im.rgba.height, data: im.rgba.data as Uint8ClampedArray }, hint }).then((mask) => { if (!editor || disposed) return; editor.mask = mask; editor.busy = false; let on = 0; for (const v of mask) on += v; editor.note = `Contorno calculado (${((on / mask.length) * 100).toFixed(0)}% da imagem). Corrija com os pincéis e volte a calcular, ou use-o.`; paint(); }).catch(() => { if (editor) { editor.busy = false; editor.note = 'Não foi possível calcular o contorno.'; paint(); } });
  };
  const onClick = (event: Event) => {
    const ed = (event.target as HTMLElement).closest<HTMLElement>('[data-rl-edit]');
    if (ed) { event.stopPropagation(); const i = Number(ed.dataset.rlEdit); if (slots[i]?.image) { editor = { index: i, tool: 'box', box: null, fg: [], bg: [], mask: slots[i]!.image!.mask ?? null, busy: false, note: null, canvas: null, dragging: false, scale: 1 }; paint(); } return; }
    const b = (event.target as HTMLElement).closest<HTMLElement>('[data-rl]'); if (!b) return;
    event.stopPropagation();
    const act = b.dataset.rl;
    if (act === 'edit-cancel') { editor = null; paint(); }
    else if (act === 'edit-clear' && editor) { editor.fg = []; editor.bg = []; editor.box = null; editor.mask = slots[editor.index]!.image!.mask ?? null; paint(); }
    else if (act === 'edit-run') runEditor();
    else if (act === 'edit-accept' && editor?.mask) { const sl = slots[editor.index]!; sl.image = { ...sl.image!, mask: editor.mask }; editor = null; result = null; paint(); }
    else if (act === 'cancel') { abort?.abort(); deps.onCancel(); }
    else if (act === 'analyse') { analyse(); paint(); }
    else if (act === 'build' && result?.evidence && !busy) {
      busy = true; paint();
      abort = new AbortController();
      void deps.host.create(result.evidence, title(), abort.signal).then((r) => { if (!disposed) deps.onDone({ sha256: r.sha256, plan: r.plan, title: r.plan.title }); }).catch((e) => { if (disposed || (e as DOMException)?.name === 'AbortError') return; problem = 'A reconstrução falhou. Nada foi construído.'; busy = false; paint(); });
    }
  };
  const onChange = (event: Event) => {
    const t = event.target as HTMLInputElement;
    if (t.name === 'rl-tool' && editor) { editor.tool = t.value as Editor['tool']; return; }
    if (t.name === 'rl-mode') { mode = t.value as Mode; slots = mode === 'drawing' ? drawingSlots() : []; result = null; problem = null; paint(); }
    else if (t.id === 'rl-files' && t.files) void take([...t.files]);
    else if (t.id === 'rl-video' && t.files?.[0]) void takeVideo(t.files[0]);
    else if (t.dataset.rlFileSlot !== undefined && t.files?.[0]) void take([t.files[0]], Number(t.dataset.rlFileSlot));
    else if (t.id === 'rl-elev') { elevation = t.value; result = null; }
    else if (t.dataset.rlAz !== undefined) { slots[Number(t.dataset.rlAz)]!.azimuth = t.value; result = null; }
  };
  container.addEventListener('click', onClick); container.addEventListener('change', onChange);
  paint();
  return { dispose() { disposed = true; abort?.abort(); container.removeEventListener('click', onClick); container.removeEventListener('change', onChange); container.removeEventListener('pointerdown', onPointerDown); container.removeEventListener('pointermove', onPointerMove); container.removeEventListener('pointerup', onPointerUp); } };
}
