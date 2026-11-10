import assert from 'node:assert/strict';import http from 'node:http';import {EventEmitter} from 'node:events';import {Readable} from 'node:stream';import {isPublicIPv4,validateTarget,safeFetch} from '../src/worker/safe-fetch.mjs';
for(const ip of ['127.0.0.1','10.0.0.1','169.254.169.254','172.16.0.2','192.168.1.1','100.64.0.1','198.18.0.1','203.0.113.3','224.1.1.1','::1','::ffff:127.0.0.1'])assert.equal(isPublicIPv4(ip),false,ip);
assert.equal(isPublicIPv4('8.8.8.8'),true);
const dns=async()=>[{address:'8.8.8.8',family:4}],mixed=async()=>[{address:'8.8.8.8',family:4},{address:'127.0.0.1',family:4}];
assert.equal((await validateTarget('https://example.org/feed',['example.org'],dns)).address,'8.8.8.8');
for(const url of ['http://127.0.0.1/','https://example.org:8443/','http://user:pw@example.org/','file:///tmp/x','https://evil.example/'])await assert.rejects(()=>validateTarget(url,['example.org'],dns));
await assert.rejects(()=>validateTarget('https://example.org/',['example.org'],mixed));
const original=http.request;let calls=0;let pinned='';
try{
 http.request=(url,options,callback)=>{
  calls++;options.lookup(url.hostname,{},(_e,ip)=>{pinned=ip;});
  const req=new EventEmitter();req.end=()=>{const res=Readable.from([]);res.statusCode=302;res.headers={location:'http://127.0.0.1/internal'};res.on('close',()=>req.emit('close'));queueMicrotask(()=>callback(res));};req.destroy=error=>req.emit('error',error);return req;
 };
 await assert.rejects(()=>safeFetch('http://example.org/feed',{allowedDomains:['example.org'],resolve:dns}),/URL_NOT_ALLOWED/);
 assert.equal(calls,1);assert.equal(pinned,'8.8.8.8');
 http.request=(_url,_options,callback)=>{
  const req=new EventEmitter();req.end=()=>{const res=Readable.from([Buffer.alloc(20)]);res.statusCode=200;res.headers={};res.on('close',()=>req.emit('close'));queueMicrotask(()=>callback(res));};req.destroy=error=>req.emit('error',error);return req;
 };
 await assert.rejects(()=>safeFetch('http://example.org/feed',{allowedDomains:['example.org'],resolve:dns,maxBytes:10}),/RESPONSE_TOO_LARGE/);
}finally{http.request=original;}
console.log('Z09 fetch: IP internas, DNS mixto, redirección y tamaño bloqueados (red simulada): OK');
