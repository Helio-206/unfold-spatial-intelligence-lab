"""Comparison board of the /living captures: same viewport, product camera and lighting, one column per variant.
python3 -I scripts/visual/v4-board.py reports/fidelity-v4/living reports/fidelity-v4/board-living.png"""
import json, sys
from PIL import Image, ImageDraw, ImageFont

src, dst = sys.argv[1], sys.argv[2]
res = {(r['name'], r['variant']): r for r in json.load(open(f'{src}/results.json'))}
cols = [('input-v3', 'INPUT through V3 product path  (synthetic degradation of a hand-authored plan)'), ('v4-fit6', 'V4: placement fitted to 6 silhouettes, same product path  (basis: inferred)'), ('ground-truth', 'GROUND TRUTH plan  (hand-authored; the evidence was rendered from it)')]
W, H, pad, head = 560, 350, 10, 44
font = ImageFont.load_default()
rows = ['lungs-like', 'microscope-like']
board = Image.new('RGB', (3 * W + 4 * pad, len(rows) * (H + head) + 2 * pad + 28), (13, 15, 18))
d = ImageDraw.Draw(board)
d.text((pad, 6), '/living (real SpatialWorkspace: product renderer, camera, lighting, framing) - V3 vs V4 - NOT Meta output, synthetic evidence', fill=(232, 231, 226), font=font)
for r, name in enumerate(rows):
    for c, (variant, caption) in enumerate(cols):
        im = Image.open(f'{src}/{name}-{variant}.png').convert('RGB').resize((W, H), Image.LANCZOS)
        x, y = pad + c * (W + pad), 28 + pad + r * (H + head)
        board.paste(im, (x, y + head - 14))
        info = res[(name, variant)]
        d.text((x, y), f'{name}: {caption}', fill=(232, 231, 226), font=font)
        d.text((x, y + 14), f"object {info['framing']['widthFraction']:.2f} x {info['framing']['heightFraction']:.2f} of the canvas, {info['components']} selectable components, {info['report']['totals']['triangles']} tris", fill=(185, 189, 195), font=font)
board.save(dst)
print('board written', board.size)
