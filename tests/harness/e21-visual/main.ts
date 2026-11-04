import { AmbientLight, BoxGeometry, DirectionalLight, Group, Mesh, MeshStandardMaterial, OrthographicCamera, Scene, Vector3, WebGLRenderer } from 'three';
import { validateSpatialPlanV2 } from '../../../src/universal-spatial/contracts-v2';
import { compileSpatialPlanV2, disposeCompiledSpatialPlan } from '../../../src/universal-spatial/geometry-compiler-v2';
import data from '../../../reports/fidelity-v4/e2-1/visual-data.json';
const renderer=new WebGLRenderer({antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(480,240);renderer.setClearColor(0x141a22);
for(const item of data)for(const angle of ['side','three-quarter'])for(const kind of ['reference','initial','fitted']){
 const scene=new Scene(),root=new Group();scene.add(new AmbientLight(0xffffff,1.3));const light=new DirectionalLight(0xffffff,1.6);light.position.set(3,6,4);scene.add(light);scene.add(root);let compiled:ReturnType<typeof compileSpatialPlanV2>|null=null;
 if(kind==='reference')for(const p of item.reference){const mesh=new Mesh(new BoxGeometry(...p.d as [number,number,number]),new MeshStandardMaterial({color:0xc6a959}));mesh.position.set(...p.p as [number,number,number]);mesh.rotation.x=p.rx;root.add(mesh);}
 else {compiled=compileSpatialPlanV2(validateSpatialPlanV2(kind==='initial'?item.baseline:item.candidate));root.add(compiled.root);}
 const camera=new OrthographicCamera(-3.4,3.4,1.7,-1.7,.01,100),center=new Vector3(0,0,.75);camera.position.copy(center).add(angle==='side'?new Vector3(1,0,0).multiplyScalar(10):new Vector3(1,.7,1).normalize().multiplyScalar(10));camera.lookAt(center);camera.updateProjectionMatrix();renderer.render(scene,camera);
 const div=document.createElement('div');div.className='cell';const label=document.createElement('p');label.textContent=`${item.name} / ${angle} / ${kind}`;const img=document.createElement('img');img.src=renderer.domElement.toDataURL();img.alt=label.textContent;div.append(label,img);document.getElementById('grid')!.append(div);
 if(compiled)disposeCompiledSpatialPlan(compiled.root);else root.traverse(o=>{if(o instanceof Mesh){o.geometry.dispose();(o.material as MeshStandardMaterial).dispose();}});
}
renderer.dispose();
