import type { PartEdit } from '../../universal-spatial/reconstruction/parts';
/**
 * Reality evidence: the ORIGINAL evidence a multi-view reconstruction was made from, in a compact, versioned, checksummed form.
 * The reconstruction is a deterministic function of this record (tests assert byte-identical results), so saving the evidence is saving the object:
 * a Space reopened later is rebuilt from the same masks, poses and colours, and the original information is never replaced by the result.
 *
 * Masks are run-length encoded; colours are RGB565 at a small fixed resolution (an APPROXIMATED texture source, never presented as a scan).
 */
export const REALITY_EVIDENCE_CONTRACT = 'unfold.reality-evidence.v1' as const;
export const REALITY_LIMITS = { maxViews: 24, maxRes: 256, maxColourRes: 96, maxAssumptions: 16, maxBytes: 600_000 } as const;

export type StoredView = {
  id: string; name: string; azimuthDeg: number; elevationDeg: number; azimuthSource: 'given' | 'assumed';
  /** where this outline came from: the automatic background segmentation or one the person drew/confirmed (absent in older evidence = unknown) */
  outline?: 'automatic' | 'confirmed';
  /** which automatic strategy drew an 'automatic' outline (classical-colour, static-background, salient-network, salient-network+graphcut); absent = classical colour segmentation (older evidence) */
  outlineMethod?: string;
  /** run-length mask: alternating run lengths, starting with background, base-36, comma-separated */
  maskRle: string;
  /** RGB565 little-endian, colourRes x colourRes, base64; absent when the view carries no colour (masks only) */
  colour?: string;
  /** where the shared orthographic window sits in this view's SOURCE image (centre in source pixels, source pixels per length unit): lets later evidence (part proposals) be resampled identically */
  window?: { cx: number; cy: number; ppu: number };
};
/** a correction of the part structure made by a person (see applyPartEdits): human confirmation, kept apart from the automatic structure */
export type StoredPartEdit = PartEdit & { by: 'person' };
export type RealityEvidence = {
  /** corrections of the automatic part structure, applied in order on top of it; absent = the automatic structure as computed */
  partEdits?: StoredPartEdit[];
  contract: typeof REALITY_EVIDENCE_CONTRACT;
  mode: 'turntable' | 'orbit' | 'orthographic' | 'video';
  res: number; colourRes: number; cells: number;
  frame: { centre: [number, number, number]; half: number };
  views: StoredView[];
  /** how photographs were framed (so a later view can be framed identically); absent for drawings */
  framing?: { axisXFrac: number | null; cyFrac: number | null };
  /** what the intake had to assume (equal turntable steps, shared zoom, rotation axis position...) in plain words */
  assumptions: string[];
};

export function encodeMask(mask: Uint8Array): string {
  const runs: number[] = []; let current = 0, length = 0;
  for (let i = 0; i < mask.length; i++) { const v = mask[i]! ? 1 : 0; if (v === current) length++; else { runs.push(length); current = v; length = 1; } }
  runs.push(length);
  return runs.map((n) => n.toString(36)).join(',');
}
export function decodeMask(rle: string, size: number): Uint8Array {
  const out = new Uint8Array(size); let pos = 0, value = 0;
  for (const token of rle.split(',')) {
    const n = parseInt(token, 36); if (!Number.isFinite(n) || n < 0 || pos + n > size) throw new Error('REALITY_MASK_INVALID');
    if (value) out.fill(1, pos, pos + n); pos += n; value ^= 1;
  }
  if (pos !== size) throw new Error('REALITY_MASK_INVALID');
  return out;
}

const b64 = (bytes: Uint8Array): string => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(s); };
const unb64 = (text: string): Uint8Array => { const s = atob(text), out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; };
/** RGBA (any size) -> RGB565 at `res`x`res`, nearest sampling over the mask's own square window, deterministic. `rgb` is res*res*3. */
export function encodeColour(rgb: Uint8Array, res: number): string {
  const out = new Uint8Array(res * res * 2);
  for (let i = 0; i < res * res; i++) { const v = ((rgb[i * 3]! >> 3) << 11) | ((rgb[i * 3 + 1]! >> 2) << 5) | (rgb[i * 3 + 2]! >> 3); out[i * 2] = v & 255; out[i * 2 + 1] = v >> 8; }
  return b64(out);
}
export function decodeColour(text: string, res: number): Uint8Array {
  const bytes = unb64(text); if (bytes.length !== res * res * 2) throw new Error('REALITY_COLOUR_INVALID');
  const rgb = new Uint8Array(res * res * 3);
  for (let i = 0; i < res * res; i++) { const v = bytes[i * 2]! | (bytes[i * 2 + 1]! << 8); rgb[i * 3] = ((v >> 11) & 31) * 255 / 31 | 0; rgb[i * 3 + 1] = ((v >> 5) & 63) * 255 / 63 | 0; rgb[i * 3 + 2] = (v & 31) * 255 / 31 | 0; }
  return rgb;
}

export class RealityEvidenceError extends Error { constructor(readonly code: string, detail: string) { super(`${code}: ${detail}`); } }

