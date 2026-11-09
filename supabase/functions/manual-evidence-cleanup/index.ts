// Protected production cleanup worker. Run with MANUAL_EVIDENCE_CLEANUP_SECRET;
// not publicly invoked and never expose this secret to clients. Checks the
// durable queue. An item is removed only after the private object is removed.
import { createClient } from 'npm:@supabase/supabase-js@2';
Deno.serve(async req=>{
 if(req.method!=='POST') return new Response('Method not allowed',{status:405});
 const secret=req.headers.get('x-cleanup-secret')??'';
 if(secret.length<32||secret.length>256) return new Response('Unauthorized',{status:401});
 const url=Deno.env.get('SUPABASE_URL')??'',key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
 if(!url||!key) return new Response('Not configured',{status:503});
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(secret));
 const digest=Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
 const {data:allowed,error:authError}=await client.rpc('manual_evidence_cleanup_authenticate',{p_digest:digest});
 if(authError) return new Response('Authorization unavailable',{status:503});
 if(allowed!==true) return new Response('Unauthorized',{status:401});
 const {error:expireError}=await client.rpc('manual_evidence_expire',{p_limit:100});
 if(expireError) { await client.rpc('manual_evidence_cleanup_heartbeat',{p_failed:1}); return new Response('Expiry unavailable',{status:503}); }
 const {data:paths,error}=await client.rpc('manual_evidence_cleanup_batch',{p_limit:100});
 if(error||!Array.isArray(paths)) { await client.rpc('manual_evidence_cleanup_heartbeat',{p_failed:1}); return new Response('Queue unavailable',{status:503}); }
 let removed=0,failed=0;
 for(const item of paths) {
  if(!item||typeof item.path!=='string'||!item.path.startsWith('cases/')||typeof item.revision!=='string') { failed++; continue; }
  const path=item.path;
  const {error:removeError}=await client.storage.from('holup-review-evidence').remove([path]);
  if(removeError) { failed++; continue; }
  const {error:doneError}=await client.rpc('manual_evidence_cleanup_done',{p_path:path,p_revision:item.revision});
  if(doneError) failed++; else removed++;
 }
 const {error:heartbeatError}=await client.rpc('manual_evidence_cleanup_heartbeat',{p_failed:failed});
 if(heartbeatError) return new Response('Cleanup monitoring unavailable',{status:503});
 return new Response(JSON.stringify({removed,failed}),{status:failed?503:200,headers:{'content-type':'application/json','cache-control':'no-store'}});
});
