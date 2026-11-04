import {it,expect} from 'vitest';
import {Vector3} from 'three';
import {makeView,project} from '../src/universal-spatial/reconstruction/silhouette';
import {triangulateLandmark,type LandmarkObservation} from '../src/universal-spatial/visual-reconstruction/landmarks';
const sha='a'.repeat(64), point=new Vector3(.3,-.5,1.2);
function obs():LandmarkObservation[]{return [new Vector3(1,0,0),new Vector3(0,1,0),new Vector3(0,0,1)].map(d=>{const view=makeView(d,new Vector3(),4,64);return {view,pixel:project(view,point),visible:true,calibrated:true,uncertaintyPx:1,sourceSha256:sha};});}
it('triangulates a point from orthographic observations without inventing an axis',()=>{const out=triangulateLandmark(obs(),sha);expect(out.status).toBe('hypothesis');if(out.status==='hypothesis'){expect(new Vector3(...out.point).distanceTo(point)).toBeLessThan(1e-9);expect(out.axis).toBeNull();expect(out.requiresHumanReview).toBe(true);}});
it('refuses occlusion, contradictory landmarks and wrong source',()=>{const a=obs();a[0]!.visible=false;a[1]!.visible=false;expect(triangulateLandmark(a,sha)).toMatchObject({status:'refused',reason:'INSUFFICIENT_VISIBLE_VIEWS'});const b=obs();b[0]!.pixel[0]+=12;expect(triangulateLandmark(b,sha)).toMatchObject({status:'refused',reason:'CONTRADICTORY_LANDMARKS'});expect(triangulateLandmark(obs(),'b'.repeat(64))).toMatchObject({status:'refused',reason:'INVALID_EVIDENCE'});});
