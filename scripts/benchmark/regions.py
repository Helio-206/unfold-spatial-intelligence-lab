#!/usr/bin/env python3
"""Region overlay + which expected space each region contains. Label positions are read by eye from the drawing (centre of each name)."""
import json, sys
from PIL import Image, ImageDraw
raw_path, out_path, overlay_path = sys.argv[1:4]
raw = json.load(open(raw_path)); W, H = raw['image']['width'], raw['image']['height']
SPACES = {  # name: (x, y) of the label / of the middle of an unlabelled space
 'Balcony': (480, 50), 'Bedroom 2': (130, 122), 'Master Bedroom': (845, 195), 'Dining': (365, 222), 'Living': (596, 222),
 'Kitchen': (522, 533), 'Foyer': (664, 533), "Maid's Qtr": (405, 480), 'Walk-in Closet': (850, 468), 'T&B (left)': (110, 333),
 'T&B (master)': (915, 543), 'Bedroom 3': (130, 603), 'Bath beside kitchen': (305, 420), 'Bath below': (300, 530),
}
def inside(pt, poly):
    x, y = pt; ok = False; n = len(poly)
    for i in range(n):
        x0, y0 = poly[i]['x'], poly[i]['y']; x1, y1 = poly[(i + 1) % n]['x'], poly[(i + 1) % n]['y']
        if (y0 > y) != (y1 > y) and x < (x1 - x0) * (y - y0) / (y1 - y0) + x0: ok = not ok
    return ok
regions = raw['regions']
table = {}
for name, pt in SPACES.items():
    table[name] = [r['id'] for r in regions if inside(pt, r['vertices'])]
out = dict(totalRegions=len(regions), eligible=sum(r['eligibility'] == 'construction_candidate' for r in regions),
           regions=[dict(id=r['id'], eligibility=r['eligibility'], areaPx2=round(r['areaPx2']), bbox=[min(v['x'] for v in r['vertices']), min(v['y'] for v in r['vertices']), max(v['x'] for v in r['vertices']), max(v['y'] for v in r['vertices'])], method=r.get('topologyMethod')) for r in regions],
           spaceToRegions=table)
json.dump(out, open(out_path, 'w'), indent=1)
S = 2; im = Image.new('RGB', (W * S, H * S), 'white'); d = ImageDraw.Draw(im)
pal = [(214, 40, 40), (31, 119, 180), (44, 160, 44), (148, 103, 189), (140, 86, 75), (227, 119, 194), (127, 127, 127), (188, 189, 34), (23, 190, 207), (255, 127, 14), (0, 0, 0), (120, 120, 255)]
for i, r in enumerate(regions):
    col = pal[i % len(pal)]; pts = [(v['x'] * S, v['y'] * S) for v in r['vertices']]
    d.polygon(pts, outline=col, width=3)
    cx = sum(p[0] for p in pts) / len(pts); cy = sum(p[1] for p in pts) / len(pts)
    d.text((cx - 14, cy), r['id'].replace('region-', 'R'), fill=col)
for name, (x, y) in SPACES.items():
    d.ellipse([x * S - 5, y * S - 5, x * S + 5, y * S + 5], fill=(0, 0, 0)); d.text((x * S + 8, y * S - 6), name, fill=(0, 0, 0))
im.save(overlay_path)
print(json.dumps(out['spaceToRegions'])); print([ (r['id'], r['eligibility'][:4], r['areaPx2']) for r in regions])
