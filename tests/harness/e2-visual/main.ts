import { AmbientLight, Box3, BoxGeometry, DirectionalLight, Group, Mesh, MeshStandardMaterial, OrthographicCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { validateSpatialPlanV2 } from '../../../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../../../src/universal-spatial/geometry-compiler-v2';
import metrics from '../../../reports/fidelity-v4/e2-visual/metrics.json';
const references=[
 [{p:[0,0,0],r:0,d:[.75,.8,3]},{p:[0,0,3],r:0,d:[.55,.7,2]},{p:[0,0,5],r:0,d:[1.2,.8,1]}],
 [{p:[0,0,0],r:0,d:[1.05,.8,3]},{p:[0,0,3],r:.35,d:[.55,.7,2]},{p:[0,0,5],r:0,d:[1.4,1,1]}],
 [{p:[0,0,0],r:0,d:[.65,.8,3]},{p:[0,0,3],r:-.4,d:[.55,.7,2]},{p:[0,0,5],r:.2,d:[.8,1.1,1]}],
];
const mat={profile:'industrial',color:'#d3a441',roughness:.5,metalness:.2,clearcoat:0},t=(p:number[])=>({position:p,rotationRad:[0,0,0],scale:[1,1,1]});
function candidate(width:number){return validateSpatialPlanV2({contract:'unfold.spatial-plan.v2',source:{kind:'text',sha256:'b'.repeat(64)},title:'conceptual',units:'unitless',presentationProfile:'industrial',unknowns:[],constraints:[],relations:[],components:[{id:'boom',p:[0,0,0],d:[width,.8,3]},{id:'stick',p:[0,0,3],d:[.55,.7,2]},{id:'bucket',p:[0,0,5],d:[1.2,.8,1]}].map(c=>({id:c.id,label:c.id,parentId:null,geometry:{type:'shape',key:`${c.id}-body`,operator:'box',parameters:{dimensions:c.d},transform:t([0,0,0]),repeat:null,material:mat},transform:t(c.p),provenance:{geometry:'inferred',transform:'inferred',material:'inferred',evidence:'synthetic'}}))});}
const renderer=new WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(480,240);renderer.setClearColor(0x141a22);
for(let i=0;i<3;i++)for(const angle of ['side','three-quarter'])for(const kind of ['reference','initial','fitted']){
 const scene=new Scene(), root=new Group();scene.add(new AmbientLight(0xffffff,1.3));const light=new DirectionalLight(0xffffff,1.6);light.position.set(3,6,4);scene.add(light);scene.add(root);
 let compiled:ReturnType<typeof compileSpatialPlanV2>|null=null;
 if(kind==='reference') for(const p of references[i]!){const mesh=new Mesh(new BoxGeometry(...p.d as [number,number,number]),new MeshStandardMaterial({color:0xc6a959}));mesh.position.set(...p.p as [number,number,number]);mesh.rotation.x=p.r;root.add(mesh);}
 else {compiled=compileSpatialPlanV2(candidate(kind==='initial'?.5:metrics.results[i]!.selectedWidth.recovered));root.add(compiled.root);}
 const camera=new OrthographicCamera(-5,5,2.5,-2.5,.01,100);const center=new Vector3(0,0,2);camera.position.copy(center).add(angle==='side'?new Vector3(1,0,0).multiplyScalar(10):new Vector3(1,.7,1).normalize().multiplyScalar(10));camera.lookAt(center);camera.updateProjectionMatrix();renderer.render(scene,camera);
 const div=document.createElement('div');div.className='cell';const label=document.createElement('p');label.textContent=`${metrics.results[i]!.name} / ${angle} / ${kind}`;const img=document.createElement('img');img.src=renderer.domElement.toDataURL();img.alt=label.textContent;div.append(label,img);document.getElementById('grid')!.append(div);
 if(compiled) disposeCompiledSpatialPlan(compiled.root); else root.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();(o.material as MeshStandardMaterial).dispose();}});void Box3;
}
renderer.dispose();
