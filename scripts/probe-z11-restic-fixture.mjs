// Solo para el laboratorio temporal: no invocar contra datos reales.
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {isAbsolute,join,relative,sep} from 'node:path';
import {realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';

export function validateFixturePair(pair,databaseId,storageId) {
 if(!pair||typeof pair!=='object'||Array.isArray(pair)||Object.keys(pair).sort().join(',')!=='database,storage,version'||
  pair.version!==1||pair.database!==databaseId||pair.storage!==storageId||
  !/^[a-f0-9]{64}$/.test(pair.database)||!/^[a-f0-9]{64}$/.test(pair.storage))throw Error('LAB_RESTIC_PAIR_INVALID');
 return pair;
}

export function probeResticFixture({executable,dir,id,image}) {
 if(!isAbsolute(executable)||!isAbsolute(dir)||!/^riuya_z11_lab_[a-f0-9]{20}$/.test(id)||
  image!=='public.ecr.aws/supabase/postgres:17.11.0.011')throw Error('LAB_RESTIC_SCOPE_INVALID');
 const root=realpathSync(tmpdir()),actual=realpathSync(dir),rel=relative(root,actual);
 if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)||!rel.startsWith('riuya-z11-lab-'))throw Error('LAB_RESTIC_SCOPE_INVALID');
 const repository=join(actual,'restic-repository'),env={...process.env,RESTIC_PASSWORD:randomBytes(32).toString('hex')};
 const run=(args,options={})=>{
  try{return execFileSync(executable,['-r',repository,...args],{env,encoding:null,stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:120000,maxBuffer:128*1024*1024,...options});}
  catch{throw Error('LAB_RESTIC_FAILED');}
 };
 run(['init','--quiet']);
 run(['backup','--quiet','--tag','fixture-db','--stdin-filename','database.dump','--stdin-from-command','--',
  'docker','exec','-i','supabase_db_'+id,'pg_dump','-U','supabase_admin','-Fc','-C','postgres']);
 run(['backup','--quiet','--tag','fixture-storage','--stdin-filename','storage.tar','--stdin-from-command','--',
  'docker','run','--rm','--network','none','--mount','type=volume,src=supabase_storage_'+id+',dst=/store',
  image,'tar','-cf','-','-C','/store','.']);
 const snapshot=tag=>{
  const list=JSON.parse(run(['snapshots','--json','--tag',tag]).toString('utf8'));
  if(!Array.isArray(list)||list.length!==1||!/^[a-f0-9]{64}$/.test(list[0].id))throw Error('LAB_RESTIC_SNAPSHOT_INVALID');
  return list[0].id;
 };
 // El par no se considera disponible hasta guardar y validar un manifiesto cifrado.
 const databaseId=snapshot('fixture-db'),storageId=snapshot('fixture-storage');
 const manifest=Buffer.from(JSON.stringify({version:1,database:databaseId,storage:storageId}));
 run(['backup','--quiet','--tag','fixture-pair','--stdin-filename','pair.json','--stdin'],
  {input:manifest,stdio:['pipe','pipe','pipe']});
 run(['check','--read-data','--quiet']);
 const pair=validateFixturePair(JSON.parse(run(['dump',snapshot('fixture-pair'),'/pair.json']).toString('utf8')),databaseId,storageId);
 return {
  database:run(['dump',pair.database,'/database.dump']),
  storage:run(['dump',pair.storage,'/storage.tar'])
 };
}
