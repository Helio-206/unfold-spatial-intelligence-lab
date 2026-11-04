import { createHash } from 'node:crypto';
import { BoxGeometry, Euler, Matrix4, Vector3 } from 'three';
import { makeView, project, rasterise, type Tri } from '../../../src/universal-spatial/reconstruction/silhouette';
// Evaluation-only ground truth; no import of the candidate kinematics or fitter.
export const referenceCases=[
 {name:'two-body',dims:[[.7,.45,2.4],[.45,.4,1.4]],angles:[.4]},
 {name:'three-body',dims:[[.75,.5,2.4],[.45,.4,1.4],[.85,.6,.8]],angles:[.4,-.3]},
 {name:'unseen-folded',dims:[[.6,.5,2.1],[.55,.4,1.7],[1,.55,.9]],angles:[-.5,.6]},
] as const;
const dirs=[[1,0,0],[0,1,0],[0,0,1],[1,.7,1],[-1,.4,1],[.5,1,-.7],[-.4,.8,-1],[1,-.6,-1]] as const;
export function generateReference(i:number){const spec=referenceCases[i]!,sourceSha256=createHash('sha256').update(JSON.stringify(spec)).digest('hex');const parts:Tri[][]=[],jointPoints:Vector3[]=[];let world=new Matrix4();
 for(let k=0;k<spec.dims.length;k++){const dim=spec.dims[k]!;if(k>0){const parentLength=spec.dims[k-1]![2],angle=spec.angles[k-1]!,joint=new Vector3(0,0,parentLength/2).applyMatrix4(world);jointPoints.push(joint);world=world.clone().multiply(new Matrix4().makeTranslation(0,0,parentLength/2)).multiply(new Matrix4().makeRotationFromEuler(new Euler(angle,0,0))).multiply(new Matrix4().makeTranslation(0,0,dim[2]/2));}const g=new BoxGeometry(...dim),position=g.getAttribute('position'),index=g.index!,tris:Tri[]=[];for(let n=0;n<index.count;n+=3){const v=(a:number)=>new Vector3().fromBufferAttribute(position,index.getX(n+a)).applyMatrix4(world);tris.push([v(0),v(1),v(2)]);}g.dispose();parts.push(tris);}
 const ids=['boom','stick','bucket'];return {name:spec.name,sourceSha256,seed:0,reference:'independent THREE.BoxGeometry, known-joint synthetic; not physical',views:dirs.map((d,n)=>{const view=makeView(new Vector3(...d),new Vector3(0,0,1),4,64),scene=rasterise(parts.flat(),view),masks=parts.map(p=>rasterise(p,view)),components=Object.fromEntries(masks.map((mask,k)=>[ids[k],{mask:Array.from(mask),visible:mask.some(x=>x===1),occluded:masks.some((m,j)=>j!==k&&m.some((x,z)=>x===1&&mask[z]===1))}]));const landmarks=jointPoints.map((p,k)=>({jointId:`joint-${k}`,pixel:project(view,p),uncertaintyPx:1,visible:true}));return {partition:n<4?'fit':'held',direction:d,centre:[0,0,1],half:4,res:64,scene:Array.from(scene),components,landmarks,maskSha256:createHash('sha256').update(scene).digest('hex')};})};}
