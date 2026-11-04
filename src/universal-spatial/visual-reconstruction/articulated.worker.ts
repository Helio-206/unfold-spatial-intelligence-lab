import { fitArticulated } from './articulated';
import { decodeViews, type FitRequest } from './worker-protocol';
let active:ReturnType<typeof fitArticulated>|null=null, activeId:number|null=null, timer:ReturnType<typeof setTimeout>|null=null;
self.onmessage=(event:MessageEvent<{type:'start';request:FitRequest}|{type:'cancel';id:number}>)=>{
 const msg=event.data;
 if(msg.type==='cancel'){if(activeId===msg.id){if(timer!==null)clearTimeout(timer);active?.return({status:'refused',reason:'CANCELLED',evaluations:0});active=null;activeId=null;self.postMessage({type:'cancelled',id:msg.id});}return;}
 if(active){self.postMessage({type:'error',id:msg.request.id,error:'WORKER_BUSY'});return;}
 try{activeId=msg.request.id;active=fitArticulated(msg.request.plan,decodeViews(msg.request.views),msg.request.priors,msg.request.options);const run=()=>{if(!active)return;try{const result=active.next();if(result.done){const id=activeId;active=null;activeId=null;self.postMessage({type:'result',id,result:result.value});}else{self.postMessage({type:'progress',id:activeId,evaluations:result.value});timer=setTimeout(run,0);}}catch(e){const id=activeId;active=null;activeId=null;self.postMessage({type:'error',id,error:e instanceof Error?e.message:'WORKER_ERROR'});}};run();}catch(e){active=null;activeId=null;self.postMessage({type:'error',id:msg.request.id,error:e instanceof Error?e.message:'WORKER_ERROR'});}
};
