import json
from PIL import Image,ImageDraw
names=['two-body','three-body','unseen-folded']
im=Image.new('RGB',(1200,900),'#121820');d=ImageDraw.Draw(im)
for row,name in enumerate(names):
 with open(f'reports/fidelity-v4/e2-2/{name}-evidence.json') as f: data=json.load(f)
 for col,index in enumerate([3,4]):
  v=data['views'][index]; canvas=Image.new('RGB',(64,64),(15,20,25));pixels=canvas.load();items=list(v['components'].items());colors=[(240,80,80),(80,220,100),(80,140,255)]
  for y in range(64):
   for x in range(64):
    present=[colors[i] for i,(_,c) in enumerate(items) if c['mask'][y*64+x]]
    if present:pixels[x,63-y]=tuple(min(255,sum(p[k] for p in present)) for k in range(3))
  canvas=canvas.resize((384,384),Image.Resampling.NEAREST);ox=col*600;oy=row*300;canvas.thumbnail((270,270),Image.Resampling.NEAREST);im.paste(canvas,(ox,oy+25));states=', '.join(f'{k}:'+('occluded' if c['occluded'] else 'clear') for k,c in items);d.text((ox+5,oy+5),f"{name} / {v['partition']} / {states}",fill='white')
im.save('reports/fidelity-v4/e2-2/component-masks.png')
