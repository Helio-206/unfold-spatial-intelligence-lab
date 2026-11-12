import type { StoredView } from './evidence';

/** Resamples a proposal mask given in SOURCE image pixels into the shared orthographic window of a stored view (same mapping the outline and colour used). */
export function proposalToWindow(mask: Uint8Array, width: number, height: number, view: Pick<StoredView, 'window'>, half: number, res: number): Uint8Array {
  const w = view.window; if (!w) throw new Error('view has no window record');
  const out = new Uint8Array(res * res);
  for (let Y = 0; Y < res; Y++) for (let X = 0; X < res; X++) {
    const u = (((X + 0.5) / res) * 2 - 1) * half, v = (((Y + 0.5) / res) * 2 - 1) * half, sx = Math.floor(w.cx + u * w.ppu), sy = Math.floor(w.cy - v * w.ppu);
    if (sx >= 0 && sy >= 0 && sx < width && sy < height && mask[sy * width + sx]) out[Y * res + X] = 1;
  }
  return out;
}
/** Unpacks the benchmark/proposal file encoding (np.packbits, base64) into a 0/1 mask. */
export function unpackBits(b64: string, n: number): Uint8Array {
  const raw = typeof Buffer !== 'undefined' ? Buffer.from(b64, 'base64') : Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)), out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (raw[i >> 3]! >> (7 - (i & 7))) & 1; return out;
}
