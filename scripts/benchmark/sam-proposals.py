"""Part proposals from a promptable segmentation model (Segment Anything ViT-B, Apache-2.0; ONNX export from the rembg release).
For every cached render: a grid of point prompts inside the object's mask -> one mask per prompt -> quality filter -> de-duplication.
Output (scripts/benchmark/cache/sam/<asset>.<set>.json): per view a list of {area, iou, stability, bits(base64 packed 480x360)}.
These are 2D HYPOTHESES (AI proposals), lifted to 3D and judged by the geometry in src/universal-spatial/reconstruction/multiview-parts.ts.
Usage: python scripts/benchmark/sam-proposals.py <encoder.onnx> <decoder.onnx> [--assets A,B] [--set turn8] [--grid 10]
Needs: onnxruntime numpy pillow (pip), model files (not committed)."""
import sys, gzip, json, base64, os, time
import numpy as np, onnxruntime as ort
from PIL import Image
W, H = 480, 360
S = 1024 / max(W, H)
args = sys.argv[1:]
enc_path, dec_path = args[0], args[1]
opt = lambda n: args[args.index(n) + 1] if n in args else None
assets = opt('--assets').split(',') if opt('--assets') else [a['id'] for a in json.load(open('reports/reality-engine/benchmark/manifest.json'))['assets']]
SET = opt('--set') or 'turn8'; GRID = int(opt('--grid') or 10)
so = ort.SessionOptions(); so.intra_op_num_threads = 4
enc = ort.InferenceSession(enc_path, so, providers=['CPUExecutionProvider']); dec = ort.InferenceSession(dec_path, providers=['CPUExecutionProvider'])
os.makedirs('scripts/benchmark/cache/sam', exist_ok=True)

def masks_for(rgb, obj):
    big = np.array(Image.fromarray(rgb).resize((1024, round(H * S)), Image.BILINEAR)).astype(np.float32)
    emb = enc.run(None, {'input_image': big})[0]
    ys, xs = np.where(obj); x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
    area_obj = obj.sum(); props = []
    for gy in range(GRID):
        for gx in range(GRID):
            px, py = x0 + (gx + 0.5) / GRID * (x1 - x0), y0 + (gy + 0.5) / GRID * (y1 - y0)
            if not obj[int(py), int(px)]: continue
            r = dec.run(None, {'image_embeddings': emb, 'point_coords': np.array([[[px, py]]], np.float32) * S, 'point_labels': np.array([[1]], np.float32), 'mask_input': np.zeros((1, 1, 256, 256), np.float32), 'has_mask_input': np.zeros(1, np.float32), 'orig_im_size': np.array([big.shape[0], big.shape[1]], np.float32)})
            lo = r[0][0, 0]; m = np.array(Image.fromarray(((lo > 0) * 255).astype(np.uint8)).resize((W, H), Image.NEAREST)) > 127
            m &= obj
            hi = np.array(Image.fromarray(((lo > 1.0) * 255).astype(np.uint8)).resize((W, H), Image.NEAREST)) > 127; hi &= obj
            lw = np.array(Image.fromarray(((lo > -1.0) * 255).astype(np.uint8)).resize((W, H), Image.NEAREST)) > 127; lw &= obj
            stab = hi.sum() / max(1, lw.sum()); a = int(m.sum())
            if r[1][0, 0] < 0.8 or stab < 0.85 or a < 0.012 * area_obj: continue
            props.append((float(r[1][0, 0]), float(stab), m))
    props.sort(key=lambda p: -p[0]); keep = []
    for sc, st, m in props:
        if all((m & k[2]).sum() / max(1, (m | k[2]).sum()) < 0.7 for k in keep): keep.append((sc, st, m))
    return [{'area': int(m.sum()), 'iou': round(sc, 3), 'stability': round(st, 3), 'bits': base64.b64encode(np.packbits(m.reshape(-1)).tobytes()).decode()} for sc, st, m in keep]

for a in assets:
    out = f'scripts/benchmark/cache/sam/{a}.{SET}.json'
    if os.path.exists(out): continue
    buf = np.frombuffer(gzip.open(f'scripts/benchmark/cache/{a}.{SET}.rgba.gz').read(), np.uint8).reshape(-1, H, W, 4)
    views = []; t = time.time()
    for im in buf:
        al = im[..., 3:4] / 255.0; rgb = (im[..., :3] * al + 128 * (1 - al)).astype(np.uint8)
        views.append(masks_for(rgb, im[..., 3] > 127))
    json.dump({'width': W, 'height': H, 'views': views}, open(out, 'w')); print(a, SET, [len(v) for v in views], round(time.time() - t), 's', flush=True)
