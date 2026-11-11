import boxIcon from 'lucide-static/icons/square-dashed.svg?raw';
import brushIcon from 'lucide-static/icons/paintbrush.svg?raw';
import eraserIcon from 'lucide-static/icons/eraser.svg?raw';
import handIcon from 'lucide-static/icons/hand.svg?raw';
import undoIcon from 'lucide-static/icons/undo-2.svg?raw';
import redoIcon from 'lucide-static/icons/redo-2.svg?raw';
import zoomInIcon from 'lucide-static/icons/zoom-in.svg?raw';
import zoomOutIcon from 'lucide-static/icons/zoom-out.svg?raw';
import fitIcon from 'lucide-static/icons/maximize.svg?raw';
import wandIcon from 'lucide-static/icons/wand-sparkles.svg?raw';
import trashIcon from 'lucide-static/icons/trash-2.svg?raw';
import './reality.css';
import { addPoint, boxFromPercent, boxToPercent, canRedo, canUndo, commit, erase, fitView, newHistory, normaliseBox, panBy, redo, toHint, toImage, toScreen, undo, zoomAt, type Box, type Edit, type History, type Stroke, type View } from './editor-state';
import type { Point } from './interactive-segmentation';
import type { IntakeImage } from './intake';
import type { SegmentRequest } from './compute';

/**
 * The outline editor of the /living intake. A drawing surface with a tool rail (box, object brush, background brush, eraser, hand), zoom and pan, four ways of
 * looking at the result (overlay, cut-out on a checkerboard, mask, before/after split), live status, cancellable computation in the Worker, undo/redo, automatic
 * suggestion, a keyboard-operable box (numbers) and recovery of unfinished work. The functional contract is unchanged: box + brush marks -> segmenter -> mask the
 * person confirms.
 */
