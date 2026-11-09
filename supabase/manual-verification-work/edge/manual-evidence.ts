// Experimental, not deployed. Authenticated server-mediated private evidence.
// No public/signed URLs and no file bytes, tokens or IDs logged. Deployment
// still requires malware/abuse controls, retention cleanup and access review.
import { createClient } from 'npm:@supabase/supabase-js@2';
import * as magick from 'npm:@imagemagick/magick-wasm@0.0.45';
import { sanitizeImage } from './image-sanitizer.mjs';
// Lazy: if WASM initialization fails, uploads fail closed while already-saved
// files can still be read/deleted. Module loading and hosted limits need review.
let processor: Promise<void> | undefined;
function initializeProcessor(): Promise<void> {
 if(!processor) processor=(async()=>{
  const wasm=await Deno.readFile(new URL(import.meta.resolve('npm:@imagemagick/magick-wasm@0.0.45/magick.wasm')));
  await magick.initializeImageMagick(wasm);
  magick.ResourceLimits.width=1600n; magick.ResourceLimits.height=1600n;
  magick.ResourceLimits.area=67108864n; magick.ResourceLimits.listLength=4n;
  magick.ResourceLimits.memory=134217728n; magick.ResourceLimits.maxMemoryRequest=100663296n;
  magick.ResourceLimits.disk=0n; magick.ResourceLimits.maxProfileSize=1048576n;
 })().catch(e=>{processor=undefined;throw e;});
 return processor;
}
const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
function json(data:unknown,status=200) { return new Response(JSON.stringify(data),{status,headers:{...cors,'Content-Type':'application/json'}}); }
const maxBytes=5*1024*1024, maxBody=7*1024*1024;
async function readBounded(req:Request) {
 if (Number(req.headers.get('content-length') ?? '0')>maxBody) throw new Error('too large');
 const reader=req.body?.getReader(); if (!reader) throw new Error('empty');
 const chunks:Uint8Array[]=[]; let length=0;
 for (;;) { const {done,value}=await reader.read(); if(done) break; length+=value.length; if(length>maxBody) { await reader.cancel(); throw new Error('too large'); } chunks.push(value); }
 const bytes=new Uint8Array(length); let at=0; for(const chunk of chunks){ bytes.set(chunk,at); at+=chunk.length; }
 return JSON.parse(new TextDecoder().decode(bytes));
}
function imageType(a:Uint8Array):string|null {
 if(a.length>=3 && a[0]===255 && a[1]===216 && a[2]===255) return 'image/jpeg';
 if(a.length>=8 && [137,80,78,71,13,10,26,10].every((v,i)=>a[i]===v)) return 'image/png';
 if(a.length>=12 && String.fromCharCode(...a.subarray(0,4))==='RIFF' && String.fromCharCode(...a.subarray(8,12))==='WEBP') return 'image/webp';
 return null;
}
function toBase64(bytes:Uint8Array) { let text=''; for(let i=0;i<bytes.length;i+=0x8000) text+=String.fromCharCode(...bytes.subarray(i,i+0x8000)); return btoa(text); }
Deno.serve(async req=>{
 if(req.method==='OPTIONS') return new Response('ok',{headers:cors});
 if(req.method!=='POST') return json({error:'Method not allowed.'},405);
 const url=Deno.env.get('SUPABASE_URL')??'', anon=Deno.env.get('SUPABASE_ANON_KEY')??'', key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')??'';
 if(!url||!anon||!key) return json({error:'Secure uploads are not configured.'},503);
 const user=createClient(url,anon,{global:{headers:{Authorization:req.headers.get('authorization')??''}}});
 const {data:who,error:authError}=await user.auth.getUser(); if(authError||!who.user) return json({error:'Sign in required.'},401);
 let body:{action?:unknown;caseId?:unknown;fileId?:unknown;base64?:unknown};
 try { body=await readBounded(req); } catch { return json({error:'Invalid request or file too large.'},400); }
 if(!body || typeof body!=='object' || Array.isArray(body)) return json({error:'Invalid request.'},400);
 const service=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const bucket=service.storage.from('holup-review-evidence');
 if(body.action==='upload') {
  if(!Number.isSafeInteger(body.caseId)||Number(body.caseId)<=0||typeof body.base64!=='string'||body.base64.length>Math.ceil(maxBytes/3)*4+4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64)) return json({error:'Choose a JPEG, PNG or WebP image up to 5 MB.'},400);
  let bytes:Uint8Array; try { const raw=atob(body.base64); bytes=Uint8Array.from(raw,c=>c.charCodeAt(0)); } catch {return json({error:'Invalid image.'},400);}
  const mime=imageType(bytes); if(!mime || !bytes.length || bytes.length>maxBytes) return json({error:'Choose a JPEG, PNG or WebP image up to 5 MB.'},400);
  // Reserve first: this proves ownership and applies per-case limits before the
  // more expensive decoding step. Only sanitized JPEG bytes may be stored.
  const {data:slot,error:reserveError}=await service.rpc('manual_evidence_reserve',{p_case:body.caseId,p_actor:who.user.id,p_mime:'image/jpeg'});
  if(reserveError||!slot) return json({error:'Could not add the image to this application.'},403);
  try { await initializeProcessor(); }
  catch { await service.rpc('manual_evidence_abort',{p_file:slot.id,p_actor:who.user.id}); return json({error:'Image processing is temporarily unavailable.'},503); }
  let clean:Uint8Array;
  try { clean=sanitizeImage(bytes,magick).bytes; }
  catch { await service.rpc('manual_evidence_abort',{p_file:slot.id,p_actor:who.user.id}); return json({error:'Could not process this image. Choose a clear still image no larger than 1600 by 1600 pixels.'},400); }
  const {error:uploadError}=await bucket.upload(slot.path,clean,{contentType:'image/jpeg',upsert:false,cacheControl:'0'});
  const {error:finishError}=await service.rpc('manual_evidence_finish',{p_file:slot.id,p_actor:who.user.id,p_success:!uploadError});
  if(uploadError||finishError){
   // A timeout may conceal a successful object write. Re-enqueue after the
   // upload attempt, even if the case/row disappeared during the request.
   const {error:queueError}=await service.rpc('manual_evidence_cleanup_enqueue',{p_path:slot.path});
   await service.rpc('manual_evidence_abort',{p_file:slot.id,p_actor:who.user.id});
   if(!uploadError) await bucket.remove([slot.path]);
   if(queueError) console.error('Failed to queue incomplete verification upload for deletion');
   return json({error:'Image was not saved. Please try again.'},503);
  }
  return json({id:slot.id});
 }
 if(body.action==='delete') {
  if(typeof body.fileId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.fileId)) return json({error:'Image unavailable.'},404);
  const {data:path,error}=await service.rpc('manual_evidence_hide',{p_file:body.fileId,p_actor:who.user.id});
  if(error||!path) return json({error:'Image unavailable.'},404);
  const {error:removeError}=await bucket.remove([path]);
  // Leave the durable queue for the worker to acknowledge with its revision.
  // Visibility is revoked atomically even if deletion has to be retried.
  return json({hidden:true,deleted:!removeError});
 }
 if(body.action==='read') {
  if(typeof body.fileId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.fileId)) return json({error:'Image unavailable.'},404);
  const {data:file,error}=await service.rpc('manual_evidence_authorize',{p_file:body.fileId,p_actor:who.user.id});
  if(error||!file) return json({error:'Image unavailable.'},404);
  const {data:blob,error:downloadError}=await bucket.download(file.path);
  if(downloadError||!blob||blob.size>maxBytes) return json({error:'Image unavailable.'},404);
  const bytes=new Uint8Array(await blob.arrayBuffer()); const mime=imageType(bytes);
  if(!mime||mime!==file.mime) return json({error:'Image unavailable.'},404);
  return json({mime,base64:toBase64(bytes)});
 }
 return json({error:'Invalid action.'},400);
});
