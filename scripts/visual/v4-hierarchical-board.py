"""python3 -I scripts/visual/v4-hierarchical-board.py reports/fidelity-v4/living-hierarchical reports/fidelity-v4/board-living-hierarchical.png"""
import sys
from PIL import Image, ImageDraw, ImageFont
src, dst = sys.argv[1], sys.argv[2]
cols = [('1-v3-original-input', 'V3 original (input plan, product path)'), ('2-v4-non-hierarchical', 'V4 non-hierarchical (Phase B engine)'), ('3-v4-hierarchical', 'V4 hierarchical (Phase C engine)')]
W, H, pad, head = 560, 350, 8, 34
f = ImageFont.load_default(); rows = [('excavator', 'excavator (saved Meta plan, C+D mechanics)'), ('harp', 'harp (saved Meta plan, C+D mechanics)')]
b = Image.new('RGB', (3 * W + 4 * pad, len(rows) * (H + head) + 2 * pad + 20), (13, 15, 18)); d = ImageDraw.Draw(b)
d.text((pad, 4), '/living (real workspace), same page and camera per row. Mechanics test: the "truth" is the saved plan itself, NOT the original photograph.', fill=(232, 231, 226), font=f)
for r, (n, t) in enumerate(rows):
    for c, (k, cap) in enumerate(cols):
        x, y = pad + c * (W + pad), 20 + pad + r * (H + head); d.text((x, y), f'{t}: {cap}', fill=(232, 231, 226), font=f)
        b.paste(Image.open(f'{src}/{n}-{k}.png').convert('RGB').resize((W, H), Image.LANCZOS), (x, y + head - 12))
b.save(dst); print(b.size)
