/**
 * Salient-object network (U2-Net-P, Apache-2.0, 4.6 MB) through onnxruntime-web (MIT), in the browser. Category-agnostic: it proposes WHAT STANDS OUT, which on a
 * photograph of one object is usually the object. Optional: the model file is fetched on demand (`npm run models`); without it the runner reports unavailable and the
 * product falls back to the other strategies. Returns a soft map in [0,1] at the image's own resolution.
 */
export type SodRunner = { available(): Promise<boolean>; run(rgba: { width: number; height: number; data: Uint8ClampedArray }, signal?: AbortSignal): Promise<Float32Array> };
export const SOD_MODEL_URL = '/models/u2netp.onnx';
const SIZE = 320, MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];

export function createSodRunner(modelUrl = SOD_MODEL_URL): SodRunner {
  let session: Promise<{ run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array }>>; inputNames: string[]; outputNames: string[] }> | null = null, ort: typeof import('onnxruntime-web') | null = null, present: boolean | null = null;
  const load = () => (session ??= (async () => {
    ort = await import('onnxruntime-web'); ort.env.wasm.numThreads = 1;
    return ort.InferenceSession.create(modelUrl, { executionProviders: ['wasm'] }) as never;
  })());
  return {
    async available() { if (present !== null) return present; try { const r = await fetch(modelUrl, { method: 'HEAD' }); present = r.ok && !(r.headers.get('content-type') ?? '').includes('text/html'); } catch { present = false; } return present; },
    async run(rgba, signal) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      const s = await load(), { width: W, height: H, data } = rgba, n = SIZE * SIZE, input = new Float32Array(3 * n);
      let mx = 1e-6; const px = new Uint8ClampedArray(n * 4);
      for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) { const sx = Math.min(W - 1, Math.floor(((x + 0.5) / SIZE) * W)), sy = Math.min(H - 1, Math.floor(((y + 0.5) / SIZE) * H)), si = (sy * W + sx) * 4, o = (y * SIZE + x) * 4; for (let c = 0; c < 3; c++) { px[o + c] = data[si + c]!; mx = Math.max(mx, px[o + c]!); } }
      for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) input[c * n + i] = (px[i * 4 + c]! / mx - MEAN[c]!) / STD[c]!;
      const out = await s.run({ [s.inputNames[0]!]: new ort!.Tensor('float32', input, [1, 3, SIZE, SIZE]) }), a = out[s.outputNames[0]!]!.data;
      let lo = Infinity, hi = -Infinity; for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
      const soft = new Float32Array(W * H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const fx = ((x + 0.5) / W) * SIZE - 0.5, fy = ((y + 0.5) / H) * SIZE - 0.5, x0 = Math.max(0, Math.floor(fx)), y0 = Math.max(0, Math.floor(fy)), x1 = Math.min(SIZE - 1, x0 + 1), y1 = Math.min(SIZE - 1, y0 + 1), tx = Math.min(1, Math.max(0, fx - x0)), ty = Math.min(1, Math.max(0, fy - y0)); const v = (a[y0 * SIZE + x0]! * (1 - tx) + a[y0 * SIZE + x1]! * tx) * (1 - ty) + (a[y1 * SIZE + x0]! * (1 - tx) + a[y1 * SIZE + x1]! * tx) * ty; soft[y * W + x] = (v - lo) / Math.max(1e-9, hi - lo); }
      return soft;
    },
  };
}
