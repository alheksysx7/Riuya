import {createClient} from '@supabase/supabase-js';
import {recordPurgeIntent} from './purge-journal.mjs';
import {isRestoreInternalFetch} from './purge-restore-internal-fetch.mjs';

const approvedAdmins=new WeakSet();
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Solo proceso de purga local. La clave administrativa nunca va al navegador.
export function createLocalPurgeAuthAdmin({apiUrl,serviceRoleKey,restoreFetch}){
 if(apiUrl!=='http://127.0.0.1:54321'||typeof serviceRoleKey!=='string'||!serviceRoleKey||(restoreFetch&&!isRestoreInternalFetch(restoreFetch)))throw Error('PURGE_AUTH_CONFIG_INVALID');
 const client=createClient(apiUrl,serviceRoleKey,{auth:{persistSession:false,autoRefreshToken:false},
  global:{fetch:(url,options={})=>(restoreFetch||fetch)(url,{...options,signal:AbortSignal.timeout(10000)})}});
 const admin=client.auth.admin;approvedAdmins.add(admin);return admin;
}

// El usuario se deriva exclusivamente del trabajo preparado por la base.
export async function purgePreparedAuth({db,job,admin,journal}){
 if(!db||typeof db.query!=='function'||!uuid.test(job?.id||'')||!uuid.test(job?.leaseToken||'')||!approvedAdmins.has(admin))throw Error('PURGE_AUTH_CONFIG_INVALID');
 const result=await db.query('select private.prepare_account_auth_purge($1,$2) state',[job.id,job.leaseToken]);
 const state=result?.rows?.[0]?.state;
 if(state?.stage!=='prepared'||!uuid.test(state?.userId||''))throw Error('PURGE_STATE_INVALID');
 const context=await db.query('select private.purge_journal_context($1,$2) context',[job.id,job.leaseToken]);
 const record=context?.rows?.[0]?.context;
 if(!record||record.userId!==state.userId||!uuid.test(record.requestId||''))throw Error('PURGE_STATE_INVALID');
 await recordPurgeIntent({...journal,requireCheckpoint:true,requestId:record.requestId,userId:record.userId});
 // Verifica de nuevo el lease antes del efecto externo; la operación permanece
 // bloqueada en estado de purga y la recuperación ya no está permitida.
 await db.query('select private.begin_account_purge($1,$2) state',[job.id,job.leaseToken]);
 const deleted=await admin.deleteUser(state.userId);
 if(deleted.error){
  const lookup=await admin.getUserById(state.userId);
  if(!lookup.error||!(lookup.error.status===404||lookup.error.code==='user_not_found'))throw Error('PURGE_AUTH_DELETE_FAILED');
 }
 const finished=await db.query('select private.finish_account_purge($1,$2) ok',[job.id,job.leaseToken]);
 if(finished?.rows?.[0]?.ok!==true)throw Error('PURGE_FINALIZE_FAILED');
}
