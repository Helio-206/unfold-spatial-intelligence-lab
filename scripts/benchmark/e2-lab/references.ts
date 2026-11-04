import { BoxGeometry, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { makeView, rasterise, type Tri } from '../../../src/universal-spatial/reconstruction/silhouette';
import { createHash } from 'node:crypto';

// Reference side only: deliberately independent of the candidate geometry and fitting modules.
export const referenceCases = [
 {name:'long',width:.75,parts:[{p:[0,0,0],r:0,d:[.75,.8,3]},{p:[0,0,3],r:0,d:[.55,.7,2]},{p:[0,0,5],r:0,d:[1.2,.8,1]}]},
 {name:'compact',width:1.05,parts:[{p:[0,0,0],r:0,d:[1.05,.8,3]},{p:[0,0,3],r:.35,d:[.55,.7,2]},{p:[0,0,5],r:0,d:[1.4,1,1]}]},
 {name:'articulated',width:.65,parts:[{p:[0,0,0],r:0,d:[.65,.8,3]},{p:[0,0,3],r:-.4,d:[.55,.7,2]},{p:[0,0,5],r:.2,d:[.8,1.1,1]}]},
] as const;
const directions = [[1,0,0],[0,1,0],[0,0,1],[1,.7,1],[-1,.4,1],[.5,1,-.7],[-.4,.8,-1],[1,-.6,-1]] as const;
export function renderReference(index:number) {
 const fixture=referenceCases[index]!;const triangles:Tri[]=[];
 for(const p of fixture.parts){const geom=new BoxGeometry(...p.d); const pos=geom.getAttribute('position'),idx=geom.index!;const matrix=new Matrix4().compose(new Vector3(...p.p),new Quaternion().setFromEuler(new Euler(p.r,0,0)),new Vector3(1,1,1));
 for(let i=0;i<idx.count;i+=3){const v=(n:number)=>new Vector3().fromBufferAttribute(pos,idx.getX(i+n)).applyMatrix4(matrix);triangles.push([v(0),v(1),v(2)]);}geom.dispose();}
 const views=directions.map((dir,i)=>{const v=makeView(new Vector3(...dir),new Vector3(0,0,2),5,80),mask=rasterise(triangles,v);return {partition:i<4?'fit':'held-out',direction:[...dir],centre:[0,0,2],half:5,resolution:80,projection:'orthographic',mask:Array.from(mask),sha256:createHash('sha256').update(mask).digest('hex')};});
 return {name:fixture.name,seed:0,source:'independent-three-boxgeometry-synthetic',views};
}
