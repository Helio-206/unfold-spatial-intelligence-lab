import { AmbientLight, Box3, DirectionalLight, Mesh, MeshBasicMaterial, OrthographicCamera, Scene, SphereGeometry, Vector3, WebGLRenderer } from 'three';
import { validateSpatialPlanV2, type SpatialPlanV2, type MaterialV2 } from '../../../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2 } from '../../../src/universal-spatial/geometry-compiler-v2';
import { createAssembly, solveHingeTree, type Assembly, type AssemblyDimensions } from '../../../src/universal-spatial/parametric-e2a/assembly';
import saved from '../../../reports/universal-spatial-v2/evidence/live-image-plan.json';
const material: MaterialV2 = {profile:'industrial',color:'#d9a02e',roughness:.55,metalness:.2,clearcoat:0};
const d: AssemblyDimensions={boomLength:4,stickLength:2.7,beamWidth:.45,beamHeight:.65,bucketWidth:1.5,bucketHeight:1,bucketDepth:1.2,plate:.1};
const truth=createAssembly(d,material,[.65,-1.2,.55]), disturbed=structuredClone(truth);
disturbed.bodies[1]!.position[1]+=.6; disturbed.bodies[2]!.position[2]-=.5;
const fixed={...disturbed,bodies:solveHingeTree(disturbed.bodies,disturbed.joints,1).bodies};
function plan(a: Assembly): SpatialPlanV2 {
  return validateSpatialPlanV2({contract:'unfold.spatial-plan.v2',source:{kind:'text',sha256:'a'.repeat(64)},title:'synthetic',units:'unitless',presentationProfile:'industrial',unknowns:['physical scale'],constraints:[],relations:[],components:a.bodies.map(b=>({id:b.id,label:b.id,parentId:b.parentId,geometry:a.geometry[b.id],transform:{position:b.position,rotationRad:b.rotationRad,scale:[1,1,1]},provenance:{geometry:'inferred',transform:'inferred',material:'inferred',evidence:'synthetic fixture'}}))});
}
function draw(title:string, p:SpatialPlanV2, threeQuarter:boolean, jointMarkers:boolean) {
 const div=document.createElement('div');div.className='cell';const label=document.createElement('p');label.textContent=title;div.append(label);document.getElementById('row')!.append(div);
 const renderer=new WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(600,420);renderer.setClearColor(0x151b23);div.append(renderer.domElement);
 const scene=new Scene();scene.add(new AmbientLight(0xffffff,1.4));const light=new DirectionalLight(0xffffff,2);light.position.set(5,8,7);scene.add(light);
 const compiled=compileSpatialPlanV2(p);scene.add(compiled.root);compiled.root.updateMatrixWorld(true);
 if(jointMarkers) compiled.root.traverse(o=>{ if(o.userData.spatialComponentRoot && ['stick','bucket'].includes(o.userData.spatialEntityId)){const marker=new Mesh(new SphereGeometry(.12,12,8),new MeshBasicMaterial({color:0xff2c4b,depthTest:false}));marker.position.copy(o.localToWorld(o.userData.spatialEntityId === 'bucket' ? new Vector3(0,d.bucketHeight,d.plate*1.5) : new Vector3()));scene.add(marker);} });
 const box=new Box3().setFromObject(compiled.root),center=box.getCenter(new Vector3()),span=Math.max(box.getSize(new Vector3()).length(),1),aspect=600/420;
 const camera=new OrthographicCamera(-span*.6*aspect,span*.6*aspect,span*.6,-span*.6,.01,1000);camera.position.copy(center).add(threeQuarter?new Vector3(1,.7,1).normalize().multiplyScalar(span*2):new Vector3(1,0,0).multiplyScalar(span*2));camera.lookAt(center);camera.updateProjectionMatrix();renderer.render(scene,camera);
}
draw('Saved Meta plan — no photo ground truth',validateSpatialPlanV2(saved.plan),true,false);
draw('Synthetic reference — side',plan(truth),false,true);draw('Perturbed chain — side',plan(disturbed),false,true);
draw('Solved chain — side',plan(fixed),false,true);draw('Synthetic reference — three-quarter',plan(truth),true,true);draw('Solved chain — three-quarter',plan(fixed),true,true);
