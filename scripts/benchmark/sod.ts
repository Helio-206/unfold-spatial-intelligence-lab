// Browser harness: salient-object / background-removal networks (U2-Net family, ISNet; Apache-2.0 weights from the rembg releases) through onnxruntime-web (MIT).
import * as ort from 'onnxruntime-web';
ort.env.wasm.wasmPaths = '/node_modules/onnxruntime-web/dist/'; ort.env.wasm.numThreads = 1;
const SPEC: Record<string, { size: number; mean: [number, number, number]; std: [number, number, number]; maxNorm: boolean }> = {
  u2netp: { size: 320, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], maxNorm: true }, silueta: { size: 320, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], maxNorm: true }, u2net: { size: 320, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], maxNorm: true },
  'isnet-general-use': { size: 1024, mean: [0.485, 0.456, 0.406], std: [1, 1, 1], maxNorm: true },
};
const sessions = new Map<string, ort.InferenceSession>();
(window as unknown as { __sod: unknown }).__sod = async (model: string, dataUrl: string): Promise<{ w: number; h: number; alpha: string; ms: number }> => {
  const spec = SPEC[model]!, t0 = performance.now();
  let s = sessions.get(model); if (!s) { s = await ort.InferenceSession.create(`/scripts/benchmark/models/${model}.onnx`, { executionProviders: ['wasm'] }); sessions.set(model, s); }
  const img = new Image(); img.src = dataUrl; await img.decode();
  const c = document.createElement('canvas'); c.width = spec.size; c.height = spec.size; const ctx = c.getContext('2d', { willReadFrequently: true })!; ctx.drawImage(img, 0, 0, spec.size, spec.size);
  const px = ctx.getImageData(0, 0, spec.size, spec.size).data, n = spec.size * spec.size, input = new Float32Array(3 * n); let mx = 1e-6; for (let i = 0; i < px.length; i += 4) mx = Math.max(mx, px[i]!, px[i + 1]!, px[i + 2]!);
  for (let i = 0; i < n; i++) for (let ch = 0; ch < 3; ch++) input[ch * n + i] = ((px[i * 4 + ch]! / (spec.maxNorm ? mx : 255)) - spec.mean[ch]!) / spec.std[ch]!;
  const out = await s.run({ [s.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, spec.size, spec.size]) }), a = out[s.outputNames[0]!]!.data as Float32Array;
  let lo = Infinity, hi = -Infinity; for (const v of a) { if (v < lo) lo = v; if (v > hi) hi = v; }
  const bytes = new Uint8Array(n); for (let i = 0; i < n; i++) bytes[i] = Math.round(((a[i]! - lo) / Math.max(1e-9, hi - lo)) * 255);
  let str = ''; for (let i = 0; i < bytes.length; i += 0x8000) str += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { w: spec.size, h: spec.size, alpha: btoa(str), ms: performance.now() - t0 };
};
(window as unknown as { __sodReady: boolean }).__sodReady = true;
