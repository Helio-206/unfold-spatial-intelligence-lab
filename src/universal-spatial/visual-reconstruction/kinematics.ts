import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

export type Vec3 = [number,number,number];
export type JointEvidence = {kind:'synthetic_fixture'|'source_hypothesis'|'calibrated_image'|'unknown'; evidenceRef:string};
export type KinematicBody = {id:string; dimensions:Vec3};
/** Anchor coordinates are fractions of the box dimensions, in each body's local frame. */
export type HingeFrame = {id:string;parent:string;child:string;parentAnchor:Vec3;childAnchor:Vec3;parentAxis:Vec3;childAxis:Vec3;angle:number;limits:[number,number];evidence:JointEvidence};
export type RigidPose = {position:Vec3;rotationRad:Vec3};
export type KinematicTree = {bodies:KinematicBody[];root:string;rootPose:RigidPose;joints:HingeFrame[]};
export type KinematicResult = { local:Map<string,RigidPose>; world:Map<string,Matrix4>; joints:Array<{id:string;parentPoint:Vec3;childPoint:Vec3;axis:Vec3;gap:number;axisDot:number}> };
const id=/^[a-z][a-z0-9-]{0,47}$/;
const vector=(x:unknown):x is Vec3=>Array.isArray(x)&&x.length===3&&x.every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1000);
const axis=(x:Vec3)=>vector(x)&&Math.abs(new Vector3(...x).length()-1)<1e-7;
const anchor=(x:Vec3)=>vector(x)&&x.every(n=>Math.abs(n)<=.5+1e-8)&&x.some(n=>Math.abs(Math.abs(n)-.5)<1e-8);
const at=(fraction:Vec3,dims:Vec3)=>new Vector3(fraction[0]*dims[0],fraction[1]*dims[1],fraction[2]*dims[2]);
/** Forward kinematics: T_child = Translate(anchor_parent) R_axis(angle) Align(axis_child,axis_parent) Translate(-anchor_child). */
export function forwardKinematics(tree:KinematicTree):KinematicResult {
 if(!tree||!Array.isArray(tree.bodies)||tree.bodies.length<2||tree.bodies.length>16||!Array.isArray(tree.joints)||tree.joints.length!==tree.bodies.length-1)throw Error('INVALID_TREE');
 const bodies=new Map<string,KinematicBody>();for(const body of tree.bodies){if(!id.test(body.id)||bodies.has(body.id)||!vector(body.dimensions)||body.dimensions.some(n=>n<=0))throw Error('INVALID_BODY');bodies.set(body.id,body);}
 if(!bodies.has(tree.root)||!tree.rootPose||!vector(tree.rootPose.position)||!vector(tree.rootPose.rotationRad))throw Error('INVALID_ROOT');
 const byChild=new Map<string,HingeFrame>(),jointIds=new Set<string>();
 for(const j of tree.joints){if(!id.test(j.id)||jointIds.has(j.id)||!bodies.has(j.parent)||!bodies.has(j.child)||j.parent===j.child||j.child===tree.root||byChild.has(j.child)||!anchor(j.parentAnchor)||!anchor(j.childAnchor)||!axis(j.parentAxis)||!axis(j.childAxis)||!Array.isArray(j.limits)||j.limits.length!==2||!j.limits.every(Number.isFinite)||j.limits[0]<-Math.PI||j.limits[1]>Math.PI||j.limits[0]>j.limits[1]||!Number.isFinite(j.angle)||j.angle<j.limits[0]||j.angle>j.limits[1]||!j.evidence||!['synthetic_fixture','source_hypothesis','calibrated_image','unknown'].includes(j.evidence.kind)||typeof j.evidence.evidenceRef!=='string'||j.evidence.evidenceRef.length>500)throw Error('INVALID_HINGE');jointIds.add(j.id);byChild.set(j.child,j);}
 for(const b of tree.bodies)if(b.id!==tree.root&&!byChild.has(b.id))throw Error('DISCONNECTED_TREE');
 const world=new Map<string,Matrix4>(),local=new Map<string,RigidPose>(),visiting=new Set<string>();
 const rootQ=new Quaternion().setFromEuler(new Euler(...tree.rootPose.rotationRad));world.set(tree.root,new Matrix4().compose(new Vector3(...tree.rootPose.position),rootQ,new Vector3(1,1,1)));local.set(tree.root,{position:[...tree.rootPose.position],rotationRad:[...tree.rootPose.rotationRad]});
 const resolve=(bodyId:string):Matrix4=>{const known=world.get(bodyId);if(known)return known;if(visiting.has(bodyId))throw Error('CYCLIC_TREE');const j=byChild.get(bodyId);if(!j)throw Error('DISCONNECTED_TREE');visiting.add(bodyId);const parentWorld=resolve(j.parent),pa=at(j.parentAnchor,bodies.get(j.parent)!.dimensions),ca=at(j.childAnchor,bodies.get(j.child)!.dimensions),ap=new Vector3(...j.parentAxis),ac=new Vector3(...j.childAxis),q=new Quaternion().setFromAxisAngle(ap,j.angle).multiply(new Quaternion().setFromUnitVectors(ac,ap)),position=pa.clone().sub(ca.clone().applyQuaternion(q)),e=new Euler().setFromQuaternion(q,'XYZ');const matrix=new Matrix4().compose(position,q,new Vector3(1,1,1)),w=parentWorld.clone().multiply(matrix);local.set(bodyId,{position:position.toArray(),rotationRad:[e.x,e.y,e.z]});world.set(bodyId,w);visiting.delete(bodyId);return w;};
 for(const b of tree.bodies)resolve(b.id);
 const diagnostics=tree.joints.map(j=>{const p=at(j.parentAnchor,bodies.get(j.parent)!.dimensions).applyMatrix4(world.get(j.parent)!),c=at(j.childAnchor,bodies.get(j.child)!.dimensions).applyMatrix4(world.get(j.child)!),a=new Vector3(...j.parentAxis).transformDirection(world.get(j.parent)!),b=new Vector3(...j.childAxis).transformDirection(world.get(j.child)!);return {id:j.id,parentPoint:p.toArray() as Vec3,childPoint:c.toArray() as Vec3,axis:a.toArray() as Vec3,gap:p.distanceTo(c),axisDot:a.dot(b)};});
 return {local,world,joints:diagnostics};
}
