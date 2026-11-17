import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,realpath,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {isAbsolute,join,relative,resolve,sep} from 'node:path';
import pg from 'pg';

// La puerta y la imagen del worker solo se conectan a la red temporal.
export async function probeWorkerTlsImage({status,dir,id}){
 const target=new URL(status.DB_URL),root=await realpath(tmpdir()),actual=await realpath(dir),rel=relative(root,actual);
 if(!/^riuya_z11_lab_[a-f0-9]{20}$/.test(id)||target.hostname!=='127.0.0.1'||target.port==='54322'||
  !rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)||!rel.startsWith('riuya-z11-lab-'))throw Error('LAB_SCOPE_INVALID');
 const suffix=id.slice(-20),image='riuya-z12-tlsworker-'+suffix+':test',gateway='riuya_z12_tls_gateway_'+suffix;
 const certDir=join(actual,'tls-image');await mkdir(certDir);
 const conf=join(certDir,'openssl.cnf'),key=join(certDir,'key.pem'),cert=join(certDir,'cert.pem');
 await writeFile(conf,['[req]','distinguished_name = dn','x509_extensions = ext','prompt = no','[dn]',
  'CN = Riuya Test Only','[ext]','subjectAltName = DNS:db.riuya.invalid','basicConstraints = critical,CA:TRUE',
  'keyUsage = critical,digitalSignature,keyEncipherment,keyCertSign','extendedKeyUsage = serverAuth',''].join('\n'),{flag:'wx'});
 try{execFileSync('C:/Program Files/Git/usr/bin/openssl.exe',['req','-x509','-newkey','rsa:2048','-nodes','-days','1',
  '-keyout',key,'-out',cert,'-config',conf],{stdio:'ignore',windowsHide:true,timeout:30000});}
 catch{throw Error('LAB_CERTIFICATE_FAILED');}
 const db=new pg.Client({connectionString:status.DB_URL}),pass=randomBytes(32).toString('hex'),uid=randomUUID(),job=randomUUID();
 const network='supabase_network_'+id,containers=new Set();let imageBuilt=false;
 const docker=(args,allowFailure=false)=>{
  try{return execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:args[0]==='wait'?15000:240000,maxBuffer:8*1024*1024}).trim();}
  catch(error){if(allowFailure&&error.status===1)return null;throw Error('LAB_TLS_IMAGE_DOCKER_FAILED');}
 };
 const remove=name=>{docker(['stop','--time','2',name],true);docker(['rm',name],true);containers.delete(name);};
 const createWorker=(name,host,trust)=>{
  const url='postgresql://riuya_z12_tls_image:'+pass+'@'+host+':5432/postgres?sslmode=verify-full';
  const args=['create','--name',name,'--network',network,'-e','RIUYA_WORKER_ENABLED=1','-e','RIUYA_PURGE_ENABLED=0',
   '-e','NOTIFICATION_TRANSPORT=local','-e','RIUYA_WORKER_DATABASE_URL='+url];
  if(trust)args.push('-e','NODE_EXTRA_CA_CERTS=/tmp/lab-ca.pem');
  docker([...args,image]);containers.add(name);
  if(trust)docker(['cp',cert,name+':/tmp/lab-ca.pem']);
  docker(['start',name]);
 };
 await db.connect();
 try{
  assert.equal((await db.query("select count(*)::int n from private.jobs where status in ('queued','running') and job_type<>'account.purge'")).rows[0].n,0);
  await db.query("create role riuya_z12_tls_image login nosuperuser nocreatedb nocreaterole inherit nobypassrls password '"+pass+"'");
  await db.query('grant riuya_worker_client to riuya_z12_tls_image');
  await db.query('insert into auth.users(id,email) values($1,$2)',[uid,'z12-tls-image-'+randomUUID()+'@example.invalid']);
  await db.query('insert into private.profiles(id) values($1)',[uid]);
  await db.query("insert into private.jobs(id,job_type,payload,dedupe_key,created_by) values($1,'draft.generate',jsonb_build_object('fixtureId','demo-v1'),$2,$3)",[job,'z12-tls-image-'+job,uid]);
  docker(['build','-f','Dockerfile.worker','-t',image,'.']);imageBuilt=true;
  docker(['create','--name',gateway,'--network',network,'--network-alias','db.riuya.invalid',
   '--network-alias','wrong.riuya.invalid','-e','LAB_TARGET_HOST=supabase_db_'+id,
   '--entrypoint','node','node:24.22.1-bookworm-slim','/tmp/certs/gateway.mjs']);containers.add(gateway);
  docker(['cp',certDir,gateway+':/tmp/certs']);
  docker(['cp',resolve('scripts/probe-z12-tls-gateway.mjs'),gateway+':/tmp/certs/gateway.mjs']);
  docker(['start',gateway]);
  let gatewayReady=false;
  for(let i=0;i<30&&!gatewayReady;i++){
   gatewayReady=docker(['exec',gateway,'node','-e',"const s=require('node:net').connect(5432,'127.0.0.1');s.on('connect',()=>{s.destroy();process.exit(0)});s.on('error',()=>process.exit(1));"],true)!==null;
   if(!gatewayReady)await new Promise(resolve=>setTimeout(resolve,200));
  }
  if(!gatewayReady)throw Error('LAB_TLS_GATEWAY_NOT_READY');
  for(const [label,host,trust] of [['untrusted','db.riuya.invalid',false],['wronghost','wrong.riuya.invalid',true]]){
   const name='riuya_z12_tls_'+label+'_'+suffix;createWorker(name,host,trust);
   assert.equal(docker(['wait',name]),'1','LAB_TLS_INVALID_CERT_ACCEPTED');
   remove(name);
   assert.equal((await db.query('select status from private.jobs where id=$1',[job])).rows[0].status,'queued');
  }
  const valid='riuya_z12_tls_valid_'+suffix;createWorker(valid,'db.riuya.invalid',true);
  let done=false;
  for(let i=0;i<100&&!done;i++){
   done=(await db.query("select exists(select 1 from private.jobs where id=$1 and status='succeeded') ok",[job])).rows[0].ok;
   if(!done)await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.equal(done,true,'LAB_TLS_IMAGE_NOT_COMPLETED');
  docker(['stop',valid]);
  assert.equal(docker(['inspect','--format','{{.State.ExitCode}}',valid]),'0','LAB_TLS_IMAGE_STOP_FAILED');
  remove(valid);
  console.log('Z12 laboratorio: imagen worker procesa sobre TLS y rechaza certificados inválidos: OK');
 }finally{
  for(const name of containers)remove(name);
  if(imageBuilt)docker(['image','rm',image]);
  await db.end();
 }
}
