import json
from PIL import Image, ImageDraw
with open('reports/fidelity-v4/e2-visual/mask-board.json') as f: cases=json.load(f)
scale=3
im=Image.new('RGB',(6*250,3*300+60),'#121820')
d=ImageDraw.Draw(im)
for i,title in enumerate(['fit / ref','fit / initial','fit / fitted','held / ref','held / initial','held / fitted']): d.text((i*250+10,10),title,fill='white')
for row,case in enumerate(cases):
 d.text((10,40+row*300),case['name']+' — synthetic masks',fill='#e6b45d')
 for v in range(2):
  for j,key in enumerate(['reference','before','after']):
   pixels=bytes(230 if x else 18 for x in case['views'][v][key]); mask=Image.frombytes('L',(80,80),pixels).transpose(Image.Transpose.FLIP_TOP_BOTTOM).resize((240,240),Image.Resampling.NEAREST).convert('RGB');im.paste(mask,((v*3+j)*250,60+row*300))
im.save('reports/fidelity-v4/e2-visual/mask-contact.png')
