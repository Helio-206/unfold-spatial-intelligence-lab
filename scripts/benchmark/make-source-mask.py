"""Foreground mask of a source illustration on a plain light background (classical threshold, no model).
python3 -I scripts/benchmark/make-source-mask.py reports/acceptance/inputs/lungs.webp reports/fidelity-v4/lungs-source-mask.pgm
Writes an ASCII PGM (P2): 255 = object, 0 = background, cropped to the object's bounding box. The threshold is a distance from the corner colour."""
import sys
from PIL import Image

src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
w, h = im.size
px = im.load()
corner = [px[0, 0], px[w - 1, 0], px[0, h - 1], px[w - 1, h - 1]]
bg = tuple(sum(c[i] for c in corner) // 4 for i in range(3))
rows = []
for y in range(h):
    rows.append([1 if sum(abs(px[x, y][i] - bg[i]) for i in range(3)) > 60 else 0 for x in range(w)])
ys = [y for y in range(h) if any(rows[y])]
xs = [x for x in range(w) if any(rows[y][x] for y in range(h))]
y0, y1, x0, x1 = min(ys), max(ys), min(xs), max(xs)
with open(dst, 'w') as f:
    f.write(f'P2\n{x1 - x0 + 1} {y1 - y0 + 1}\n255\n')
    for y in range(y0, y1 + 1):
        f.write(' '.join('255' if rows[y][x] else '0' for x in range(x0, x1 + 1)) + '\n')
print(f'{src}: {w}x{h}, background {bg}, object {x1 - x0 + 1}x{y1 - y0 + 1} px ({100 * sum(map(sum, rows)) / (w * h):.1f}% of the image)')