export function validateRealityEvidence(value: unknown): RealityEvidence {
  const fail = (code: string, detail: string): never => { throw new RealityEvidenceError(code, detail); };
  const e = value as Partial<RealityEvidence> | null;
  if (!e || typeof e !== 'object' || e.contract !== REALITY_EVIDENCE_CONTRACT) return fail('REALITY_CONTRACT', 'unknown contract');
  if (!['turntable', 'orbit', 'orthographic', 'video'].includes(e.mode as string)) fail('REALITY_MODE', 'unknown mode');
  const res = e.res!, colourRes = e.colourRes!, cells = e.cells!;
  if (!Number.isInteger(res) || res < 32 || res > REALITY_LIMITS.maxRes) fail('REALITY_RES', 'resolution out of range');
  if (!Number.isInteger(colourRes) || colourRes < 8 || colourRes > REALITY_LIMITS.maxColourRes) fail('REALITY_COLOUR_RES', 'colour resolution out of range');
  if (!Number.isInteger(cells) || cells < 16 || cells > 128) fail('REALITY_CELLS', 'grid out of range');
  const f = e.frame; if (!f || !Array.isArray(f.centre) || f.centre.length !== 3 || !f.centre.every(Number.isFinite) || !(f.half > 0) || !Number.isFinite(f.half)) fail('REALITY_FRAME', 'invalid frame');
  if (!Array.isArray(e.views) || !e.views.length || e.views.length > REALITY_LIMITS.maxViews) fail('REALITY_VIEWS', `1..${REALITY_LIMITS.maxViews} views`);
  const ids = new Set<string>();
  for (const v of e.views!) {
    if (!v || typeof v.id !== 'string' || !/^[a-z0-9-]{1,40}$/.test(v.id) || ids.has(v.id)) fail('REALITY_VIEW_ID', 'view ids must be unique slugs'); ids.add(v.id);
    if (!Number.isFinite(v.azimuthDeg) || !Number.isFinite(v.elevationDeg) || Math.abs(v.elevationDeg) > 90) fail('REALITY_POSE', 'invalid pose');
    if (v.azimuthSource !== 'given' && v.azimuthSource !== 'assumed') fail('REALITY_POSE_SOURCE', 'azimuthSource must be given or assumed');
    if (typeof v.maskRle !== 'string' || typeof v.name !== 'string') fail('REALITY_VIEW', 'invalid view');
    if (v.outline !== undefined && v.outline !== 'automatic' && v.outline !== 'confirmed') fail('REALITY_OUTLINE', 'outline must be automatic or confirmed');
    if (v.outlineMethod !== undefined && !/^[a-z+-]{3,40}$/.test(v.outlineMethod)) fail('REALITY_OUTLINE_METHOD', v.id);
    if (v.window !== undefined && !(Number.isFinite(v.window.cx) && Number.isFinite(v.window.cy) && v.window.ppu > 0)) fail('REALITY_WINDOW', v.id);
    try { decodeMask(v.maskRle, res * res); } catch { fail('REALITY_MASK_INVALID', v.id); }
    if (v.colour !== undefined) { try { decodeColour(v.colour, colourRes); } catch { fail('REALITY_COLOUR_INVALID', v.id); } }
  }
  if (e.partEdits !== undefined) {
    const pt = (q: unknown) => Array.isArray(q) && q.length === 3 && q.every(Number.isFinite);
    if (!Array.isArray(e.partEdits) || e.partEdits.length > 32) fail('REALITY_PART_EDITS', 'at most 32 part edits');
    for (const x of e.partEdits as Array<Record<string, unknown>>) {
      const ok = x?.by === 'person' && ((x.kind === 'merge' && Array.isArray(x.seeds) && x.seeds.length === 2 && x.seeds.every(pt)) || (x.kind === 'split' && pt(x.seed) && ['x', 'y', 'z'].includes(x.axis as string) && Number.isFinite(x.at)) || (x.kind === 'rename' && pt(x.seed) && typeof x.name === 'string' && x.name.trim().length > 0 && (x.name as string).length <= 60));
      if (!ok) fail('REALITY_PART_EDIT_INVALID', 'invalid part edit');
    }
  }
  if (e.framing !== undefined && (typeof e.framing !== 'object' || e.framing === null || !['number', 'object'].includes(typeof e.framing.axisXFrac) || !['number', 'object'].includes(typeof e.framing.cyFrac))) fail('REALITY_FRAMING', 'invalid framing');
  if (!Array.isArray(e.assumptions) || e.assumptions.length > REALITY_LIMITS.maxAssumptions || !e.assumptions.every((a) => typeof a === 'string' && a.length <= 300)) fail('REALITY_ASSUMPTIONS', 'invalid assumptions');
  if (JSON.stringify(e).length > REALITY_LIMITS.maxBytes) fail('REALITY_TOO_LARGE', 'evidence exceeds the size limit');
  return e as RealityEvidence;
}

export function canonicalEvidenceJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalEvidenceJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value as object).sort().map((k) => `${JSON.stringify(k)}:${canonicalEvidenceJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  return JSON.stringify(value);
}
export async function evidenceSha256(evidence: RealityEvidence): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalEvidenceJson(evidence)));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
