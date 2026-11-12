"""Candidate object-segmentation strategies on composites of the cached renders over REAL photographs (reference = renderer's exact alpha).
Strategies: u2netp raw; u2netp keeping only the components the person centred; SAM box prompt (loose centred box / box from the network's mask); SAM centre points.
Usage: python seg-candidates.py <sam_enc> <sam_dec> <u2netp.onnx> [--views 0,2,4,6]"""
import sys, gzip, json, os
import numpy as np, onnxruntime as ort
from PIL import Image
from scipy import ndimage as ndi
W, H = 480, 360; S = 1024 / max(W, H)
enc_p, dec_p, sod_p = sys.argv[1:4]
VIEWS = [int(v) for v in (sys.argv[sys.argv.index('--views') + 1].split(',') if '--views' in sys.argv else '0,2,4,6'.split(','))]
BG = ['car.jpg', 'chair.jpg', 'bus.jpg', 'excavator.jpg', 'porsche-911.jpg', 'skoda-kodiaq.jpg']
so = ort.SessionOptions(); so.intra_op_num_threads = 4
enc = ort.InferenceSession(enc_p, so, providers=['CPUExecutionProvider']); dec = ort.InferenceSession(dec_p, providers=['CPUExecutionProvider']); sod = ort.InferenceSession(sod_p, providers=['CPUExecutionProvider'])
manifest = json.load(open('reports/reality-engine/benchmark/manifest.json'))['assets']
bgs = {b: np.array(Image.open(f'tests/fixtures/photos-real/{b}').convert('RGB').resize((W, H), Image.BILINEAR)) for b in BG}
def u2(rgb):
    x = np.array(Image.fromarray(rgb).resize((320, 320), Image.BILINEAR)).astype(np.float32) / 255.0
    x = (x - np.array([0.485, 0.456, 0.406])) / np.array([0.229, 0.224, 0.225]); x = x.transpose(2, 0, 1)[None].astype(np.float32)
    o = sod.run(None, {sod.get_inputs()[0].name: x})[0][0, 0]; o = (o - o.min()) / (o.max() - o.min() + 1e-9)
    return np.array(Image.fromarray((o * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)) / 255.0
def centred(mask):
    lab, n = ndi.label(mask)
    if n == 0: return mask
    keep = np.zeros_like(mask); cy, cx = H / 2, W / 2
    for i in range(1, n + 1):
        c = lab == i; ys, xs = np.where(c)
        if c.sum() < 0.01 * W * H: continue
        inside = (abs(xs.mean() - cx) < 0.3 * W) and (abs(ys.mean() - cy) < 0.3 * H) or c[int(cy), int(cx)]
        if inside: keep |= c
    return keep if keep.any() else mask
def sam(embed, pts, labels, big_h):
    r = dec.run(None, {'image_embeddings': embed, 'point_coords': np.array([pts], np.float32) * S, 'point_labels': np.array([labels], np.float32), 'mask_input': np.zeros((1, 1, 256, 256), np.float32), 'has_mask_input': np.zeros(1, np.float32), 'orig_im_size': np.array([big_h, 1024], np.float32)})
    return np.array(Image.fromarray(((r[0][0, 0] > 0) * 255).astype(np.uint8)).resize((W, H), Image.NEAREST)) > 127
def bbox(m, pad=0.04):
    ys, xs = np.where(m)
    if len(xs) == 0: return None
    return [[max(0, xs.min() - pad * W), max(0, ys.min() - pad * H)], [min(W, xs.max() + pad * W), min(H, ys.max() + pad * H)]]
iou = lambda a, b: (a & b).sum() / max(1, (a | b).sum())
rows = []; agg = {}
for ai, a in enumerate(manifest):
    buf = np.frombuffer(gzip.open(f'scripts/benchmark/cache/{a["id"]}.turn8.rgba.gz').read(), np.uint8).reshape(-1, H, W, 4)
    for vi in VIEWS:
        im = buf[vi]; al = im[..., 3:4] / 255.0; bg = bgs[BG[(ai + vi) % len(BG)]]; rgb = (im[..., :3] * al + bg * (1 - al)).astype(np.uint8); gt = im[..., 3] > 127
        big = np.array(Image.fromarray(rgb).resize((1024, round(H * S)), Image.BILINEAR)).astype(np.float32); emb = enc.run(None, {'input_image': big})[0]
        soft = u2(rgb); raw = soft > 0.5; cen = centred(raw)
        res = {'u2netp': iou(raw, gt), 'u2netp-centred': iou(cen, gt)}
        res['sam-loose-box'] = iou(sam(emb, [[0.12 * W, 0.08 * H], [0.88 * W, 0.92 * H]], [2, 3], big.shape[0]), gt)
        b = bbox(cen) or bbox(raw)
        if b: res['sam-box-from-u2netp-centred'] = iou(sam(emb, b, [2, 3], big.shape[0]), gt)
        res['sam-centre-point+box'] = iou(sam(emb, [[0.12 * W, 0.08 * H], [0.88 * W, 0.92 * H], [W / 2, H / 2]], [2, 3, 1], big.shape[0]), gt)
        for k, v in res.items(): agg.setdefault(k, []).append(float(v))
        rows.append({'asset': a['id'], 'view': vi, **{k: round(float(v), 3) for k, v in res.items()}}); print(a['id'], vi, {k: round(float(v), 2) for k, v in res.items()}, flush=True)
summary = {k: {'meanIoU': round(float(np.mean(v)), 4), 'share>=0.8': round(float(np.mean(np.array(v) >= 0.8)), 3), 'share<0.5': round(float(np.mean(np.array(v) < 0.5)), 3)} for k, v in agg.items()}
print(json.dumps(summary, indent=1)); json.dump({'summary': summary, 'rows': rows}, open('reports/reality-engine/benchmark/segmentation-candidates.json', 'w'), indent=1)
