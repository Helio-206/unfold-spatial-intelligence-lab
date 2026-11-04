import {BoxGeometry,Matrix4,Quaternion,Euler,Vector3} from 'three';
import {makeView,rasterise,type Tri} from '../../../src/universal-spatial/reconstruction/silhouette';
import {createHash} from 'node:crypto';
// Evaluation-only reference definitions. The fitter never imports this module.
export const references=[
 {name:'two-link',parts:[{d:[.8,.5,2.4],p:[0,0,0],rx:0},{d:[.55,.4,1.2],p:[0,0,1.5],rx:0}]},
 {name:'three-link',parts:[{d:[.8,.5,2.4],p:[0,0,0],rx:0},{d:[.55,.4,1.2],p:[0,0,1.5],rx:0},{d:[.9,.6,.8],p:[0,0,2.4],rx:0}]},
 {name:'unseen-tilted',parts:[{d:[.7,.6,2.2],p:[0,0,0],rx:0},{d:[.6,.5,1.1],p:[0,.15,1.5],rx:.25},{d:[1,.7,.8],p:[0,.3,2.4],rx:.2}]},
] as const;
const dirs=[[1,0,0],[0,1,0],[0,0,1],[1,.7,1],[-1,.4,1],[.5,1,-.7],[-.4,.8,-1],[1,-.6,-1]] as const;
export function evidence(index:number){const ref=references[index]!,tris:Tri[]=[];for(const p of ref.parts){const geom=new BoxGeometry(...p.d),a=geom.getAttribute('position'),idx=geom.index!,m=new Matrix4().compose(new Vector3(...p.p),new Quaternion().setFromEuler(new Euler(p.rx,0,0)),new Vector3(1,1,1));for(let i=0;i<idx.count;i+=3){const v=(j:number)=>new Vector3().fromBufferAttribute(a,idx.getX(i+j)).applyMatrix4(m);tris.push([v(0),v(1),v(2)]);}geom.dispose();}
return {name:ref.name,kind:'synthetic-independent-BoxGeometry',seed:0,views:dirs.map((d,i)=>{const view=makeView(new Vector3(...d),new Vector3(0,0,.75),3,64),mask=rasterise(tris,view);return {partition:i<4?'fit':'held',direction:d,centre:[0,0,.75],half:3,res:64,mask:Array.from(mask),sha256:createHash('sha256').update(mask).digest('hex')};})};}
