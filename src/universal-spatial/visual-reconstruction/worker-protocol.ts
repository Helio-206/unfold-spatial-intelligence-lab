import { Vector3 } from 'three';
import type { SpatialPlanV2 } from '../contracts-v2';
import type { FitOptions, JointPrior } from './articulated';
import type { FitView } from './fit';
export type RawView={direction:[number,number,number];right:[number,number,number];up:[number,number,number];centre:[number,number,number];half:number;res:number;mask:Uint8Array;calibrated:boolean};
export type FitRequest={id:number;plan:SpatialPlanV2;views:RawView[];priors:JointPrior[];options:FitOptions};
export function encodeViews(v:FitView[]):RawView[]{return v.map(x=>({direction:x.view.direction.toArray(),right:x.view.right.toArray(),up:x.view.up.toArray(),centre:x.view.centre.toArray(),half:x.view.half,res:x.view.res,mask:x.mask,calibrated:x.calibrated}));}
export function decodeViews(v:RawView[]):FitView[]{return v.map(x=>({calibrated:x.calibrated,mask:x.mask,view:{direction:new Vector3(...x.direction),right:new Vector3(...x.right),up:new Vector3(...x.up),centre:new Vector3(...x.centre),half:x.half,res:x.res}}));}
