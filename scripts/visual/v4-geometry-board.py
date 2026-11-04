"""python3 -I scripts/visual/v4-geometry-board.py reports/fidelity-v4/living-geometry reports/fidelity-v4/board-living-geometry.png"""
import sys
from PIL import Image, ImageDraw, ImageFont
src, dst = sys.argv[1], sys.argv[2]
rows = [('excavator (saved Meta plan, C+D mechanics: synthetic rotation errors on boom and bucket)', [('excavator-1-v3-original-input', 'V3 original (input plan)'), ('excavator-2-v4-translation-scale-only', 'V4 translation + scale only'), ('excavator-3-v4-with-rotation', 'V4 + local rotation (Phase D)')]),
        ('Lantern (CC0 mesh as evidence, A+D: base and lantern primitives degraded by us)', [('lantern-1-v3-original-input', 'V3 original (input plan)'), ('lantern-2-v4-primitives', 'V4 primitive alternatives (set-geometry)')])]
W, H, pad, head = 560, 350, 8, 34
f = ImageFont.load_default(); b = Image.new('RGB', (3 * W + 4 * pad, len(rows) * (H + head) + 2 * pad + 20), (13, 15, 18)); d = ImageDraw.Draw(b)
d.text((pad, 4), '/living (real workspace), same page and camera within each row. Mechanics / controlled tests: NOT fidelity to an original photograph.', fill=(232, 231, 226), font=f)
for r, (title, cols) in enumerate(rows):
    for c, (k, cap) in enumerate(cols):
        x, y = pad + c * (W + pad), 20 + pad + r * (H + head); d.text((x, y), f'{title if c == 0 else ""}', fill=(232, 231, 226), font=f); d.text((x, y + 14), cap, fill=(185, 189, 195), font=f)
        b.paste(Image.open(f'{src}/{k}.png').convert('RGB').resize((W, H), Image.LANCZOS), (x, y + head - 6))
b.save(dst); print(b.size)
