import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtemp,readFile,realpath,rm,writeFile} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';
import {createServer as createTlsServer} from 'node:tls';

const root=await realpath(tmpdir()),dir=await mkdtemp(join(root,'riuya-z12-tls-lab-'));
const actual=await realpath(dir),rel=relative(root,actual);
if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)||!rel.startsWith('riuya-z12-tls-lab-'))throw Error('LAB_SCOPE_INVALID');
const openssl='C:/Program Files/Git/usr/bin/openssl.exe';
const service=resolve('scripts/worker-service.mjs');
let server;
try{
 const conf=join(actual,'openssl.cnf'),keyPath=join(actual,'key.pem'),certPath=join(actual,'cert.pem');
 await writeFile(conf,[
  '[req]','distinguished_name = dn','x509_extensions = ext','prompt = no',
  '[dn]','CN = Riuya Test Only','[ext]','subjectAltName = IP:127.0.0.1',
  'basicConstraints = critical,CA:TRUE','keyUsage = critical,digitalSignature,keyEncipherment,keyCertSign',
  'extendedKeyUsage = serverAuth',''].join('\n'),{flag:'wx'});
 try{execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-keyout',keyPath,'-out',certPath,'-config',conf],
  {stdio:'ignore',windowsHide:true,timeout:30000});}catch{throw Error('LAB_CERTIFICATE_FAILED');}
 const key=await readFile(keyPath),cert=await readFile(certPath);
 let startups=0;
 const tlsServer=createTlsServer({key,cert},socket=>{
  socket.on('error',()=>{});
  socket.once('data',()=>{
   startups++;
   const fields=Buffer.from('SFATAL\0CXX000\0MLAB_TLS_STOP\0\0');
   const packet=Buffer.alloc(5+fields.length);packet[0]=69;packet.writeUInt32BE(fields.length+4,1);fields.copy(packet,5);
   socket.end(packet);
  });
 });
 tlsServer.on('tlsClientError',()=>{});
 server=createServer(socket=>{
  socket.on('error',()=>{});
  let request=Buffer.alloc(0);
  const receive=chunk=>{
   request=Buffer.concat([request,chunk]);
   if(request.length<8)return;
   if(request.length!==8||request.readUInt32BE(0)!==8||request.readUInt32BE(4)!==80877103){socket.destroy();return;}
   socket.removeListener('data',receive);
   socket.write('S',()=>tlsServer.emit('connection',socket));
  };
  socket.on('data',receive);
 });
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
 const port=server.address().port;
 const attempt=(host,trust)=>new Promise((resolve,reject)=>{
  const env={...process.env,RIUYA_WORKER_ENABLED:'1',RIUYA_PURGE_ENABLED:'0',NOTIFICATION_TRANSPORT:'local',
   RIUYA_WORKER_DATABASE_URL:'postgresql://fixture:fixture@'+host+':'+port+'/postgres?sslmode=verify-full',
   NODE_OPTIONS:'--dns-result-order=ipv4first'};
  delete env.RIUYA_WORKER_LAB_PLAINTEXT;
  if(trust)env.NODE_EXTRA_CA_CERTS=certPath;else delete env.NODE_EXTRA_CA_CERTS;
  const child=spawn(process.execPath,[service],{env,stdio:['ignore','ignore','ignore'],windowsHide:true});
  const timeout=setTimeout(()=>{child.kill();reject(Error('LAB_TLS_TIMEOUT'));},12000);
  child.once('error',error=>{clearTimeout(timeout);reject(error);});
  child.once('exit',code=>{clearTimeout(timeout);resolve(code);});
 });
 const initial=startups;
 assert.equal(await attempt('127.0.0.1',false),1);
 assert.equal(startups,initial,'LAB_UNTRUSTED_CERT_ACCEPTED');
 assert.equal(await attempt('localhost',true),1);
 assert.equal(startups,initial,'LAB_WRONG_HOST_ACCEPTED');
 assert.equal(await attempt('127.0.0.1',true),1);
 assert.equal(startups,initial+1,'LAB_TRUSTED_TLS_NOT_ESTABLISHED');
 console.log('Z12 worker: TLS confiable aceptado; certificado y nombre incorrectos rechazados: OK');
}finally{
 if(server)await new Promise(resolve=>server.close(resolve));
 await rm(actual,{recursive:true,force:false});
}
