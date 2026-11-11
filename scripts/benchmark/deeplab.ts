// Browser harness: MediaPipe DeepLab v3 (Pascal VOC, Apache-2.0) category masks at the model's own resolution, runtime from node_modules, model from the public bucket.
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
const MODEL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/deeplab_v3/float32/1/deeplab_v3.tflite';
let seg: ImageSegmenter | null = null;
(window as unknown as { __deeplab: unknown }).__deeplab = async (dataUrl: string): Promise<{ w: number; h: number; labels: string }> => {
  seg ??= await ImageSegmenter.createFromOptions(await FilesetResolver.forVisionTasks('/node_modules/@mediapipe/tasks-vision/wasm'), { baseOptions: { modelAssetPath: MODEL }, runningMode: 'IMAGE', outputCategoryMask: true, outputConfidenceMasks: false });
  const img = new Image(); img.src = dataUrl; await img.decode();
  const r = seg.segment(img), m = r.categoryMask!, a = m.getAsUint8Array(); let s = ''; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode(...a.subarray(i, i + 0x8000));
  const out = { w: m.width, h: m.height, labels: btoa(s) }; m.close?.(); return out;
};
(window as unknown as { __deeplabReady: boolean }).__deeplabReady = true;
