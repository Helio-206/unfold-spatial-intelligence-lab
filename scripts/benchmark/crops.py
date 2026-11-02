#!/usr/bin/env python3
"""Small crops (a few hundred px) of the local fixture with the pipeline output drawn over them. Only these go into the report."""
import json, sys
from PIL import Image, ImageDraw
img_path, raw_path, an_path, out_dir = sys.argv[1:5]
im = Image.open(img_path).convert('RGB'); raw = json.load(open(raw_path)); an = json.load(open(an_path))
cls = {c['id']: c['class'] for c in an['candidatesDetail']}
S = 3
def crop(name, box, regions=False, openings=False):
    x0, y0, x1, y1 = box
    c = im.crop(box).resize(((x1 - x0) * S, (y1 - y0) * S), Image.NEAREST); d = ImageDraw.Draw(c)
    for k in raw['candidates']:
        a, b = (k['start']['x'] - x0) * S, (k['start']['y'] - y0) * S; e, f = (k['end']['x'] - x0) * S, (k['end']['y'] - y0) * S
        if max(a, e) < 0 or min(a, e) > c.width or max(b, f) < 0 or min(b, f) > c.height: continue
        real = cls[k['id']].startswith('wall')
        d.line([a, b, e, f], fill=(0, 160, 90) if real else (255, 90, 31), width=3)
    if regions:
        for r in raw['regions']:
            if r['eligibility'] == 'construction_candidate':
                pts = [((v['x'] - x0) * S, (v['y'] - y0) * S) for v in r['vertices']]
                d.line(pts + [pts[0]], fill=(31, 119, 180), width=3)
    if openings:
        for o in raw['openingCandidates']:
            d.line([(o['start']['x'] - x0) * S, (o['start']['y'] - y0) * S, (o['end']['x'] - x0) * S, (o['end']['y'] - y0) * S], fill=(200, 0, 200), width=5)
    c.save(f'{out_dir}/{name}.png')
import os; os.makedirs(out_dir, exist_ok=True)
crop('fail-1-master-right-wall', (890, 95, 983, 235))
crop('fail-2-kitchen-region', (440, 360, 640, 540), regions=True)
crop('fail-3-openings-on-chairs', (270, 160, 450, 270), openings=True)
