import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import https from 'node:https';

export function isPublicIPv4(address){
 if(net.isIP(address)!==4)return false;
 const [a,b,c]=address.split('.').map(Number);
 if(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===192&&b===0||a===192&&b===88&&c===99||a===198&&(b===18||b===19)||a===198&&b===51&&c===100||a===203&&b===0&&c===113)return false;
 return true;
}
export async function validateTarget(input,allowedDomains,resolve=dns.lookup){
 const url=new URL(input);
 const host=url.hostname.toLowerCase().replace(/\.$/,'');
 if(!['http:','https:'].includes(url.protocol)||url.username||url.password||!host||net.isIP(host.replace(/^\[|\]$/g,''))||!allowedDomains.includes(host))throw Error('URL_NOT_ALLOWED');
 if((url.protocol==='http:'&&url.port&&url.port!=='80')||(url.protocol==='https:'&&url.port&&url.port!=='443'))throw Error('PORT_NOT_ALLOWED');
 const addresses=await resolve(host,{all:true,family:4,verbatim:true});
 // Solicitar solo IPv4, rechazar respuestas mixtas o privadas y fijar la dirección.
 if(!addresses.length||addresses.some(x=>!isPublicIPv4(x.address)))throw Error('ADDRESS_NOT_ALLOWED');
 return {url,address:addresses[0].address};
}
export async function safeFetch(input,{allowedDomains,timeoutMs=15000,maxBytes=1048576,maxRedirects=3,headers={},resolve=dns.lookup}={}){
 if(!Array.isArray(allowedDomains)||!allowedDomains.length||timeoutMs<1||maxBytes<1||maxRedirects<0||maxRedirects>3)throw Error('INVALID_OPTIONS');
 const allowed=new Set(['accept','if-none-match','if-modified-since','user-agent']);
 if(Object.keys(headers).some(x=>!allowed.has(x.toLowerCase())))throw Error('HEADER_NOT_ALLOWED');
 const deadline=Date.now()+timeoutMs;let current=input;
 for(let redirects=0;redirects<=maxRedirects;redirects++){
  const remaining=deadline-Date.now();if(remaining<=0)throw Error('FETCH_TIMEOUT');
  let timer;
  const {url,address}=await Promise.race([validateTarget(current,allowedDomains,resolve),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('FETCH_TIMEOUT')),remaining);})]).finally(()=>clearTimeout(timer));
  const networkTime=deadline-Date.now();if(networkTime<=0)throw Error('FETCH_TIMEOUT');
  const response=await new Promise((resolveResponse,reject)=>{
   const lib=url.protocol==='https:'?https:http;
   let absoluteTimer;
   const req=lib.request(url,{method:'GET',headers,family:4,lookup:(_host,_opts,callback)=>callback(null,address,4),timeout:networkTime},res=>{
    const location=res.headers.location;
    if(res.statusCode>=300&&res.statusCode<400&&location){res.destroy();resolveResponse({redirect:new URL(location,url).href});return;}
    const length=Number(res.headers['content-length']||0);
    if(length>maxBytes){res.destroy();reject(Error('RESPONSE_TOO_LARGE'));return;}
    let size=0;const chunks=[];
    res.on('data',chunk=>{size+=chunk.length;if(size>maxBytes){res.destroy(Error('RESPONSE_TOO_LARGE'));return;}chunks.push(chunk);});
    res.on('end',()=>resolveResponse({status:res.statusCode,headers:{etag:res.headers.etag||null,lastModified:res.headers['last-modified']||null,contentType:res.headers['content-type']||null},body:Buffer.concat(chunks)}));
    res.on('error',reject);
   });
   absoluteTimer=setTimeout(()=>req.destroy(Error('FETCH_TIMEOUT')),networkTime);
   req.on('close',()=>clearTimeout(absoluteTimer));
   req.on('timeout',()=>req.destroy(Error('FETCH_TIMEOUT')));req.on('error',reject);req.end();
  });
  if(!response.redirect)return response;
  if(redirects===maxRedirects)throw Error('TOO_MANY_REDIRECTS');
  current=response.redirect;
 }
 throw Error('TOO_MANY_REDIRECTS');
}
