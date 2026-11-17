import {createHmac} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {isRestoreInternalFetch} from './purge-restore-internal-fetch.mjs';

const scopedInstances=new WeakMap();
export const isScopedPurgeStorage=(value,job)=>{const scope=value&&scopedInstances.get(value);return !!scope&&scope.jobId===job?.id&&scope.leaseToken===job?.leaseToken;};

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Uso exclusivo del proceso local de purga. Nunca enviar el secreto al navegador.
export function createScopedPurgeStorage({apiUrl,anonKey,jwtSecret,userId,jobId,leaseToken,leaseUntil,restoreFetch}){
 if(apiUrl!=='http://127.0.0.1:54321'||typeof anonKey!=='string'||!anonKey||typeof jwtSecret!=='string'||!jwtSecret||
    (restoreFetch&&!isRestoreInternalFetch(restoreFetch))||!uuid.test(userId||'')||!uuid.test(jobId||'')||!uuid.test(leaseToken||''))throw Error('PURGE_STORAGE_CONFIG_INVALID');
 const now=Math.floor(Date.now()/1000);
 const deadline=Math.floor(new Date(leaseUntil).getTime()/1000);
 const exp=Math.min(now+30,deadline-1);
 if(!Number.isFinite(deadline)||exp<=now+2)throw Error('PURGE_LEASE_INVALID');
 const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const header=encode({alg:'HS256',typ:'JWT'});
 const payload=encode({role:'riuya_storage_purger',sub:userId,purge_job:jobId,purge_lease:leaseToken,iat:now,exp});
 const signature=createHmac('sha256',jwtSecret).update(header+'.'+payload).digest('base64url');
 const token=header+'.'+payload+'.'+signature;
 const storage=createClient(apiUrl,anonKey,{global:{headers:{Authorization:'Bearer '+token},...(restoreFetch?{fetch:restoreFetch}:{})},auth:{persistSession:false,autoRefreshToken:false}}).storage;
 scopedInstances.set(storage,{jobId,leaseToken});
 return storage;
}
