// EXPERIMENT ONLY. Retired legacy destination deliberately does not consume,
// store, log or act on provider data. Activate only once the new destination
// is configured and verified; late callbacks cannot award old badges.
Deno.serve(req=>{
 if(req.method!=='POST') return new Response('Method not allowed',{status:405});
 return new Response('retired',{status:200,headers:{'cache-control':'no-store'}});
});
