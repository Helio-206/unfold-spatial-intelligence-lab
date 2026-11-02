#!/usr/bin/env python3
"""Compares the pipeline output (raw JSON from run-detect.mjs) with a colour-mask proxy of the real walls.

The proxy is NOT ground truth: it is "neutral dark, thick" pixels (the walls in this drawing are charcoal;
floor strips are beige, furniture is brown or light grey). It is independent of the detector's own grayscale
threshold, but it can miss walls that are drawn lighter and it can include other charcoal things. The report says so.

usage: analyze.py <image.png> <raw.json> <out.json> <overlay-dir>
"""
import json, sys
import numpy as np
from PIL import Image, ImageDraw

img_path, raw_path, out_path, overlay_dir = sys.argv[1:5]
im = np.array(Image.open(img_path).convert('RGB')).astype(int)
H, W = im.shape[:2]
gray = im.mean(axis=2)
sat = im.max(axis=2) - im.min(axis=2)
mask = (gray < 75) & (sat < 22)           # neutral dark
raw = json.load(open(raw_path))

# --- proxy wall runs: thick axis-aligned bars of the mask ------------------------------------------------------
def bars(m, axis):
    """axis 0: horizontal bars (scan rows), axis 1: vertical bars (scan columns). returns list of (a0,a1,b0,b1) with a = along, b = across."""
    mm = m if axis == 0 else m.T
    open_runs = {}
    out = []
    for row in range(mm.shape[0] + 1):
        found = []
        if row < mm.shape[0]:
            x = 0
            line = mm[row]
            while x < line.size:
                if line[x]:
                    s = x
                    while x < line.size and line[x]: x += 1
                    if x - s >= 24: found.append((s, x))
                else: x += 1
        nxt = {}
        for (s, e) in found:
            key = next((k for k in open_runs if abs(k[0] - s) <= 3 and abs(k[1] - e) <= 3), None)
            if key: nxt[(s, e)] = open_runs.pop(key) + [row]
            else: nxt[(s, e)] = [row]
        for k, rows in open_runs.items():
            if len(rows) >= 5: out.append((k[0], k[1], rows[0], rows[-1]))
        open_runs = nxt
    return out

hb = bars(mask, 0); vb = bars(mask, 1)
# merge collinear bars of the same orientation that touch (the same wall run drawn in pieces by the mask)
def merge(bs):
    bs = sorted(bs, key=lambda b: (round((b[2] + b[3]) / 2 / 6), b[0]))
    res = []
    for b in bs:
        for i, r in enumerate(res):
            if abs((r[2] + r[3]) / 2 - (b[2] + b[3]) / 2) <= 5 and b[0] <= r[1] + 6 and b[1] >= r[0] - 6:
                res[i] = (min(r[0], b[0]), max(r[1], b[1]), min(r[2], b[2]), max(r[3], b[3])); break
        else: res.append(b)
    return res
hb = merge(hb); vb = merge(vb)
proxy = [dict(orientation='horizontal', x0=a0, x1=a1, y0=b0, y1=b1) for a0, a1, b0, b1 in hb] + [dict(orientation='vertical', x0=b0, x1=b1, y0=a0, y1=a1) for a0, a1, b0, b1 in vb]

