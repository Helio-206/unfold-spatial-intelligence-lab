import { readFileSync } from 'node:fs'; import { resolve } from 'node:path'; import { gunzipSync } from 'node:zlib';
import { Box3, Vector3 } from 'three';
import { readGlbParts } from '../../src/universal-spatial/reconstruction/glb-geometry';
import { orbitPinhole, rasterisePinhole } from '../../src/universal-spatial/reconstruction/multiview';
import { intakeOrbit } from '../../src/living/reality/intake';
import { viewsOf } from '../../src/living/reality/model';
const W=480,H=360,FILL=.55,id=process.argv[2]!,FOV=Number(process.argv[3]);
const buf=gunzipSync(readFileSync(resolve('scripts/benchmark/cache',`${id}.turn8${FOV===12?'':`.fov${FOV}`}.rgba.gz`))),sz=W*H*4;
const ph=Array.from({length:8},(_,i)=>{const data=new Uint8ClampedArray(buf.subarray(i*sz,(i+1)*sz)),mask=new Uint8Array(W*H);for(let k=0;k<mask.length;k++)mask[k]=data[k*4+3]!>127?1:0;return{name:`${id}-${i}`,rgba:{width:W,height:H,data},mask,maskSource:'confirmed' as const}});
const ev=intakeOrbit(ph,{elevationDeg:20}).evidence!, views=viewsOf(ev);
const tris=readGlbParts(new Uint8Array(readFileSync(`reports/reality-engine/benchmark/assets/${id}/${id}.glb`))).flatMap(p=>p.tris);
const box=new Box3();for(const t of tris)for(const p of t)box.expandByPoint(p);const c=box.getCenter(new Vector3()),h=box.getSize(new Vector3()).y;
const gt=tris.map(t=>t.map(p=>p.clone().sub(c).multiplyScalar(FILL/h)) as unknown as [Vector3,Vector3,Vector3]);
const iou=(a:Uint8Array,b:Uint8Array)=>{let i=0,u=0;for(let k=0;k<a.length;k++){i+=a[k]!&b[k]!;u+=a[k]!|b[k]!}return u?i/u:0};
console.log('frame',ev.frame, 'azimuths',views.map(v=>v.azimuthDeg).join(','));
for (const mirror of [0,1,2]) for (const f of [FOV]) { const out:string[]=[]; for(const v of views){ const g=mirror===0?gt:gt.map(t=>t.map(p=>mirror===1?new Vector3(-p.x,p.y,p.z):new Vector3(p.x,p.y,-p.z)) as unknown as [Vector3,Vector3,Vector3]); const cam=orbitPinhole(v.azimuthDeg,v.elevationDeg,f,v.res,ev.frame.half); out.push(iou(rasterisePinhole(g,cam,v.res),v.mask).toFixed(2)); } console.log('mirror',mirror,'fov',f,out.join(' ')); }
let best={iou:0,dy:0,dx:0,f:0};
for (const f of [30,35,40,45,50]) for (let dy=-10;dy<=10;dy+=2) for (let dx=-6;dx<=6;dx+=3) { let s=0; for(const v of views.slice(0,4)){ const cam=orbitPinhole(v.azimuthDeg,v.elevationDeg,f,v.res,ev.frame.half); cam.cy+=dy; cam.cx+=dx; s+=iou(rasterisePinhole(gt,cam,v.res),v.mask); } s/=4; if(s>best.iou)best={iou:s,dy,dx,f}; }
console.log('best',best, 'res',views[0]!.res);
