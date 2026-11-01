from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent
items = [
    ("Case A · tracing and room supports", "evidence/case-a/02-manual-trace-and-regions.png"),
    ("Case A · canonical 3D", "evidence/case-a/03-case-a-scene.png"),
    ("Case A · isolated wall", "evidence/case-a/04-isolated-component.png"),
    ("Case A · cutaway", "evidence/case-a/05-cutaway.png"),
    ("Case B · real Muse Spark output", "evidence/case-b/03-meta-analysis.png"),
    ("Case B · manually traced plan", "evidence/case-b-manual/03-second-plan-tracing.png"),
    ("Case B · partial 3D proposal", "evidence/case-b-manual/07-second-plan-model-settled.png"),
    ("Case B · wall edit preview", "evidence/case-b-manual/09-wall-edit-preview.png"),
    ("Case B · mobile emulation", "evidence/case-b-manual/17-mobile-390x844.png"),
]

columns, cell_width, cell_height, label_height = 3, 480, 320, 34
rows = (len(items) + columns - 1) // columns
sheet = Image.new("RGB", (columns * cell_width, rows * (cell_height + label_height)), "#121412")
draw = ImageDraw.Draw(sheet)
font = ImageFont.load_default()

for index, (label, relative) in enumerate(items):
    image = Image.open(ROOT / relative).convert("RGB")
    image.thumbnail((cell_width, cell_height), Image.Resampling.LANCZOS)
    x = (index % columns) * cell_width
    y = (index // columns) * (cell_height + label_height)
    sheet.paste(image, (x + (cell_width - image.width) // 2, y + (cell_height - image.height) // 2))
    draw.text((x + 12, y + cell_height + 9), label, fill="#eee9dc", font=font)

sheet.save(ROOT / "evidence/phase-10-contact-sheet.png")
