import { describe, expect, it } from 'vitest';
import { DoubleSide, Raycaster, Vector3, type Object3D, type Mesh } from 'three';
import { compileFoundry } from '../src/living/universal-foundry/foundry';
import { wrench, miniExcavator } from '../src/living/universal-foundry/fixtures/plans';
import { disposeCompiledSpatialPlan } from '../src/universal-spatial/geometry-compiler-v2';
const build=(plan:ReturnType<typeof wrench>)=>{const c=compileFoundry(plan);c.buildAll();c.root.updateMatrixWorld(true);return c};
const component=(root:Object3D,id:string)=>{let found:Object3D|undefined;root.traverse(o=>{if(o.userData.spatialComponentRoot&&o.userData.spatialEntityId===id)found=o});if(!found)throw Error('component missing');return found};
const ray=(target:Object3D,x:number,y:number)=>new Raycaster(new Vector3(x,y,1),new Vector3(0,0,-1)).intersectObject(target,true).length;
describe('visual geometry corrections',()=>{
 it('makes the spanner mouth open toward its tip, with material on both jaws',()=>{const c=build(wrench()),head=component(c.root,'head');head.traverse(o=>{const m=o as Mesh;if(m.isMesh)for(const mat of Array.isArray(m.material)?m.material:[m.material])mat.side=DoubleSide});expect(ray(head,.135,0)).toBe(0);expect(ray(head,.135,.02)).toBeGreaterThan(0);expect(ray(head,.135,-.02)).toBeGreaterThan(0);c.retire();disposeCompiledSpatialPlan(c.root)});
 it('retains a distinct closed ring head for a ring spanner',()=>{const p=wrench();p.title='Ring spanner';const c=build(p),head=component(c.root,'head');head.traverse(o=>{const m=o as Mesh;if(m.isMesh)for(const mat of Array.isArray(m.material)?m.material:[m.material])mat.side=DoubleSide});expect(c.recipe?.archetype).toBe('ring-wrench');expect(ray(head,.14,0)).toBeGreaterThan(0);c.retire();disposeCompiledSpatialPlan(c.root)});
 it('keeps component identities and marks the inferred hydraulic bridges',()=>{const p=miniExcavator(),before=JSON.stringify(p),c=build(p);expect(JSON.stringify(p)).toBe(before);for(const part of p.components)expect(component(c.root,part.id)).toBeDefined();expect(c.recipe?.parts.find(x=>x.componentId==='cyl-boom')?.details.join(' ')).toContain('not verified');c.retire();disposeCompiledSpatialPlan(c.root)});
});