export type ContourEditorDeps = {
  image: IntakeImage; index: number; total: number; initialMask: Uint8Array | null;
  segment(request: SegmentRequest, signal?: AbortSignal): Promise<Uint8Array>;
  /** optional automatic proposal (network / static background); null = none available */
  suggest?: (signal?: AbortSignal) => Promise<Uint8Array | null>;
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null;
  onAccept(mask: Uint8Array): void; onCancel(): void; onNavigate?(delta: -1 | 1): void;
};
type Tool = 'box' | 'fg' | 'bg' | 'erase' | 'hand';
type Mode = 'overlay' | 'cutout' | 'mask' | 'compare';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function mountContourEditor(host: HTMLElement, deps: ContourEditorDeps): { dispose(): void } {
  const { width: IW, height: IH, data } = deps.image.rgba;
  let tool: Tool = 'box', mode: Mode = 'overlay', opacity = 0.5, brushPct = 1.5, compare = 0.5, history: History = newHistory(), mask: Uint8Array | null = deps.initialMask, view: View = { scale: 1, tx: 0, ty: 0 };
  let busy = false, abort: AbortController | null = null, status: { tone: 'info' | 'ok' | 'warn'; text: string } = { tone: 'info', text: 'Desenhe uma caixa à volta do objecto.' }, passes = 0, dirty = false, spaceDown = false, disposed = false;
  const key = `unfold.reality.editor:${IW}x${IH}:${deps.image.name}`, store = deps.storage === undefined ? safeSession() : deps.storage;
  function safeSession() { try { return globalThis.sessionStorage ?? null; } catch { return null; } }

  // recovery of unfinished work
  try { const raw = store?.getItem(key); if (raw) { const saved = JSON.parse(raw) as { edit: Edit; mode?: Mode; brushPct?: number; opacity?: number }; if (saved.edit && (saved.edit.box || saved.edit.strokes?.length)) { history = newHistory(saved.edit); mode = saved.mode ?? mode; brushPct = saved.brushPct ?? brushPct; opacity = saved.opacity ?? opacity; dirty = true; status = { tone: 'info', text: 'Recuperámos o seu trabalho anterior nesta imagem. Calcule de novo para ver o contorno.' }; } } } catch { /* storage unavailable or damaged: start clean */ }
  const persist = () => { try { if (history.present.box || history.present.strokes.length) store?.setItem(key, JSON.stringify({ edit: history.present, mode, brushPct, opacity })); else store?.removeItem(key); } catch { /* quota: recovery is best effort */ } };

  const src = document.createElement('canvas'); src.width = IW; src.height = IH; { const c = src.getContext('2d')!, im = c.createImageData(IW, IH); im.data.set(data as Uint8ClampedArray); c.putImageData(im, 0, 0); }
  let tint: HTMLCanvasElement | null = null, cut: HTMLCanvasElement | null = null, bin: HTMLCanvasElement | null = null;
  const brushPx = () => Math.max(3, Math.round((brushPct / 100) * Math.max(IW, IH)));
  const rebuildMask = () => {
    if (!mask) { tint = cut = bin = null; return; }
    tint = document.createElement('canvas'); tint.width = IW; tint.height = IH; cut = document.createElement('canvas'); cut.width = IW; cut.height = IH; bin = document.createElement('canvas'); bin.width = IW; bin.height = IH;
    const t = tint.getContext('2d')!.createImageData(IW, IH), c = cut.getContext('2d')!.createImageData(IW, IH), b = bin.getContext('2d')!.createImageData(IW, IH);
    for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++) {
      const k = y * IW + x, o = k * 4, on = mask[k]!;
      const edge = on && (x === 0 || y === 0 || x === IW - 1 || y === IH - 1 || !mask[k - 1]! || !mask[k + 1]! || !mask[k - IW]! || !mask[k + IW]!);
      if (on) { t.data[o] = 255; t.data[o + 1] = 90; t.data[o + 2] = 31; t.data[o + 3] = 255 * 0.9; c.data[o] = data[o]!; c.data[o + 1] = data[o + 1]!; c.data[o + 2] = data[o + 2]!; c.data[o + 3] = 255; }
      if (edge) { t.data[o] = 255; t.data[o + 1] = 255; t.data[o + 2] = 255; t.data[o + 3] = 255; }
      b.data[o] = b.data[o + 1] = b.data[o + 2] = on ? 255 : 0; b.data[o + 3] = 255;
    }
    tint.getContext('2d')!.putImageData(t, 0, 0); cut.getContext('2d')!.putImageData(c, 0, 0); bin.getContext('2d')!.putImageData(b, 0, 0);
  };

  host.innerHTML = `<div class="rl-ed" role="dialog" aria-label="Ajustar o contorno" data-rl-editor>
    <header class="rl-ed-head"><h1>Ajustar o contorno</h1><span class="rl-ed-sub">${esc(deps.image.name)} · vista ${deps.index + 1} de ${deps.total} · local, nada sai do navegador</span><span class="sp-grow" style="flex:1"></span>
      ${deps.onNavigate ? `<button class="u-btn u-btn--outline" type="button" data-ed="prev" ${deps.index === 0 ? 'disabled' : ''} aria-label="Vista anterior">‹ anterior</button><button class="u-btn u-btn--outline" type="button" data-ed="next" ${deps.index >= deps.total - 1 ? 'disabled' : ''} aria-label="Vista seguinte">seguinte ›</button>` : ''}</header>
    <div class="rl-ed-body">
      <div class="rl-ed-tools" role="toolbar" aria-orientation="vertical" aria-label="Ferramentas de contorno">
        <button class="rl-tool" type="button" data-tool="box" aria-label="Caixa à volta do objecto (B)" title="Caixa (B)">${boxIcon}</button>
        <button class="rl-tool" type="button" data-tool="fg" data-kind="fg" aria-label="Pincel objecto: marca o que é objecto (O)" title="Pincel objecto (O)">${brushIcon}</button>
        <button class="rl-tool" type="button" data-tool="bg" data-kind="bg" aria-label="Pincel fundo: marca o que é fundo (F)" title="Pincel fundo (F)">${brushIcon}</button>
        <button class="rl-tool" type="button" data-tool="erase" aria-label="Borracha: apaga traços (E)" title="Borracha (E)">${eraserIcon}</button>
        <button class="rl-tool" type="button" data-tool="hand" aria-label="Mover a imagem (H, ou espaço + arrastar)" title="Mover (H)">${handIcon}</button><hr>
        <button class="rl-tool" type="button" data-ed="undo" aria-label="Desfazer (Ctrl+Z)" title="Desfazer (Ctrl+Z)">${undoIcon}</button>
        <button class="rl-tool" type="button" data-ed="redo" aria-label="Refazer (Ctrl+Shift+Z)" title="Refazer">${redoIcon}</button>
        <button class="rl-tool" type="button" data-ed="clear" aria-label="Limpar caixa e traços" title="Limpar">${trashIcon}</button><hr>
        <button class="rl-tool" type="button" data-ed="zoom-in" aria-label="Aproximar (+)" title="Aproximar (+)">${zoomInIcon}</button>
        <button class="rl-tool" type="button" data-ed="zoom-out" aria-label="Afastar (−)" title="Afastar (−)">${zoomOutIcon}</button>
        <button class="rl-tool" type="button" data-ed="fit" aria-label="Ajustar à janela (0)" title="Ajustar (0)">${fitIcon}</button>
        ${deps.suggest ? `<hr><button class="rl-tool" type="button" data-ed="suggest" aria-label="Sugerir contorno automaticamente (A)" title="Sugerir (A)">${wandIcon}</button>` : ''}</div>
      <div class="rl-ed-stage" data-rl-stage tabindex="0" aria-label="Imagem. Desenhe com o rato ou toque; use as teclas indicadas ao lado.">
        <canvas data-rl-edit-canvas aria-hidden="true"></canvas>
        <div class="rl-ed-hud"><span data-hud="zoom">100%</span><span data-hud="tool"></span></div>
        <div class="rl-ed-busy" data-busy hidden role="status" aria-live="polite"><div class="rl-spin" aria-hidden="true"></div><p data-busy-text>A calcular o contorno…</p><button class="u-btn u-btn--outline" type="button" data-ed="cancel-run">Cancelar cálculo</button></div></div>
      <aside class="rl-ed-side" aria-label="Opções">
        <fieldset><legend>visualização</legend><div class="rl-seg" role="radiogroup" aria-label="Modo de visualização">${(['overlay', 'cutout', 'mask', 'compare'] as const).map((m) => `<label><input type="radio" name="rl-view-mode" value="${m}"><span>${{ overlay: 'Sobreposição', cutout: 'Recorte', mask: 'Máscara', compare: 'Antes/depois' }[m]}</span></label>`).join('')}</div>
          <label data-compare-row>posição do antes/depois <input type="range" min="0" max="100" value="50" data-compare aria-label="Posição da divisão antes/depois"></label>
          <label>opacidade da máscara <input type="range" min="10" max="100" value="50" data-opacity aria-label="Opacidade da máscara"></label></fieldset>
        <fieldset><legend>pincel</legend><label>tamanho <input type="range" min="0.4" max="6" step="0.1" value="1.5" data-brush aria-label="Tamanho do pincel"><span class="rl-keys" data-brush-readout></span></label></fieldset>
        <fieldset><legend>caixa por números (% da imagem)</legend><div class="rl-nums">${(['x', 'y', 'w', 'h'] as const).map((k) => `<label>${{ x: 'esquerda', y: 'topo', w: 'largura', h: 'altura' }[k]}<input type="number" min="0" max="100" step="1" data-box="${k}" aria-label="Caixa ${{ x: 'esquerda', y: 'topo', w: 'largura', h: 'altura' }[k]} em percentagem"></label>`).join('')}</div></fieldset>
        <div class="rl-ed-status" data-status role="status" aria-live="polite"></div>
        <details><summary class="rl-keys">atalhos</summary><p class="rl-keys"><kbd>B</kbd> caixa · <kbd>O</kbd> objecto · <kbd>F</kbd> fundo · <kbd>E</kbd> borracha · <kbd>H</kbd> mover · <kbd>[</kbd><kbd>]</kbd> pincel · <kbd>Enter</kbd> calcular · <kbd>Ctrl+Z</kbd> desfazer · <kbd>+</kbd><kbd>−</kbd><kbd>0</kbd> zoom · setas movem · <kbd>Esc</kbd> sair</p></details></aside></div>
    <footer class="rl-ed-foot"><button class="u-btn u-btn--outline" type="button" data-ed="cancel">Cancelar</button><button class="u-btn u-btn--outline" type="button" data-ed="reset" ${deps.initialMask ? '' : 'disabled'}>Repor o contorno anterior</button><span style="flex:1"></span>
      <button class="u-btn u-btn--outline" type="button" data-ed="run">Calcular contorno</button><button class="u-btn u-btn--primary" type="button" data-ed="accept" disabled>Usar este contorno</button></footer></div>`;
  const q = <T extends HTMLElement>(s: string) => host.querySelector<T>(s)!;
  const stage = q<HTMLElement>('[data-rl-stage]'), canvas = q<HTMLCanvasElement>('[data-rl-edit-canvas]'), ctx = canvas.getContext('2d')!;

  const setStatus = (tone: 'info' | 'ok' | 'warn', text: string) => { status = { tone, text }; const el = q<HTMLElement>('[data-status]'); el.dataset.tone = tone; el.textContent = text; };
  const size = () => { const r = stage.getBoundingClientRect(), dpr = Math.min(2, globalThis.devicePixelRatio || 1); const w = Math.max(1, Math.round(r.width * dpr)), h = Math.max(1, Math.round(r.height * dpr)); if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; } return { w, h, dpr }; };
  let fitted = false;
  const fit = () => { const { w, h } = size(); view = fitView(IW, IH, w, h, 16 * (globalThis.devicePixelRatio || 1)); fitted = true; };
  const checker = (x: number, y: number, w: number, h: number) => { const s = 12 * (globalThis.devicePixelRatio || 1); for (let yy = 0; yy < h; yy += s) for (let xx = 0; xx < w; xx += s) { ctx.fillStyle = ((xx / s + yy / s) & 1) ? '#c9c6bd' : '#e6e3da'; ctx.fillRect(x + xx, y + yy, Math.min(s, w - xx), Math.min(s, h - yy)); } };
  const draw = () => {
    if (disposed) return; const { w, h, dpr } = size(); if (!fitted) fit();
    ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = getComputedStyle(stage).backgroundColor || '#222'; ctx.fillRect(0, 0, w, h);
    const x0 = view.tx, y0 = view.ty, iw = IW * view.scale, ih = IH * view.scale; ctx.imageSmoothingEnabled = view.scale < 3;
    const showMask = !!mask && mode !== 'overlay' ? true : !!mask;
    if (mode === 'mask' && bin) ctx.drawImage(bin, x0, y0, iw, ih);
    else if (mode === 'cutout' && cut) { checker(x0, y0, iw, ih); ctx.drawImage(cut, x0, y0, iw, ih); }
    else if (mode === 'compare' && cut) { const split = x0 + iw * compare; ctx.drawImage(src, x0, y0, iw, ih); ctx.save(); ctx.beginPath(); ctx.rect(split, y0, x0 + iw - split, ih); ctx.clip(); checker(x0, y0, iw, ih); ctx.drawImage(cut, x0, y0, iw, ih); ctx.restore(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.moveTo(split, y0); ctx.lineTo(split, y0 + ih); ctx.stroke(); }
    else { ctx.drawImage(src, x0, y0, iw, ih); if (showMask && tint) { ctx.globalAlpha = opacity; ctx.drawImage(tint, x0, y0, iw, ih); ctx.globalAlpha = 1; } }
    // strokes (translucent discs: what the segmenter will receive) and the box
    const r = (brushPx() * view.scale); for (const s of history.present.strokes) { ctx.fillStyle = s.kind === 'fg' ? 'rgba(46,204,113,.55)' : 'rgba(255,90,77,.55)'; for (const p of s.points) { const [sx, sy] = toScreen(view, p[0], p[1]); ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2); ctx.fill(); } }
    const b = history.present.box; if (b) { const [ax, ay] = toScreen(view, b.x0, b.y0), [bx, by] = toScreen(view, b.x1, b.y1); ctx.setLineDash([8 * dpr, 6 * dpr]); ctx.lineWidth = 2 * dpr; ctx.strokeStyle = '#ffd24d'; ctx.strokeRect(ax, ay, bx - ax, by - ay); ctx.setLineDash([]); if (tool === 'box') { ctx.fillStyle = '#ffd24d'; for (const [hx, hy] of handlePoints(b)) { const [sx, sy] = toScreen(view, hx, hy); ctx.fillRect(sx - 4 * dpr, sy - 4 * dpr, 8 * dpr, 8 * dpr); } } }
    if (cursor && (tool === 'fg' || tool === 'bg' || tool === 'erase')) { ctx.lineWidth = 1.5 * dpr; ctx.strokeStyle = tool === 'fg' ? '#2ecc71' : tool === 'bg' ? '#ff5a4d' : '#fff'; ctx.beginPath(); ctx.arc(cursor[0] * dpr, cursor[1] * dpr, r, 0, Math.PI * 2); ctx.stroke(); }
    q<HTMLElement>('[data-hud="zoom"]').textContent = `${Math.round((view.scale / (fitView(IW, IH, w, h, 16 * dpr).scale || 1)) * 100)}%`;
    q<HTMLElement>('[data-hud="tool"]').textContent = { box: 'caixa', fg: 'pincel objecto', bg: 'pincel fundo', erase: 'borracha', hand: 'mover' }[tool];
  };
  const handlePoints = (b: Box): Point[] => { const mx = (b.x0 + b.x1) / 2, my = (b.y0 + b.y1) / 2; return [[b.x0, b.y0], [mx, b.y0], [b.x1, b.y0], [b.x1, my], [b.x1, b.y1], [mx, b.y1], [b.x0, b.y1], [b.x0, my]]; };
  let cursor: Point | null = null;

  const refreshUi = () => {
    host.querySelectorAll<HTMLButtonElement>('[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
    host.querySelectorAll<HTMLInputElement>('input[name="rl-view-mode"]').forEach((i) => { i.checked = i.value === mode; i.closest('label')!.dataset.on = String(i.value === mode); });
    q<HTMLElement>('[data-compare-row]').style.display = mode === 'compare' ? '' : 'none';
    q<HTMLButtonElement>('[data-ed="undo"]').disabled = !canUndo(history) || busy; q<HTMLButtonElement>('[data-ed="redo"]').disabled = !canRedo(history) || busy;
    q<HTMLButtonElement>('[data-ed="accept"]').disabled = !mask || busy; q<HTMLButtonElement>('[data-ed="run"]').disabled = busy;
    host.querySelector<HTMLButtonElement>('[data-ed="suggest"]')?.toggleAttribute('disabled', busy);
    q<HTMLElement>('[data-busy]').hidden = !busy; q<HTMLElement>('[data-brush-readout]').textContent = ` ${brushPx()} px`;
    const b = history.present.box, pct = b ? boxToPercent(b, IW, IH) : null;
    (['x', 'y', 'w', 'h'] as const).forEach((k) => { const el = q<HTMLInputElement>(`[data-box="${k}"]`); if (document.activeElement !== el) el.value = pct ? String(Math.round(pct[k])) : ''; });
    setStatus(status.tone, status.text); persist(); draw();
  };
  const setEdit = (e: Edit) => { history = commit(history, e); dirty = true; refreshUi(); };
  const clampView = () => { const { w, h } = size(); view = panBy(view, 0, 0, IW, IH, w, h); };

  const run = async (via: 'segment' | 'suggest') => {
    if (busy) return; if (via === 'segment' && !history.present.box && !history.present.strokes.some((s) => s.kind === 'fg')) { setStatus('warn', 'Desenhe primeiro uma caixa à volta do objecto (ou use «Sugerir»).'); refreshUi(); return; }
    abort?.abort(); abort = new AbortController(); busy = true; q<HTMLElement>('[data-busy-text]').textContent = via === 'suggest' ? 'A sugerir um contorno…' : 'A calcular o contorno…'; setStatus('info', 'A calcular…'); refreshUi();
    try {
      let result: Uint8Array | null;
      if (via === 'suggest') result = (await deps.suggest?.(abort.signal)) ?? null; else result = await deps.segment({ rgba: { width: IW, height: IH, data: data as Uint8ClampedArray }, hint: toHint(history.present, brushPx()) }, abort.signal);
      busy = false; if (disposed) return;
      if (!result) { setStatus('warn', 'Não há sugestão automática disponível para esta imagem. Desenhe uma caixa.'); refreshUi(); return; }
      mask = result; passes++; dirty = false; rebuildMask(); let on = 0; for (const v of mask) on += v;
      setStatus(on / mask.length < 0.005 || on / mask.length > 0.9 ? 'warn' : 'ok', `Contorno ${via === 'suggest' ? 'sugerido' : 'calculado'}: ${((on / mask.length) * 100).toFixed(0)}% da imagem · ${passes} passagem(ns). Corrija com os pincéis e volte a calcular, ou use-o.`);
      if (via === 'suggest' && !history.present.box) { let x0 = IW, y0 = IH, x1 = 0, y1 = 0; for (let y = 0; y < IH; y++) for (let x = 0; x < IW; x++) if (mask[y * IW + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } const nb = normaliseBox({ x0, y0, x1, y1 }, IW, IH); if (nb) history = commit(history, { box: nb, strokes: history.present.strokes }); }
      refreshUi();
    } catch (e) { busy = false; if ((e as DOMException)?.name === 'AbortError') { setStatus('info', 'Cálculo cancelado. O seu trabalho foi mantido.'); } else setStatus('warn', 'O cálculo falhou. O seu trabalho foi mantido; tente de novo.'); refreshUi(); }
  };

  // pointer interaction
  const pointers = new Map<number, { x: number; y: number }>(); let drag: { kind: 'box-new' | 'box-handle' | 'box-move' | 'stroke' | 'pan' | 'erase'; start: Point; box0?: Box | null; handle?: number; stroke?: Stroke; last?: Point } | null = null, pinch: { d: number; cx: number; cy: number } | null = null;
  const local = (ev: PointerEvent): Point => { const r = canvas.getBoundingClientRect(), dpr = canvas.width / r.width; return [(ev.clientX - r.left) * dpr, (ev.clientY - r.top) * dpr]; };
  const cssLocal = (ev: PointerEvent): Point => { const r = canvas.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
  const hitHandle = (b: Box, s: Point): number => { const dpr = canvas.width / canvas.getBoundingClientRect().width; handlePoints(b).forEach(() => 0); const hp = handlePoints(b); for (let i = 0; i < hp.length; i++) { const [sx, sy] = toScreen(view, hp[i]![0], hp[i]![1]); if (Math.hypot(sx - s[0], sy - s[1]) <= 12 * dpr) return i; } return -1; };
  let gestureStart: History | null = null;
  const onDown = (ev: PointerEvent) => {
    gestureStart = history;
    stage.focus({ preventScroll: true }); canvas.setPointerCapture?.(ev.pointerId); pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch = { d: Math.hypot(a!.x - b!.x, a!.y - b!.y), cx: (a!.x + b!.x) / 2, cy: (a!.y + b!.y) / 2 }; drag = null; return; }
    const s = local(ev), p = toImage(view, s[0], s[1]);
    if (tool === 'hand' || ev.button === 1 || spaceDown) { drag = { kind: 'pan', start: s, last: s }; return; }
    if (tool === 'box') {
      const b = history.present.box; const hi = b ? hitHandle(b, s) : -1;
      if (b && hi >= 0) { drag = { kind: 'box-handle', start: p, box0: { ...b }, handle: hi }; return; }
      if (b && p[0] > b.x0 && p[0] < b.x1 && p[1] > b.y0 && p[1] < b.y1 && ev.shiftKey) { drag = { kind: 'box-move', start: p, box0: { ...b } }; return; }
      drag = { kind: 'box-new', start: p, box0: b }; return;
    }
    if (tool === 'erase') { drag = { kind: 'erase', start: p, last: p }; return; }
    const stroke: Stroke = { kind: tool === 'fg' ? 'fg' : 'bg', points: [[p[0], p[1]]] }; history = { ...history, present: { box: history.present.box, strokes: [...history.present.strokes, stroke] } }; drag = { kind: 'stroke', start: p, stroke }; draw();
  };
  const onMove = (ev: PointerEvent) => {
    const c = cssLocal(ev); cursor = c;
    if (pointers.has(ev.pointerId)) pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch && pointers.size === 2) { const [a, b] = [...pointers.values()], d = Math.hypot(a!.x - b!.x, a!.y - b!.y), r = canvas.getBoundingClientRect(), dpr = canvas.width / r.width; view = zoomAt(view, ((a!.x + b!.x) / 2 - r.left) * dpr, ((a!.y + b!.y) / 2 - r.top) * dpr, d / pinch.d); view = panBy(view, (((a!.x + b!.x) / 2) - pinch.cx) * dpr, (((a!.y + b!.y) / 2) - pinch.cy) * dpr, IW, IH, canvas.width, canvas.height); pinch = { d, cx: (a!.x + b!.x) / 2, cy: (a!.y + b!.y) / 2 }; draw(); return; }
    if (!drag) { draw(); return; }
    const s = local(ev), p = toImage(view, s[0], s[1]);
    if (drag.kind === 'pan') { view = panBy(view, s[0] - drag.last![0], s[1] - drag.last![1], IW, IH, canvas.width, canvas.height); drag.last = s; }
    else if (drag.kind === 'box-new') { history = { ...history, present: { box: { x0: drag.start[0], y0: drag.start[1], x1: p[0], y1: p[1] }, strokes: history.present.strokes } }; }
    else if (drag.kind === 'box-handle' && drag.box0) { const b = { ...drag.box0 }, i = drag.handle!; if ([0, 6, 7].includes(i)) b.x0 = p[0]; if ([2, 3, 4].includes(i)) b.x1 = p[0]; if ([0, 1, 2].includes(i)) b.y0 = p[1]; if ([4, 5, 6].includes(i)) b.y1 = p[1]; history = { ...history, present: { box: b, strokes: history.present.strokes } }; }
    else if (drag.kind === 'box-move' && drag.box0) { const dx = p[0] - drag.start[0], dy = p[1] - drag.start[1], b = drag.box0; history = { ...history, present: { box: { x0: b.x0 + dx, y0: b.y0 + dy, x1: b.x1 + dx, y1: b.y1 + dy }, strokes: history.present.strokes } }; }
    else if (drag.kind === 'stroke' && drag.stroke) addPoint(drag.stroke, [p[0], p[1]], brushPx() * 0.6);
    else if (drag.kind === 'erase') { history = { ...history, present: erase(history.present, p, brushPx() * 1.2) }; }
    draw();
  };
  const onUp = (ev: PointerEvent) => {
    pointers.delete(ev.pointerId); if (pointers.size < 2) pinch = null; if (!drag) return;
    const d = drag; drag = null;
    if (d.kind === 'pan') { refreshUi(); return; }
    // the working state was mutated live; commit one clean undo step
    let finalEdit = history.present;
    if (finalEdit.box) { const nb = normaliseBox(finalEdit.box, IW, IH); finalEdit = { box: nb ?? (d.box0 ?? null), strokes: finalEdit.strokes }; }
    const h0 = gestureStart ?? history; gestureStart = null;
    const unchanged = JSON.stringify(h0.present) === JSON.stringify(finalEdit);
    history = unchanged ? h0 : commit(h0, finalEdit); // one undo step per gesture
    dirty = true; refreshUi();
  };
  const onWheel = (ev: WheelEvent) => { ev.preventDefault(); const r = canvas.getBoundingClientRect(), dpr = canvas.width / r.width; view = zoomAt(view, (ev.clientX - r.left) * dpr, (ev.clientY - r.top) * dpr, Math.exp(-ev.deltaY * (ev.ctrlKey ? 0.01 : 0.0015))); clampView(); draw(); };
  const zoomCentre = (f: number) => { view = zoomAt(view, canvas.width / 2, canvas.height / 2, f); clampView(); draw(); };
  const onKey = (ev: KeyboardEvent) => {
    const target = ev.target as HTMLElement; if (target.matches('input[type="number"],input[type="text"]')) return;
    const k = ev.key.toLowerCase(), mod = ev.ctrlKey || ev.metaKey;
    if (k === ' ') { spaceDown = true; ev.preventDefault(); return; }
    if (mod && k === 'z') { ev.preventDefault(); history = ev.shiftKey ? redo(history) : undo(history); refreshUi(); return; } if (mod && k === 'y') { ev.preventDefault(); history = redo(history); refreshUi(); return; }
    if (mod) return;
    const t: Record<string, Tool> = { b: 'box', o: 'fg', f: 'bg', e: 'erase', h: 'hand' };
    if (t[k]) { tool = t[k]!; refreshUi(); return; }
    if (k === '[') { brushPct = Math.max(0.4, brushPct - 0.2); q<HTMLInputElement>('[data-brush]').value = String(brushPct); refreshUi(); return; } if (k === ']') { brushPct = Math.min(6, brushPct + 0.2); q<HTMLInputElement>('[data-brush]').value = String(brushPct); refreshUi(); return; }
    if (k === 'enter' && target === stage) { void run('segment'); return; }
    if (k === '+' || k === '=') { zoomCentre(1.25); return; } if (k === '-' || k === '_') { zoomCentre(0.8); return; } if (k === '0') { fit(); draw(); return; }
    if (k === 'a' && deps.suggest) { void run('suggest'); return; }
    if (k.startsWith('arrow') && target === stage) { ev.preventDefault(); const st = 40 * (canvas.width / canvas.getBoundingClientRect().width); view = panBy(view, k === 'arrowleft' ? st : k === 'arrowright' ? -st : 0, k === 'arrowup' ? st : k === 'arrowdown' ? -st : 0, IW, IH, canvas.width, canvas.height); draw(); return; }
    if (k === 'escape') { finish('cancel'); }
  };
  const onKeyUp = (ev: KeyboardEvent) => { if (ev.key === ' ') spaceDown = false; };
  const finish = (how: 'accept' | 'cancel') => { abort?.abort(); if (how === 'accept' && mask) { try { store?.removeItem(key); } catch { /* ignore */ } deps.onAccept(mask); } else { persist(); deps.onCancel(); } };

  const onClick = (ev: Event) => {
    const t = (ev.target as HTMLElement).closest<HTMLElement>('[data-tool],[data-ed]'); if (!t) return;
    if (t.dataset.tool) { tool = t.dataset.tool as Tool; refreshUi(); return; }
    switch (t.dataset.ed) {
      case 'undo': history = undo(history); refreshUi(); break; case 'redo': history = redo(history); refreshUi(); break;
      case 'clear': setEdit({ box: null, strokes: [] }); break; case 'zoom-in': zoomCentre(1.25); break; case 'zoom-out': zoomCentre(0.8); break; case 'fit': fit(); draw(); break;
      case 'run': void run('segment'); break; case 'suggest': void run('suggest'); break; case 'cancel-run': abort?.abort(); break;
      case 'accept': finish('accept'); break; case 'cancel': finish('cancel'); break;
      case 'reset': mask = deps.initialMask; rebuildMask(); setStatus('info', 'Contorno anterior reposto.'); refreshUi(); break;
      case 'prev': persist(); deps.onNavigate?.(-1); break; case 'next': persist(); deps.onNavigate?.(1); break;
    }
  };
  const onInput = (ev: Event) => {
    const t = ev.target as HTMLInputElement;
    if (t.name === 'rl-view-mode') { mode = t.value as Mode; refreshUi(); } else if (t.matches('[data-compare]')) { compare = Number(t.value) / 100; draw(); } else if (t.matches('[data-opacity]')) { opacity = Number(t.value) / 100; draw(); } else if (t.matches('[data-brush]')) { brushPct = Number(t.value); refreshUi(); }
    else if (t.dataset.box) { const v = (k: string) => Number(q<HTMLInputElement>(`[data-box="${k}"]`).value); const nb = boxFromPercent(v('x'), v('y'), v('w'), v('h'), IW, IH); if (nb) { history = commit(history, { box: nb, strokes: history.present.strokes }); dirty = true; draw(); persist(); } }
  };
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => { fitted = false; draw(); }) : null; ro?.observe(stage);
  host.addEventListener('click', onClick); host.addEventListener('input', onInput); host.addEventListener('keydown', onKey); host.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('pointerdown', onDown); canvas.addEventListener('pointermove', onMove); canvas.addEventListener('pointerup', onUp); canvas.addEventListener('pointercancel', onUp); canvas.addEventListener('pointerleave', () => { cursor = null; draw(); }); canvas.addEventListener('wheel', onWheel, { passive: false });
  rebuildMask(); if (mask) setStatus('info', 'Contorno actual carregado. Ajuste e calcule de novo, ou use-o.'); refreshUi(); requestAnimationFrame(() => { fit(); draw(); stage.focus({ preventScroll: true }); });
  void dirty;
  return { dispose() { disposed = true; abort?.abort(); ro?.disconnect(); host.removeEventListener('click', onClick); host.removeEventListener('input', onInput); host.removeEventListener('keydown', onKey); host.removeEventListener('keyup', onKeyUp); host.replaceChildren(); } };
}
