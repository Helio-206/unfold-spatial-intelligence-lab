#!/usr/bin/env python3
"""Side-by-side comparison sheets (before | technical | presentation) from the images written by run.mjs, and a markdown table of the benchmark.
usage: sheets.py reports/rendering"""
import json, os, sys
from PIL import Image, ImageDraw
root = sys.argv[1]; images = f'{root}/images'; os.makedirs(f'{root}/sheets', exist_ok=True)
data = json.load(open(f'{root}/benchmark.json'))
LABEL = {'before': 'before (main)', 'technical': 'after: technical', 'presentation': 'after: presentation', 'presentation-on-editor-rig': 'presentation materials, editor lights'}
seen = {(s['fixture'], s['view']) for s in data['shots']}
for fixture, view in sorted(seen):
    variants = [v for v in ('before', 'technical', 'presentation') if os.path.exists(f'{images}/{fixture}__{view}__{v}.png')]
    ims = [Image.open(f'{images}/{fixture}__{view}__{v}.png').convert('RGB') for v in variants]
    w, h = ims[0].size; sw, sh = w * 2 // 3, h * 2 // 3
    sheet = Image.new('RGB', (sw * len(ims), sh + 26), (11, 13, 16)); d = ImageDraw.Draw(sheet)
    for i, (v, im) in enumerate(zip(variants, ims)):
        sheet.paste(im.resize((sw, sh), Image.LANCZOS), (i * sw, 26)); d.text((i * sw + 8, 8), LABEL[v], fill=(243, 240, 232))
    sheet.save(f'{root}/sheets/{fixture}__{view}.png', optimize=True)
rows = ['| fixture | variant | frame mean ms | p95 ms | fps (SwiftShader) | draw calls | triangles | meshes | lines | geometries | materials | textures | texture MiB | build ms |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|']
for b in data['bench']:
    s = b['scene']; f = b['frame']
    rows.append(f"| {b['fixtureId']} | {b['variant']} | {f['meanMs']} | {f['p95Ms']} | {f['fps']} | {b['draw']['callsPerFrame']} | {b['draw']['trianglesPerFrame']} | {s['meshes']} | {s['lines']} | {s['geometries']} | {s['materials']} | {s['textures']} | {s['textureBytes'] / 1048576:.2f} | {b['build']['ms']} |")
open(f'{root}/benchmark-table.md', 'w').write('\n'.join(rows) + '\n')
print('\n'.join(rows))
