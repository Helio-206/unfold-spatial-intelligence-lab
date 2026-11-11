/**
 * Pure state of the outline editor: strokes, box, undo/redo, the hint sent to the segmenter, and the zoom/pan transform. No DOM, so it is unit tested; the editor
 * component only draws it and feeds it pointer events.
 */
import type { Point, SegmentationHint } from './interactive-segmentation';

export type Box = { x0: number; y0: number; x1: number; y1: number };
export type Stroke = { kind: 'fg' | 'bg'; points: Point[] };
export type Edit = { box: Box | null; strokes: Stroke[] };
export type History = { past: Edit[]; present: Edit; future: Edit[] };
export const HISTORY_LIMIT = 100;

const clone = (e: Edit): Edit => ({ box: e.box ? { ...e.box } : null, strokes: e.strokes.map((s) => ({ kind: s.kind, points: s.points.map((p) => [p[0], p[1]] as Point) })) });
export const emptyEdit = (): Edit => ({ box: null, strokes: [] });
export const newHistory = (initial: Edit = emptyEdit()): History => ({ past: [], present: clone(initial), future: [] });
/** Commits `next` as a new undo step (any redo branch is dropped). */
export function commit(h: History, next: Edit): History { return { past: [...h.past, clone(h.present)].slice(-HISTORY_LIMIT), present: clone(next), future: [] }; }
export function undo(h: History): History { const prev = h.past.at(-1); return prev ? { past: h.past.slice(0, -1), present: prev, future: [clone(h.present), ...h.future] } : h; }
export function redo(h: History): History { const next = h.future[0]; return next ? { past: [...h.past, clone(h.present)], present: next, future: h.future.slice(1) } : h; }
export const canUndo = (h: History) => h.past.length > 0;
export const canRedo = (h: History) => h.future.length > 0;

export function normaliseBox(b: Box, width: number, height: number, min = 8): Box | null {
  const x0 = Math.max(0, Math.min(b.x0, b.x1)), x1 = Math.min(width, Math.max(b.x0, b.x1)), y0 = Math.max(0, Math.min(b.y0, b.y1)), y1 = Math.min(height, Math.max(b.y0, b.y1));
  return x1 - x0 >= min && y1 - y0 >= min ? { x0, y0, x1, y1 } : null;
}
/** Box from percentages of the image (the keyboard-operable alternative to dragging). */
export const boxFromPercent = (x: number, y: number, w: number, h: number, width: number, height: number): Box | null => normaliseBox({ x0: (x / 100) * width, y0: (y / 100) * height, x1: ((x + w) / 100) * width, y1: ((y + h) / 100) * height }, width, height);
export const boxToPercent = (b: Box, width: number, height: number) => ({ x: (b.x0 / width) * 100, y: (b.y0 / height) * 100, w: ((b.x1 - b.x0) / width) * 100, h: ((b.y1 - b.y0) / height) * 100 });

/** What the segmenter needs: every stroke's points as hard marks, with the brush radius in image pixels. */
export function toHint(e: Edit, brushRadius: number): SegmentationHint {
  const fg: Point[] = [], bg: Point[] = [];
  for (const s of e.strokes) (s.kind === 'fg' ? fg : bg).push(...s.points);
  return { ...(e.box ? { box: e.box } : {}), foreground: fg, background: bg, brushRadius };
}
/** Points of a stroke are thinned so a long drag does not flood the segmenter: at most one point per `spacing` pixels. */
export function addPoint(s: Stroke, p: Point, spacing: number): void { const last = s.points.at(-1); if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) >= spacing) s.points.push(p); }
/** Removes stroke points within `radius` of `p` (eraser); strokes left empty disappear. */
export function erase(e: Edit, p: Point, radius: number): Edit {
  return { box: e.box ? { ...e.box } : null, strokes: e.strokes.map((s) => ({ kind: s.kind, points: s.points.filter((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) > radius) })).filter((s) => s.points.length) };
}

export type View = { scale: number; tx: number; ty: number };
export const MIN_ZOOM = 0.25, MAX_ZOOM = 16;
/** Scale and offset that fit an image of `iw x ih` inside a `cw x ch` viewport with a margin. */
export function fitView(iw: number, ih: number, cw: number, ch: number, margin = 12): View { const scale = Math.min((cw - 2 * margin) / iw, (ch - 2 * margin) / ih); return { scale, tx: (cw - iw * scale) / 2, ty: (ch - ih * scale) / 2 }; }
export const toImage = (v: View, sx: number, sy: number): Point => [(sx - v.tx) / v.scale, (sy - v.ty) / v.scale];
export const toScreen = (v: View, ix: number, iy: number): Point => [ix * v.scale + v.tx, iy * v.scale + v.ty];
/** Zoom by `factor` keeping the image point under the screen position (sx, sy) fixed. */
export function zoomAt(v: View, sx: number, sy: number, factor: number): View {
  const scale = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.scale * factor)), f = scale / v.scale;
  return { scale, tx: sx - (sx - v.tx) * f, ty: sy - (sy - v.ty) * f };
}
/** Pan so that at least `keep` pixels of the image stay inside the viewport. */
export function panBy(v: View, dx: number, dy: number, iw: number, ih: number, cw: number, ch: number, keep = 48): View {
  const tx = Math.max(keep - iw * v.scale, Math.min(cw - keep, v.tx + dx)), ty = Math.max(keep - ih * v.scale, Math.min(ch - keep, v.ty + dy));
  return { scale: v.scale, tx, ty };
}
