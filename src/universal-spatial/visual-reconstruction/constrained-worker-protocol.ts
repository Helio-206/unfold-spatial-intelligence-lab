import { Vector3 } from 'three';
import type { SpatialPlanV2 } from '../contracts-v2';
import type { KinematicTree } from './kinematics';
import type { ConstrainedView,ConstrainedFitOptions } from './constrained-fit';
import type { RawView } from './worker-protocol';
export type RawConstrainedView=RawView & {scene:Uint8Array;components:ConstrainedView['components'];landmarks:ConstrainedView['landmarks'];sourceSha256:string};
export type ConstrainedRequest={id:number;plan:SpatialPlanV2;tree:KinematicTree;views:RawConstrainedView[];options:ConstrainedFitOptions};
export function encodeConstrainedViews(views:ConstrainedView[]):RawConstrainedView[]{return views.map(v=>({direction:v.view.direction.toArray(),right:v.view.right.toArray(),up:v.view.up.toArray(),centre:v.view.centre.toArray(),half:v.view.half,res:v.view.res,mask:v.scene,scene:v.scene,calibrated:v.calibrated,components:v.components,landmarks:v.landmarks,sourceSha256:v.sourceSha256}));}
export function decodeConstrainedViews(views:RawConstrainedView[]):ConstrainedView[]{return views.map(v=>({view:{direction:new Vector3(...v.direction),right:new Vector3(...v.right),up:new Vector3(...v.up),centre:new Vector3(...v.centre),half:v.half,res:v.res},scene:v.scene,calibrated:v.calibrated,components:v.components,landmarks:v.landmarks,sourceSha256:v.sourceSha256}));}