# --- classify candidates ---------------------------------------------------------------------------------------
cands = raw['candidates']
def classify(c):
    (x0, y0), (x1, y1) = (c['start']['x'], c['start']['y']), (c['end']['x'], c['end']['y'])
    n = max(2, int(np.hypot(x1 - x0, y1 - y0) // 2))
    hit = 0; colours = []
    for t in np.linspace(0, 1, n):
        x = int(round(x0 + (x1 - x0) * t)); y = int(round(y0 + (y1 - y0) * t))
        x = min(max(x, 0), W - 1); y = min(max(y, 0), H - 1)
        r = 3
        win = mask[max(0, y - r):y + r + 1, max(0, x - r):x + r + 1]
        hit += bool(win.any())
        colours.append(im[y, x])
    frac = hit / n
    med = np.median(np.array(colours), axis=0)
    s = med.max() - med.min(); g = med.mean()
    kind = 'wall' if frac >= 0.75 else None
    if kind is None:
        if s >= 22: kind = 'false: coloured furniture/fixture'
        elif g > 215: kind = 'false: light floor strip / tile line'
        elif g > 100: kind = 'false: mid-grey (frame, fixture, door arc)'
        else: kind = 'false: other'
    return frac, kind
for c in cands:
    c['wallFraction'], c['class'] = classify(c)

# Manual annotation, decided by looking at the drawing: the balcony frame is a mid-grey wall that the colour mask does not see.
# Candidates lying on the border of this box are counted as real walls (class "wall (balcony frame)").
BALCONY = (247, 3, 728, 100)
def on_balcony_border(c, tol=6):
    x0, y0, x1, y1 = BALCONY
    sx, sy, ex, ey = c['start']['x'], c['start']['y'], c['end']['x'], c['end']['y']
    inside = all(x0 - tol <= x <= x1 + tol and y0 - tol <= y <= y1 + tol for x, y in ((sx, sy), (ex, ey)))
    on_edge = (abs(sy - ey) <= 2 and (abs(sy - y0) <= tol or abs(sy - y1) <= tol)) or (abs(sx - ex) <= 2 and (abs(sx - x0) <= tol or abs(sx - x1) <= tol))
    return inside and on_edge
for c in cands:
    if c['class'] != 'wall' and on_balcony_border(c): c['class'] = 'wall (balcony frame)'
real = [c for c in cands if c['class'].startswith('wall')]; false = [c for c in cands if not c['class'].startswith('wall')]

# --- recall against the proxy runs ----------------------------------------------------------------------------
cov = Image.new('L', (W, H), 0); d = ImageDraw.Draw(cov)
for c in real: d.line([c['start']['x'], c['start']['y'], c['end']['x'], c['end']['y']], fill=255, width=11)
cov = np.array(cov) > 0
def covered(p):
    sub = mask[p['y0']:p['y1'] + 1, p['x0']:p['x1'] + 1]
    c = cov[p['y0']:p['y1'] + 1, p['x0']:p['x1'] + 1]
    return float((sub & c).sum() / max(1, sub.sum()))
for p in proxy: p['covered'] = covered(p)
found = [p for p in proxy if p['covered'] >= 0.6]; missed = [p for p in proxy if p['covered'] < 0.6]
mask_px = int(mask.sum()); cov_px = int((mask & cov).sum())

result = dict(
    proxyRuns=len(proxy), proxyFound=len(found), proxyMissed=[dict(p) for p in missed],
    candidates=len(cands), realCandidates=len(real), falseCandidates=len(false),
    falseByKind={k: sum(1 for c in false if c['class'] == k) for k in sorted({c['class'] for c in false})},
    realByKind={k: sum(1 for c in real if c['class'] == k) for k in sorted({c['class'] for c in real})},
    maskPixelsCoveredByRealCandidates=round(cov_px / mask_px, 3),
    candidatesDetail=[{k: c[k] for k in ('id', 'orientation', 'start', 'end', 'thicknessPx', 'wallFraction', 'class')} for c in cands],
    proxy=proxy,
)
json.dump(result, open(out_path, 'w'), indent=1)

# --- overlays: lines only, on a blank canvas (the plan itself is not reproduced) --------------------------------
import os
os.makedirs(overlay_dir, exist_ok=True)
S = 2
def canvas(): 
    c = Image.new('RGB', (W * S, H * S), 'white'); return c, ImageDraw.Draw(c)
c, d = canvas()
for p in proxy:
    col = (214, 40, 40) if p['covered'] < 0.6 else (200, 200, 200)
    d.rectangle([p['x0'] * S, p['y0'] * S, p['x1'] * S, p['y1'] * S], outline=col, width=2)
for k in false: d.line([k['start']['x'] * S, k['start']['y'] * S, k['end']['x'] * S, k['end']['y'] * S], fill=(255, 90, 31), width=3)
for k in real: d.line([k['start']['x'] * S, k['start']['y'] * S, k['end']['x'] * S, k['end']['y'] * S], fill=(15, 20, 25), width=3)
d.text((10, 8), f"black: accepted wall candidates ({len(real)})   orange: false candidates ({len(false)})   red box: wall run not covered ({len(missed)})   grey box: wall run covered", fill=(0, 0, 0))
c.save(f'{overlay_dir}/sample-1-wall-candidates.png')
print(json.dumps({k: v for k, v in result.items() if k not in ('candidatesDetail', 'proxy', 'proxyMissed')}))
print('missed:', [(p['orientation'], p['x0'], p['y0'], p['x1'], p['y1'], round(p['covered'], 2)) for p in missed])
