import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,realpath,writeFile} from 'node:fs/promises';
import {createConnection,createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';
import {createServer as createTlsServer} from 'node:tls';
import {pathToFileURL} from 'node:url';
import pg from 'pg';

// La puerta TLS solo acepta conexiones locales y reenvía exclusivamente a la base temporal.
export async function probeWorkerTlsDb({status,dir,id}){
 const target=new URL(status.DB_URL),root=await realpath(tmpdir()),actual=await realpath(dir),rel=relative(root,actual);
 if(!/^riuya_z11_lab_[a-f0-9]{20}$/.test(id)||target.hostname!=='127.0.0.1'||target.port==='54322'||
  !rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)||!rel.startsWith('riuya-z11-lab-'))throw Error('LAB_SCOPE_INVALID');
 const working=join(actual,'tls-worker');await mkdir(working);
 const keyPath=join(working,'key.pem'),certPath=join(working,'cert.pem'),conf=join(working,'openssl.cnf');
 await writeFile(conf,['[req]','distinguished_name = dn','x509_extensions = ext','prompt = no','[dn]',
  'CN = Riuya Test Only','[ext]','subjectAltName = IP:127.0.0.1','basicConstraints = critical,CA:TRUE',
  'keyUsage = critical,digitalSignature,keyEncipherment,keyCertSign','extendedKeyUsage = serverAuth',''].join('\n'),{flag:'wx'});
 try{execFileSync('C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-days','1',
  '-keyout',keyPath,'-out',certPath,'-config',conf],{stdio:'ignore',windowsHide:true,timeout:30000});}
 catch{throw Error('LAB_CERTIFICATE_FAILED');}
 const key=await readFile(keyPath),cert=await readFile(certPath),db=new pg.Client({connectionString:status.DB_URL});
 const pass=randomBytes(32).toString('hex'),uid=randomUUID(),job=randomUUID();
 let server,child;
 await db.connect();
 try{
  assert.equal((await db.query("select count(*)::int n from private.jobs where status in ('queued','running') and job_type<>'account.purge'")).rows[0].n,0);
  await db.query("create role riuya_z12_tls_worker login nosuperuser nocreatedb nocreaterole inherit nobypassrls password '"+pass+"'");
  await db.query('grant riuya_worker_client to riuya_z12_tls_worker');
  await db.query('insert into auth.users(id,email) values($1,$2)',[uid,'z12-tls-'+randomUUID()+'@example.invalid']);
  await db.query('insert into private.profiles(id) values($1)',[uid]);
  await db.query("insert into private.jobs(id,job_type,payload,dedupe_key,created_by) values($1,'draft.generate',jsonb_build_object('fixtureId','demo-v1'),$2,$3)",[job,'z12-tls-'+job,uid]);
  let forwarded=0;
  const tlsServer=createTlsServer({key,cert},socket=>{
   socket.on('error',()=>{});
   const upstream=createConnection({host:'127.0.0.1',port:Number(target.port)});
   upstream.on('error',()=>socket.destroy());socket.on('error',()=>upstream.destroy());
   socket.once('data',()=>{forwarded++;});socket.pipe(upstream);upstream.pipe(socket);
  });
  tlsServer.on('tlsClientError',()=>{});
  server=createServer(socket=>{
   socket.on('error',()=>{});let request=Buffer.alloc(0);
   const receive=chunk=>{
    request=Buffer.concat([request,chunk]);if(request.length<8)return;
    if(request.length!==8||request.readUInt32BE(0)!==8||request.readUInt32BE(4)!==80877103){socket.destroy();return;}
    socket.removeListener('data',receive);socket.write('S',()=>tlsServer.emit('connection',socket));
   };
   socket.on('data',receive);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port,entry=resolve('scripts/worker-service.mjs'),signal=resolve('scripts/probe-z12-worker-signal.mjs');
  const options=(host,trust)=>{const env={...process.env,RIUYA_WORKER_ENABLED:'1',RIUYA_PURGE_ENABLED:'0',NOTIFICATION_TRANSPORT:'local',
   RIUYA_WORKER_DATABASE_URL:'postgresql://riuya_z12_tls_worker:'+pass+'@'+host+':'+port+'/postgres?sslmode=verify-full',
   NODE_OPTIONS:'--dns-result-order=ipv4first'};
   delete env.RIUYA_WORKER_LAB_PLAINTEXT;
   if(trust)env.NODE_EXTRA_CA_CERTS=certPath;else delete env.NODE_EXTRA_CA_CERTS;
   return env;
  };
  const rejectAttempt=(host,trust)=>new Promise((resolve,reject)=>{
   const test=spawn(process.execPath,[entry],{env:options(host,trust),stdio:['ignore','ignore','ignore'],windowsHide:true});
   const timer=setTimeout(()=>{test.kill();reject(Error('LAB_TLS_REJECT_TIMEOUT'));},12000);
   test.once('error',error=>{clearTimeout(timer);reject(error);});
   test.once('exit',code=>{clearTimeout(timer);resolve(code);});
  });
  assert.equal(await rejectAttempt('127.0.0.1',false),1);
  assert.equal(await rejectAttempt('localhost',true),1);
  assert.equal(forwarded,0,'LAB_TLS_INVALID_CONNECTION_FORWARDED');
  assert.equal((await db.query('select status from private.jobs where id=$1',[job])).rows[0].status,'queued');
  child=spawn(process.execPath,['--import',pathToFileURL(signal).href,entry],
   {env:options('127.0.0.1',true),stdio:['ignore','pipe','pipe','ipc'],windowsHide:true});
  let exited=false;const exit=new Promise(resolve=>child.once('exit',code=>{exited=true;resolve(code);}));
  let done=false;
  for(let i=0;i<100&&!done&&!exited;i++){
   done=(await db.query("select exists(select 1 from private.jobs where id=$1 and status='succeeded') ok",[job])).rows[0].ok;
   if(!done)await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.equal(done,true,'LAB_TLS_WORKER_NOT_COMPLETED');
  assert(forwarded>=2,'LAB_TLS_CONNECTIONS_MISSING');
  child.send('stop');const code=await Promise.race([exit,new Promise((_,reject)=>setTimeout(()=>reject(Error('LAB_TLS_STOP_TIMEOUT')),7000))]);
  assert.equal(code,0);child=null;
  console.log('Z12 laboratorio: worker procesa trabajo sobre TLS y rechaza certificado y nombre incorrectos: OK');
 }finally{
  if(child&&child.exitCode===null&&child.signalCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}
  if(server)await new Promise(resolve=>server.close(resolve));
  await db.end();
 }
}
