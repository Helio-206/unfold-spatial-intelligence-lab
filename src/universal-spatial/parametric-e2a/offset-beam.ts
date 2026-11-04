import { BufferGeometry, Float32BufferAttribute } from 'three';

export type OffsetSection = { z: number; width: number; height: number; offsetX: number; offsetY: number };
/** Isolated mesh prototype; offsets are linear between sections and no V2 operator is introduced. */
export function createOffsetBeam(sections: OffsetSection[]): BufferGeometry {
  if (!Array.isArray(sections) || sections.length < 2 || sections.length > 32 || sections.some((s, i) => !s || ![s.z,s.width,s.height,s.offsetX,s.offsetY].every(n => Number.isFinite(n) && Math.abs(n) <= 500) || s.width <= 0 || s.height <= 0 || (i > 0 && s.z <= sections[i-1]!.z))) throw new Error('INVALID_OFFSET_SECTIONS');
  const positions:number[]=[], indices:number[]=[];
  for(const s of sections) for(const [x,y] of [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]]) positions.push(s.offsetX+x!*s.width,s.offsetY+y!*s.height,s.z);
  for(let i=0;i<sections.length-1;i++) for(let k=0;k<4;k++){const a=4*i+k,b=4*i+(k+1)%4,c=b+4,d=a+4;indices.push(a,b,c,a,c,d);}
  indices.push(2,1,0,3,2,0);
  const last=(sections.length-1)*4; indices.push(last,last+1,last+2,last,last+2,last+3);
  const g=new BufferGeometry(); g.setAttribute('position',new Float32BufferAttribute(positions,3)); g.setIndex(indices); g.computeVertexNormals(); g.computeBoundingBox(); return g;
}
