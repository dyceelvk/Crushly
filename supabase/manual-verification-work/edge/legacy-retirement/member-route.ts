// EXPERIMENT ONLY. Intended replacement for the retired didit-session,
// didit-status and verify-identity routes at coordinated cutover. Never use
// the legacy AI path to assign or remove a verification badge. The existing
// installed app receives a clear error, rather than a false success.
const headers={
 'Access-Control-Allow-Origin':'*',
 'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
 'Access-Control-Allow-Methods':'POST, OPTIONS',
 'Content-Type':'application/json',
 'Cache-Control':'no-store',
};
Deno.serve(req=>{
 if(req.method==='OPTIONS') return new Response(null,{status:204,headers});
 if(req.method!=='POST') return new Response(JSON.stringify({error:'Method not allowed.'}),{status:405,headers});
 return new Response(JSON.stringify({error:'This verification method has been retired. Update Holup and use Settings → Verification. If you need help, contact rielosInc@gmail.com.'}),{status:410,headers});
});
