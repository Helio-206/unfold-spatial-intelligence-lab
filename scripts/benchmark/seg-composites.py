"""Builds the segmentation validation inputs once: composites of the cached renders over real photographs under three conditions (fixed / varied / degraded)
plus the salient-network soft maps (u2netp), cached as gz so the selection logic can be iterated in TypeScript without a browser.
Reference alpha is never touched by any model. Usage: python seg-composites.py <u2netp.onnx>"""
import sys, gzip, json, os
import numpy as np, onnxruntime as ort
from PIL import Image, ImageFilter
W, H = 480, 360
BG = ['car.jpg', 'chair.jpg', 'bus.jpg', 'excavator.jpg', 'porsche-911.jpg', 'skoda-kodiaq.jpg']
sod = ort.InferenceSession(sys.argv[1], providers=['CPUExecutionProvider']); rng = np.random.default_rng(12345)
manifest = json.load(open('reports/reality-engine/benchmark/manifest.json'))['assets']
bgs = {b: np.array(Image.open(f'tests/fixtures/photos-real/{b}').convert('RGB')) for b in BG}
def cover(img, flip):
    h, w = img.shape[:2]; s = max(W / w, H / h); im = Image.fromarray(img).resize((round(w * s), round(h * s)), Image.BILINEAR)
    ox, oy = (im.width - W) // 2, (im.height - H) // 2; out = np.array(im)[oy:oy + H, ox:ox + W]
    return out[:, ::-1] if flip else out
def u2(rgb):
    x = np.array(Image.fromarray(rgb).resize((320, 320), Image.BILINEAR)).astype(np.float32) / 255.0
    x = ((x - np.array([0.485, 0.456, 0.406])) / np.array([0.229, 0.224, 0.225])).transpose(2, 0, 1)[None].astype(np.float32)
    o = sod.run(None, {sod.get_inputs()[0].name: x})[0][0, 0]; o = (o - o.min()) / (o.max() - o.min() + 1e-9)
    return np.array(Image.fromarray((o * 255).astype(np.uint8)).resize((W, H), Image.BILINEAR)).astype(np.float32) / 255.0
def degrade(rgb):
    gain, bias, sigma = rng.uniform(0.65, 1.35), rng.uniform(-25, 25), rng.uniform(4, 12)
    o = (rgb.astype(np.float32) - 128) * gain + 128 + bias + rng.normal(0, sigma, rgb.shape)
    o = np.clip(o, 0, 255).astype(np.uint8)
    if rng.random() < 0.5: o = np.array(Image.fromarray(o).filter(ImageFilter.GaussianBlur(1.0)))
    return o
os.makedirs('scripts/benchmark/cache/seg', exist_ok=True)
for ai, a in enumerate(manifest):
    buf = np.frombuffer(gzip.open(f'scripts/benchmark/cache/{a["id"]}.turn8.rgba.gz').read(), np.uint8).reshape(-1, H, W, 4)
    for cond in ['fixed', 'varied', 'degraded']:
        comps, softs = [], []
        for i, im in enumerate(buf):
            f = BG[ai % len(BG)] if cond == 'fixed' else BG[(ai + i) % len(BG)]
            bg = cover(bgs[f], cond != 'fixed' and i % 2 == 1); al = im[..., 3:4] / 255.0
            rgb = (im[..., :3] * al + bg * (1 - al)).astype(np.uint8)
            if cond == 'degraded': rgb = degrade(rgb)
            comps.append(np.concatenate([rgb, np.full((H, W, 1), 255, np.uint8)], axis=2)); softs.append(u2(rgb))
        np.save(f'scripts/benchmark/cache/seg/{a["id"]}.{cond}.rgba.npy', np.stack(comps)); np.save(f'scripts/benchmark/cache/seg/{a["id"]}.{cond}.sod.npy', np.stack(softs).astype(np.float16))
        print(a['id'], cond, flush=True)
