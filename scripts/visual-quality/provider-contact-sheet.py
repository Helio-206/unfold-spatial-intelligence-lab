#!/usr/bin/env python3
from PIL import Image,ImageDraw
from pathlib import Path
import sys
root=Path(sys.argv[1] if len(sys.argv)>1 else 'reports/product-integration/uvf-independent')
names=['hatchback','sofa','washer','pavilion','apple','wrench','monitor','miniExcavator']
w,h=480,312
sheet=Image.new('RGB',(w*2,h*len(names)),'#181b1f');d=ImageDraw.Draw(sheet)
for i,name in enumerate(names):
 for j,mode in enumerate(['v3','foundry']):
  x,y=j*w,i*h; p=root/f'{name}-{mode}-threeQuarter.png';d.text((x+8,y+7),f'{name} / {"router: V2 used" if mode == "v3" else "Foundry"}' if p.exists() else f'{name} / {mode} MISSING',fill='white')
  if p.exists():
   with Image.open(p) as im:
    im.thumbnail((w-12,h-28));sheet.paste(im,(x+6,y+25))
sheet.save(root/'contact-sheet.jpg',quality=88)
