import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRestoreInternalFetch,isRestoreInternalFetch} from '../src/worker/purge-restore-internal-fetch.mjs';
import {createLocalPurgeAuthAdmin} from '../src/worker/purge-auth.mjs';
import {createScopedPurgeStorage} from '../src/worker/purge-storage-auth.mjs';

assert.throws(()=>createRestoreInternalFetch({projectId:'otro'}),/PURGE_RESTORE_INTERNAL_CONFIG_INVALID/);
const bridge=createRestoreInternalFetch();
assert.equal(isRestoreInternalFetch(bridge),true);
for(const [url,method] of [
 ['http://example.invalid/auth/v1/health','GET'],
 ['http://127.0.0.1:54321/auth/v1/admin/users','GET'],
 ['http://127.0.0.1:54321/auth/v1/admin/users/'+randomUUID(),'POST'],
 ['http://127.0.0.1:54321/storage/v1/bucket','DELETE'],
 ['http://127.0.0.1:54321/storage/v1/status?x=1','GET']
])await assert.rejects(()=>bridge(url,{method}),/PURGE_RESTORE_INTERNAL_SCOPE/);
assert.throws(()=>createLocalPurgeAuthAdmin({apiUrl:'http://127.0.0.1:54321',serviceRoleKey:'fixture',restoreFetch:()=>{}}),/PURGE_AUTH_CONFIG_INVALID/);
assert.throws(()=>createScopedPurgeStorage({apiUrl:'http://127.0.0.1:54321',anonKey:'fixture',jwtSecret:'fixture',userId:randomUUID(),jobId:randomUUID(),leaseToken:randomUUID(),leaseUntil:new Date(Date.now()+60000),restoreFetch:()=>{}}),/PURGE_STORAGE_CONFIG_INVALID/);
console.log('Z11 restauración: el canal interno rechaza destinos y métodos fuera de alcance: OK');
