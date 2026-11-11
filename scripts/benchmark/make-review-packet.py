# Builds the packet for the INDEPENDENT human visual review that certification requires: one blinded-order board per asset (inputs on the left, the product's
# reconstruction on the right), a rubric, and a score sheet to be filled in by someone who is not the implementer. It does not score anything itself.
#   python3 scripts/benchmark/make-review-packet.py
import json, os, random
from PIL import Image, ImageDraw
root = 'reports/reality-engine'; out = f'{root}/visual-review'; os.makedirs(out, exist_ok=True)
dirs = {'BoomBox': f'{root}/e2e', 'CesiumMilkTruck': f'{root}/e2e-CesiumMilkTruck', 'AntiqueCamera': f'{root}/e2e-AntiqueCamera', 'Avocado': f'{root}/e2e-Avocado', 'Corset': f'{root}/e2e-Corset', 'MaterialsVariantsShoe': f'{root}/e2e-MaterialsVariantsShoe', 'ChairDamaskPurplegold': f'{root}/e2e-ChairDamaskPurplegold', 'IridescenceLamp': f'{root}/e2e-IridescenceLamp'}
manifest = {a['id']: a for a in json.load(open(f'{root}/benchmark/manifest.json'))['assets']}
product = {r['id']: r for r in json.load(open(f'{root}/benchmark/product-results/product-results.json'))['results']}
rows = []
for asset, d in dirs.items():
    try:
        ins = [Image.open(f'{d}/inputs/view-{i:02d}.png').convert('RGB').resize((240, 180)) for i in range(8)]
        rec = Image.open(f'{d}/05-refined.png').convert('RGB').crop((300, 120, 1250, 860))
    except FileNotFoundError:
        continue
    W = 240 * 4 + 20; board = Image.new('RGB', (W + rec.width + 20, max(180 * 2 + 10, rec.height) + 40), (20, 22, 26))
    for i, im in enumerate(ins): board.paste(im, ((i % 4) * 245, (i // 4) * 185 + 30))
    board.paste(rec, (W + 20, 30)); ImageDraw.Draw(board).text((5, 8), f'{asset}: 8 input renders (left) -> reconstruction in /living (right). Inputs are renders of a licensed 3D asset, not photographs.', fill=(230, 230, 230))
    board.save(f'{out}/board-{asset}.png'); p = product.get(asset, {})
    rows.append({'asset': asset, 'split': manifest[asset]['split'], 'category': manifest[asset]['category'], 'board': f'board-{asset}.png', 'machineMetrics': {'chamferPct': p.get('chamferPctAligned'), 'heldOutIoU': p.get('heldOutIoUMean'), 'fidelityClassShown': p.get('fidelityClass')}})
random.Random(7).shuffle(rows)  # the reviewer sees them in a fixed shuffled order, not by split
sheet = {'contract': 'unfold.visual-review-sheet.v1', 'reviewer': {'name': None, 'independentOfImplementation': None, 'date': None, 'declaration': 'I did not write or tune this software and I scored each board on what I see, without reading the machine metrics first.'}, 'scale': '1 = unacceptable, 3 = acceptable with visible flaws, 5 = convincing', 'criteria': {'silhouetteMatch': 'Does the outline of the reconstruction match the object in the input views?', 'surfacePlausibility': 'Is the surface free of artefacts that are not in the object (tears, slabs, spikes)?', 'colourFidelity': 'Are the colours those of the object, and are unseen regions clearly marked as hypothesis?', 'partStructure': 'Are the parts it separated meaningful pieces of the object, or arbitrary slices?', 'honesty': 'Does the interface avoid claiming more than it shows (fidelity label, uncertainty, hypothesis colour)?'}, 'boards': [{'asset': r['asset'], 'board': r['board'], 'scores': {k: None for k in ['silhouetteMatch', 'surfacePlausibility', 'colourFidelity', 'partStructure', 'honesty']}, 'comments': ''} for r in rows]}
json.dump(sheet, open(f'{out}/score-sheet.json', 'w'), indent=2)
json.dump(rows, open(f'{out}/machine-metrics.json', 'w'), indent=2)
open(f'{out}/README.md', 'w').write('''# Independent visual review packet

Certification of the Reality Engine requires a visual review by someone who did **not** implement it. This packet is what that person needs; nothing here is a review.

1. Open each `board-*.png` (inputs on the left, the product's reconstruction on the right). Boards are in `score-sheet.json` in a fixed shuffled order.
2. Fill `score-sheet.json` (reviewer name, independence declaration, a 1-5 score for each criterion, comments). Do not read `machine-metrics.json` until you have scored.
3. Return the file. A category is only certified "partially verified" with a mean >= 3 on every criterion and no board scoring 1 on `honesty`.

Status: **NOT REVIEWED** (no independent reviewer was available to the implementer). The only reviewer so far is the implementer, whose notes are in `reports/reality-engine/REPORT.md` and do not count.
''')
print(len(rows), 'boards')
