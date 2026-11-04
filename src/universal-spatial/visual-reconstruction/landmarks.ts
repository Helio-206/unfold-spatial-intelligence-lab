import { Matrix3, Vector3 } from 'three';
import { project, type View } from '../reconstruction/silhouette';
export type LandmarkObservation={view:View;pixel:[number,number];uncertaintyPx:number;visible:boolean;calibrated:boolean;sourceSha256:string};
export type LandmarkResult={status:'hypothesis';point:[number,number,number];axis:null;maxErrorPx:number;requiresHumanReview:true} | {status:'refused';reason:string};
/** Least-squares intersection of calibrated orthographic rays; axes are never inferred from a point. */
export function triangulateLandmark(observations:LandmarkObservation[],sourceSha256:string):LandmarkResult {
 const refuse=(reason:string):LandmarkResult=>({status:'refused',reason});
 if(!/^[a-f0-9]{64}$/.test(sourceSha256)||observations.length>8)return refuse('INVALID_EVIDENCE');
 const visible=observations.filter(o=>o.visible);if(visible.length<2)return refuse('INSUFFICIENT_VISIBLE_VIEWS');
 for(const o of visible){const v=o.view;if(!o.calibrated||o.sourceSha256!==sourceSha256||!Number.isInteger(v.res)||v.res<16||v.res>128||!Number.isFinite(v.half)||v.half<=0||!o.pixel.every(Number.isFinite)||o.pixel.some(p=>p<0||p>=v.res)||!Number.isFinite(o.uncertaintyPx)||o.uncertaintyPx<=0||o.uncertaintyPx>v.res||[v.direction,v.right,v.up,v.centre].some(x=>!x.toArray().every(Number.isFinite))||[v.direction,v.right,v.up].some(x=>Math.abs(x.length()-1)>1e-5)||Math.abs(v.direction.dot(v.right))>1e-5||Math.abs(v.direction.dot(v.up))>1e-5||Math.abs(v.right.dot(v.up))>1e-5)return refuse('INVALID_EVIDENCE');}
 if(!visible.some((a,i)=>visible.some((b,j)=>j>i&&a.view.direction.clone().cross(b.view.direction).length()>.15)))return refuse('DEGENERATE_VIEWS');
 let xx=0,xy=0,xz=0,yy=0,yz=0,zz=0;const rhs=new Vector3();
 for(const o of visible){const v=o.view,d=v.direction,p=v.centre.clone().addScaledVector(v.right,(o.pixel[0]/v.res*2-1)*v.half).addScaledVector(v.up,(o.pixel[1]/v.res*2-1)*v.half);xx+=1-d.x*d.x;xy-=d.x*d.y;xz-=d.x*d.z;yy+=1-d.y*d.y;yz-=d.y*d.z;zz+=1-d.z*d.z;rhs.add(p.clone().addScaledVector(d,-p.dot(d)));}
 const m=new Matrix3().set(xx,xy,xz,xy,yy,yz,xz,yz,zz);if(Math.abs(m.determinant())<1e-5)return refuse('DEGENERATE_VIEWS');const point=rhs.applyMatrix3(m.invert());if(!point.toArray().every(Number.isFinite))return refuse('DEGENERATE_VIEWS');let max=0;
 for(const o of visible){const uv=project(o.view,point),err=Math.hypot(uv[0]-o.pixel[0],uv[1]-o.pixel[1]);max=Math.max(max,err);if(err>o.uncertaintyPx*3)return refuse('CONTRADICTORY_LANDMARKS');}
 return {status:'hypothesis',point:point.toArray(),axis:null,maxErrorPx:max,requiresHumanReview:true};
}
