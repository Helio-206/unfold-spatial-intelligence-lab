#!/usr/bin/env python3
"""Produce an explicitly labelled contact sheet; missing captures are never hidden."""
from PIL import Image, ImageOps, ImageDraw
from pathlib import Path
import sys
root=Path(sys.argv[1] if len(sys.argv)>1 else 'reports/product-integration/visual-quality/captures')
items=['front','side','threeQuarter','selection','isolation','reopened']
sheet=Image.new('RGB',(3*480,2*315),'#16191d'); draw=ImageDraw.Draw(sheet)
for i,name in enumerate(items):
 x=(i%3)*480;y=(i//3)*315;path=root/(name+'.png');draw.text((x+8,y+8),name if path.exists() else name+' — MISSING',fill='white')
 if path.exists():
  with Image.open(path) as im:
   im.thumbnail((464,280));sheet.paste(im,(x+8,y+28))
sheet.save(root/'contact-sheet.jpg',quality=88)
