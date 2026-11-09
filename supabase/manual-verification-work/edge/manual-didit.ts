// Experimental edge function. NOT deployed. The app supplies a JWT; never
// accept a user ID, status, evidence, callback URL, or workflow from the client.
// Actor identity is verified through Supabase Auth before service-role access.
// Configure a separate Didit workflow that requires ID, liveness and face
// match; callbacks are not used as proof. Results are fetched from Didit.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { DIDIT_BASE } from '../../functions/_shared/didit.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store' };
function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } }); }

Deno.serve(async req => {
 if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
 if (req.method !== 'POST') return json({ error: 'Method not allowed.' },405);
 const authHeader = req.headers.get('authorization') ?? '';
 const origin = Deno.env.get('SUPABASE_URL') ?? '';
 const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
 const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
 const apiKey = Deno.env.get('DIDIT_API_KEY') ?? '';
 const workflow = Deno.env.get('DIDIT_MANUAL_VERIFICATION_WORKFLOW_ID') ?? '';
 const appUrl = Deno.env.get('APP_URL') ?? '';
 if (!origin || !anon || !serviceKey || !apiKey || !workflow || !/^https:\/\/[a-z0-9.-]+$/i.test(appUrl)) return json({ error: 'Secure capture is not configured.' },503);
 const userClient = createClient(origin,anon,{ global:{headers:{Authorization:authHeader}} });
 const {data: who,error: authError}=await userClient.auth.getUser();
 if (authError || !who.user) return json({error:'Sign in required.'},401);
 let body: { action?: unknown; caseId?: unknown };
 try { body=await req.json(); } catch { return json({error:'Invalid request.'},400); }
 const caseId=body?.caseId;
 if (!Number.isSafeInteger(caseId) || Number(caseId)<=0 || !['start','refresh'].includes(String(body.action))) return json({error:'Invalid request.'},400);
 const admin=createClient(origin,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
 if (body.action==='start') {
  const {data:claim,error:claimError}=await admin.rpc('manual_capture_claim',{p_case:caseId,p_actor:who.user.id});
  if (claimError || !claim) return json({error:'Capture is unavailable or still being prepared. Please try again later.'},409);
  if (claim.state!=='creating') {
   if (claim.state==='created' && typeof claim.url==='string') return json({url:claim.url,state:claim.state});
   return json({state:claim.state});
  }
  let session: {session_id?: unknown;url?: unknown;workflow_id?:unknown};
  try {
   const res=await fetch(`${DIDIT_BASE}/v3/session/`,{method:'POST',headers:{'x-api-key':apiKey,'content-type':'application/json'},
    body:JSON.stringify({workflow_id:workflow,vendor_data:`holup-case:${caseId}`,callback:`${appUrl}/verification?didit=done`,callback_method:'both',language:'en'}),signal:AbortSignal.timeout(15000)});
   if (!res.ok) return json({error:'Could not start capture. Please try again later.'},502);
   session=await res.json();
  } catch { return json({error:'Could not reach the capture provider. Please try again later.'},502); }
  if (typeof session.session_id!=='string' || typeof session.url!=='string' || session.workflow_id!==workflow) return json({error:'Capture provider returned an unexpected response.'},502);
  const {error}=await admin.rpc('manual_capture_record',{p_case:caseId,p_actor:who.user.id,p_lease:claim.lease,p_session:session.session_id,p_url:session.url,p_workflow:workflow});
  if (error) return json({error:'Could not securely save the capture session. Please try again later.'},503);
  return json({url:session.url,state:'created'});
 }
 const {data:cap,error:lookupError}=await admin.rpc('manual_capture_lookup',{p_case:caseId,p_actor:who.user.id});
 if (lookupError || !cap) return json({error:'Application unavailable.'},404);
 if (!cap.session || !cap.workflow) return json({state:cap.state});
 // Use request-start time so an event that arrives while this fetch is in
 // flight cannot be overwritten by an older provider response.
 const observedAt=Date.now();
 let result: Record<string,unknown>;
 try {
  const res=await fetch(`${DIDIT_BASE}/v3/session/${encodeURIComponent(cap.session)}/decision/`,{headers:{'x-api-key':apiKey,accept:'application/json'},signal:AbortSignal.timeout(10000)});
  if (!res.ok) return json({error:'Could not check capture. Please try again later.'},502);
  result=await res.json();
 } catch { return json({error:'Could not check capture. Please try again later.'},502); }
 // Never log or persist raw provider responses: they can contain identity and
 // biometric data. Require binding plus the three explicit successful checks.
 if (result.session_id!==cap.session || result.workflow_id!==cap.workflow || result.vendor_data!==`holup-case:${caseId}` || result.environment!=='live') return json({error:'Capture result could not be matched to this application.'},502);
 const approved=(key:string) => Array.isArray(result[key]) && (result[key] as Array<{status?:unknown}>).some(x=>x && x.status==='Approved');
 const state=result.status==='Approved' && approved('id_verifications') && approved('liveness_checks') && approved('face_matches') ? 'approved'
  : result.status==='Declined' ? 'declined'
  : result.status==='Expired' || result.status==='Abandoned' ? 'expired'
  : result.status==='In Review' || result.status==='Approved' ? 'review' : 'created';
 const {error}=await admin.rpc('manual_capture_result',{p_case:caseId,p_session:cap.session,p_workflow:cap.workflow,p_state:state,p_observed_at:observedAt});
 if (error) return json({error:'Could not securely record the capture result.'},503);
 const {data:current,error:currentError}=await admin.rpc('manual_capture_lookup',{p_case:caseId,p_actor:who.user.id});
 if (currentError || !current) return json({error:'Could not load the capture result.'},503);
 return json({state:current.state});
});
