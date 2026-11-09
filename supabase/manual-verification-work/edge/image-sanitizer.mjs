// Experimental only. Enforce strict input dimensions before invoking a decoder.
// The injected ImageMagick WASM runtime must be initialized and resource-limited
// by the caller. Decode/re-encode removes metadata but is NOT malware scanning.
const MAX_SIDE=1600, MAX_PIXELS=1600*1600, MAX_BYTES=5*1024*1024;
const ascii=(a,i,n)=>String.fromCharCode(...a.subarray(i,i+n));
const le24=(a,i)=>a[i]+(a[i+1]<<8)+(a[i+2]<<16);
const le32=(a,i)=>(a[i]+(a[i+1]*256)+(a[i+2]*65536)+(a[i+3]*16777216));
const be32=(a,i)=>(a[i]*16777216+a[i+1]*65536+a[i+2]*256+a[i+3]);
function dimensions(a){
 if(a.length<24 || a.length>MAX_BYTES) throw Error('Invalid image');
 if([137,80,78,71,13,10,26,10].every((v,i)=>a[i]===v)){
  if(be32(a,8)!==13 || ascii(a,12,4)!=='IHDR') throw Error('Invalid PNG');
  const width=be32(a,16),height=be32(a,20); let pos=8, end=false;
  while(pos+12<=a.length){ const n=be32(a,pos); if(n>a.length-pos-12) throw Error('Invalid PNG chunk');
   const kind=ascii(a,pos+4,4); if(kind==='acTL') throw Error('Animated images not supported');
   pos+=12+n; if(kind==='IEND'){end=true;break;}
  }
  if(!end || pos!==a.length) throw Error('Invalid PNG end');
  return {format:'png',width,height};
 }
 if(a[0]===255&&a[1]===216){
  let pos=2, dims=null;
  while(pos<a.length){
   if(a[pos++]!==255) throw Error('Invalid JPEG marker');
   while(pos<a.length&&a[pos]===255)pos++;
   const marker=a[pos++]; if(marker===0xda) {if(!dims) throw Error('Missing image dimensions');return dims;}
   if(marker===0xd9) break;
   if(marker===0x01||(marker>=0xd0&&marker<=0xd7)) continue;
   if(pos+2>a.length) throw Error('Invalid JPEG segment');
   const len=(a[pos]<<8)|a[pos+1]; if(len<2||pos+len>a.length) throw Error('Invalid JPEG segment');
   if([0xc0,0xc1,0xc2].includes(marker)){
    if(len<8||dims) throw Error('Invalid JPEG dimensions');
    dims={format:'jpeg',height:(a[pos+3]<<8)|a[pos+4],width:(a[pos+5]<<8)|a[pos+6]};
   }
   pos+=len;
  }
  throw Error('Invalid JPEG');
 }
 if(ascii(a,0,4)==='RIFF'&&ascii(a,8,4)==='WEBP'){
  if(le32(a,4)+8!==a.length) throw Error('Invalid WebP length');
  let pos=12,dims=null,animated=false;
  while(pos+8<=a.length){const kind=ascii(a,pos,4),n=le32(a,pos+4), p=pos+8;
   if(n>a.length-p) throw Error('Invalid WebP chunk');
   if(kind==='ANIM'||kind==='ANMF') animated=true;
   if(kind==='VP8X'){
    if(n!==10 || (a[p]&2)!==0) throw Error('Animated or invalid WebP');
    dims={format:'webp',width:1+le24(a,p+4),height:1+le24(a,p+7)};
   } else if(kind==='VP8 '&&!dims){
    if(n<10||a[p+3]!==0x9d||a[p+4]!==0x01||a[p+5]!==0x2a) throw Error('Invalid WebP');
    dims={format:'webp',width:(a[p+6]|a[p+7]<<8)&0x3fff,height:(a[p+8]|a[p+9]<<8)&0x3fff};
   } else if(kind==='VP8L'&&!dims){
    if(n<5||a[p]!==0x2f) throw Error('Invalid WebP');
    const v=le32(a,p+1);dims={format:'webp',width:(v&0x3fff)+1,height:((v>>>14)&0x3fff)+1};
   }
   pos=p+n+(n%2);
  }
  if(pos!==a.length||animated||!dims) throw Error('Invalid WebP'); return dims;
 }
 throw Error('Unsupported image');
}
export function imageBounds(a){
 const info=dimensions(a);
 if(!Number.isInteger(info.width)||!Number.isInteger(info.height)||info.width<1||info.height<1||info.width>MAX_SIDE||info.height>MAX_SIDE||info.width*info.height>MAX_PIXELS) throw Error('Image dimensions exceed limit');
 return info;
}
export function sanitizeImage(a,magick){
 const info=imageBounds(a);
 const formats={jpeg:magick.MagickFormat.Jpeg,png:magick.MagickFormat.Png,webp:magick.MagickFormat.WebP};
 const data=magick.ImageMagick.read(a,formats[info.format],img=>{
  if(img.width!==info.width||img.height!==info.height) throw Error('Image dimensions do not match');
  img.autoOrient(); img.strip();
  img.backgroundColor=magick.MagickColors.White; img.alpha(magick.AlphaAction.Remove);
  img.quality=92;
  return img.write(magick.MagickFormat.Jpeg,result=>Uint8Array.from(result));
 });
 if(!data.length||data.length>MAX_BYTES) throw Error('Processed image exceeds limit');
 return {bytes:data,mime:'image/jpeg'};
}
