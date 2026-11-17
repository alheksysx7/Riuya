import {execFileSync} from 'node:child_process';
import {createLocalPurgeAuthAdmin} from './purge-auth.mjs';
import {processAccountPurge} from './purge-account.mjs';
import {loadConfiguredPurgeJournal} from './purge-local-journal.mjs';
import {verifyPurgeStorageSeparation} from './purge-storage-readiness.mjs';

function localStatus(){
 try{return JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore'],windowsHide:true,timeout:10000}));}
 catch{throw Error('PURGE_LOCAL_STATUS_UNAVAILABLE');}
}

async function localConfig(env,statusProvider,verifyStorage){
 const {journal}=await loadConfiguredPurgeJournal(env);
 await verifyStorage(journal);
 const status=statusProvider();
 if(status?.API_URL!=='http://127.0.0.1:54321'||!status?.DB_URL?.includes('127.0.0.1:54322')||
    !status.ANON_KEY||!status.JWT_SECRET||!status.SERVICE_ROLE_KEY)throw Error('PURGE_LOCAL_CONFIG_INVALID');
 return {status,journal};
}
export async function verifyLocalPurgeReadiness({env=process.env,statusProvider=localStatus,verifyStorage=verifyPurgeStorageSeparation}={}){
 await localConfig(env,statusProvider,verifyStorage);
}
// Se invoca exclusivamente para un trabajo de purga reclamado.
export async function runLocalPurgeJob({db,job,env=process.env,statusProvider=localStatus,verifyStorage=verifyPurgeStorageSeparation}){
 if(job?.type!=='account.purge')throw Error('PURGE_JOB_INVALID');
 const {status,journal}=await localConfig(env,statusProvider,verifyStorage);
 const admin=createLocalPurgeAuthAdmin({apiUrl:status.API_URL,serviceRoleKey:status.SERVICE_ROLE_KEY});
 await processAccountPurge({db,job,admin,journal,
  storageConfig:{apiUrl:status.API_URL,anonKey:status.ANON_KEY,jwtSecret:status.JWT_SECRET}});
}
