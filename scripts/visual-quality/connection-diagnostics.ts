/** Coarse world-AABB proximity only; neither engineering validation nor proof of physical connections. */
import {Box3, Group, Vector3} from 'three';
import {miniExcavator} from '../../src/living/universal-foundry/fixtures/plans';
import {compileFoundry} from '../../src/living/universal-foundry/foundry';
import {disposeCompiledSpatialPlan} from '../../src/universal-spatial/geometry-compiler-v2';
const plan=miniExcavator(); const compiled=compileFoundry(plan);compiled.buildAll();compiled.root.updateMatrixWorld(true);const boxes=new Map<string,Box3>();compiled.root.traverse(o=>{if(o.userData.spatialComponentRoot)boxes.set(o.userData.spatialEntityId,new Box3().setFromObject(o,true))});
function distance(a:Box3,b:Box3){const va=new Vector3();for(const key of ['x','y','z'] as const)va[key]=Math.max(0,a.min[key]-b.max[key],b.min[key]-a.max[key]);return va.length()}
const pairs=[['house','boom'],['boom','stick'],['stick','bucket'],['cyl-boom','boom'],['cyl-boom','house']];
const result=pairs.map(([a,b])=>({a,b,aabbSeparation:distance(boxes.get(a!)!,boxes.get(b!)!)}));console.log(JSON.stringify({fixture:'miniExcavator: hand-authored inferred proportions; units are not validated',method:'world-axis-aligned bounding boxes; overlap does not demonstrate contact or joint alignment',pairs:result},null,2));compiled.retire();disposeCompiledSpatialPlan(compiled.root);
