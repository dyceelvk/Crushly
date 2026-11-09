// Experimental Didit *session* webhook: not deployed. This verifies Didit's
// V2 session signature (not the distinct alert-webhook scheme). Never award a
// badge or log/persist provider identity data in this handler.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { verifyDiditWebhook } from '../../functions/_shared/didit.ts';
function reply(status:number) { return new Response(status===200?'ok':'unavailable',{status,headers:{'cache-control':'no-store'}}); }
Deno.serve(async req=>{
 if(req.method!=='POST') return reply(405);
 const secret=Deno.env.get('DIDIT_MANUAL_WEBHOOK_SECRET')??'';
 const url=Deno.env.get('SUPABASE_URL')??'', key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
 const expectedWorkflow=Deno.env.get('DIDIT_MANUAL_VERIFICATION_WORKFLOW_ID')??'';
 if(!secret||!url||!key||!expectedWorkflow) return reply(503);
 if(Number(req.headers.get('content-length')??0)>2*1024*1024) return reply(413);
 const raw=await req.text(); if(raw.length>2*1024*1024) return reply(413);
 if(!await verifyDiditWebhook(raw,req.headers.get('x-signature-v2'),req.headers.get('x-timestamp'),secret)) return reply(401);
 let p:Record<string,unknown>; try {p=JSON.parse(raw);} catch{return reply(400);}
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
