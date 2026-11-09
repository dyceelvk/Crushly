// Experimental Didit *session* webhook: not deployed. This verifies Didit's
// V2 session signature (not the distinct alert-webhook scheme). Never award a
// badge or log/persist provider identity data in this handler.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyDiditWebhook } from '../../functions/_shared/didit.ts';
function reply(status:number) { return new Response(status===200?'ok':'unavailable',{status,headers:{'cache-control':'no-store'}}); }
const limit=2*1024*1024;
async function readBody(req:Request):Promise<string|null> {
 const size=Number(req.headers.get('content-length')??0);
 if(!Number.isFinite(size)||size<0||size>limit||!req.body) return null;
 const reader=req.body.getReader(); const parts:Uint8Array[]=[]; let total=0;
 while(true) {
  const {done,value}=await reader.read(); if(done) break;
  total+=value.length; if(total>limit){await reader.cancel();return null;} parts.push(value);
 }
 const bytes=new Uint8Array(total); let offset=0;
 for(const part of parts){bytes.set(part,offset);offset+=part.length;}
 try { return new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { return null; }
}
Deno.serve(async req=>{
 if(req.method!=='POST') return reply(405);
 const secret=Deno.env.get('DIDIT_MANUAL_WEBHOOK_SECRET')??'';
 const url=Deno.env.get('SUPABASE_URL')??'', key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
 const expectedWorkflow=Deno.env.get('DIDIT_MANUAL_VERIFICATION_WORKFLOW_ID')||Deno.env.get('DIDIT_WORKFLOW_ID')||'';
 if(!secret||!url||!key||!expectedWorkflow) return reply(503);
 let raw:string|null; try { raw=await readBody(req); } catch { return reply(400); }
 if(raw===null) return reply(413);
 if(!await verifyDiditWebhook(raw,req.headers.get('x-signature-v2'),req.headers.get('x-timestamp'),secret)) return reply(401);
 let p:Record<string,unknown>; try {p=JSON.parse(raw);} catch{return reply(400);}
 if(!p||typeof p!=='object'||Array.isArray(p)) return reply(400);
 // X-Timestamp is outside the V2 signature. Require the signed delivery time
 // itself to be fresh, too, so an old payload cannot be replayed by replacing
 // only the unsigned header. A stale delivery may be reconciled by polling.
 const now=Math.floor(Date.now()/1000);
 if(typeof p.timestamp!=='number'||!Number.isSafeInteger(p.timestamp)||Math.abs(now-p.timestamp)>300) return reply(401);
 // Ignore unrelated destination events without making them retry.
 if(p.webhook_type!=='status.updated'||p.environment!=='live'||p.workflow_id!==expectedWorkflow) return reply(200);
 if(!['Not Started','In Progress','In Review','Approved','Declined','Expired','Abandoned'].includes(String(p.status))) return reply(200);
 if(typeof p.event_id!=='string'||p.event_id.length<1||p.event_id.length>200||typeof p.session_id!=='string'||!/^[0-9a-f-]{36}$/i.test(p.session_id)||typeof p.vendor_data!=='string') return reply(400);
 if(typeof p.created_at!=='number'||!Number.isSafeInteger(p.created_at)||p.created_at<0) return reply(400);
 const match=/^holup-case:([1-9][0-9]{0,14})$/.exec(p.vendor_data); if(!match) return reply(400);
 const caseId=Number(match[1]); if(!Number.isSafeInteger(caseId)) return reply(400);
 const decision=(p.decision && typeof p.decision==='object' ? p.decision : {}) as Record<string,unknown>;
 const approved=(key:string)=>Array.isArray(decision[key])&&(decision[key] as Array<{status?:unknown}>).some(x=>x&&x.status==='Approved');
 const state=p.status==='Approved'&&decision.session_id===p.session_id&&approved('id_verifications')&&approved('liveness_checks')&&approved('face_matches')?'approved'
  :p.status==='Declined'?'declined':p.status==='Expired'||p.status==='Abandoned'?'expired'
  :p.status==='In Review'||p.status==='Approved'?'review':'created';
 const service=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {error}=await service.rpc('manual_capture_apply_event',{p_case:caseId,p_session:p.session_id,p_workflow:p.workflow_id,p_state:state,p_event:p.event_id,p_observed_at:p.created_at*1000});
 // A callback arriving before the create-session record commits is retryable.
 return reply(error?503:200);
});
