"""Board of the /living structural comparison: python3 -I scripts/visual/v4-structural-board.py reports/fidelity-v4/living-structural reports/fidelity-v4/board-living-structural.png"""
import sys, os
from PIL import Image, ImageDraw, ImageFont
src, dst = sys.argv[1], sys.argv[2]
cases = [('lungs-like', 'lungs (D/D synthetic)'), ('microscope-like', 'microscope (D/D synthetic)'), ('Lantern', 'Lantern (A: CC0 mesh as evidence + D plan)'), ('AntiqueCamera', 'AntiqueCamera (A + D)')]
cols = [('1-input-v3', 'INPUT via V3 product path'), ('3-silhouette-only-contrast', 'V4 silhouette-only (contrast)'), ('2-v4-structural', 'V4 structural (constraints)'), ('4-ground-truth-own-framing', 'ground-truth plan (own framing)')]
W, H, pad, head = 420, 262, 8, 34
f = ImageFont.load_default(); board = Image.new('RGB', (4 * W + 5 * pad, len(cases) * (H + head) + 2 * pad + 20), (13, 15, 18)); d = ImageDraw.Draw(board)
d.text((pad, 4), '/living (real workspace) - same page and camera in the first three columns - NOT Meta output - preview -> authorise -> apply; undo verified', fill=(232, 231, 226), font=f)
for r, (n, t) in enumerate(cases):
    for c, (k, cap) in enumerate(cols):
        p = f'{src}/{n}-{k}.png'
        x, y = pad + c * (W + pad), 20 + pad + r * (H + head)
        d.text((x, y), f'{t}: {cap}' if os.path.exists(p) else f'{t}: (no ground-truth plan: the evidence is a CC0 mesh)', fill=(232, 231, 226), font=f)
        if os.path.exists(p): board.paste(Image.open(p).convert('RGB').resize((W, H), Image.LANCZOS), (x, y + head - 12))
board.save(dst); print(board.size)
