import { BufferGeometry, Float32BufferAttribute, Vector3 } from 'three';
/** Isolated rectangular open-mouth basin. The solid is closed; the cavity is open at the top. */
export function makeBasin(width:number,height:number,depth:number,wall:number):BufferGeometry {
 if(![width,height,depth,wall].every(n=>Number.isFinite(n)&&n>0&&n<=100) || wall*2>=Math.min(width,depth) || wall>=height) throw Error('INVALID_BASIN');
 const rings = [
  [[-width/2,0,-depth/2],[width/2,0,-depth/2],[width/2,0,depth/2],[-width/2,0,depth/2]],
  [[-width/2,height,-depth/2],[width/2,height,-depth/2],[width/2,height,depth/2],[-width/2,height,depth/2]],
  [[-width/2+wall,wall,-depth/2+wall],[width/2-wall,wall,-depth/2+wall],[width/2-wall,wall,depth/2-wall],[-width/2+wall,wall,depth/2-wall]],
  [[-width/2+wall,height,-depth/2+wall],[width/2-wall,height,-depth/2+wall],[width/2-wall,height,depth/2-wall],[-width/2+wall,height,depth/2-wall]],
 ];
 const points=rings.flat(2), indices:number[]=[];
 const quad=(a:number,b:number,c:number,d:number)=>indices.push(a,b,c,a,c,d);
 quad(0,1,2,3); // underside, outward -Y
 quad(10,9,8,11); // cavity floor, outward +Y
 for(let i=0;i<4;i++){const j=(i+1)%4;quad(j,i,i+4,j+4);quad(i+8,j+8,j+12,i+12);quad(i+4,i+12,j+12,j+4);}
 const g=new BufferGeometry();g.setAttribute('position',new Float32BufferAttribute(points,3));g.setIndex(indices);g.computeVertexNormals();g.computeBoundingBox();return g;
}
export function inspectTopology(g:BufferGeometry) {
 const pos=g.getAttribute('position'),idx=g.getIndex();if(!pos||!idx||idx.count%3)throw Error('INVALID_MESH');
 const edges=new Map<string,{count:number;orientation:number}>(); let degenerate=0,volume=0;
 const vertex=(i:number)=>new Vector3().fromBufferAttribute(pos,i);
 for(let i=0;i<idx.count;i+=3){const a=idx.getX(i),b=idx.getX(i+1),c=idx.getX(i+2), va=vertex(a),vb=vertex(b),vc=vertex(c);if(new Vector3().subVectors(vb,va).cross(new Vector3().subVectors(vc,va)).length()<1e-10) degenerate++;volume+=va.dot(vb.clone().cross(vc))/6;
 for(const [u,v] of [[a,b],[b,c],[c,a]]){const key=u!<v!?`${u}:${v}`:`${v}:${u}`,e=edges.get(key)??{count:0,orientation:0};e.count++;e.orientation+=u!<v!?1:-1;edges.set(key,e);}}
 const normal=g.getAttribute('normal');return {vertices:pos.count,triangles:idx.count/3,boundaryEdges:[...edges.values()].filter(e=>e.count===1).length,nonManifoldEdges:[...edges.values()].filter(e=>e.count!==2).length,inconsistentEdges:[...edges.values()].filter(e=>e.orientation!==0).length,degenerate,finite:Array.from(pos.array).every(Number.isFinite)&&Array.from(normal.array).every(Number.isFinite),signedVolume:volume};
}
