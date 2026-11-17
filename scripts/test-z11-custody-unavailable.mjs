import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,lstat} from 'node:fs/promises';
import {join} from 'node:path';
import {loadConfiguredPurgeJournal} from '../src/worker/purge-local-journal.mjs';
import {verifyLocalPurgeReadiness,runLocalPurgeJob} from '../src/worker/purge-local.mjs';
import {verifyPurgeStorageSeparation} from '../src/worker/purge-storage-readiness.mjs';

// Solo lectura; simula ausencia usando una ruta que nunca se crea.
const env=process.env,{journal}=await loadConfiguredPurgeJournal(env);
const paths=[join(journal.dir,'purges.ndjson'),journal.anchorPath,journal.checkpointPath];
const digest=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
const before=await Promise.all(paths.map(digest));
const status={API_URL:'http://127.0.0.1:54321',DB_URL:'postgresql://fixture@127.0.0.1:54322/postgres',ANON_KEY:'fixture',JWT_SECRET:'fixture',SERVICE_ROLE_KEY:'fixture'};
await verifyLocalPurgeReadiness({env,statusProvider:()=>status});
assert.throws(()=>verifyPurgeStorageSeparation({...journal,keyPath:journal.checkpointPath}),/PURGE_KEY_SAME_DISK/);
assert.throws(()=>verifyPurgeStorageSeparation({...journal,anchorPath:journal.checkpointPath}),/PURGE_ANCHOR_SAME_DISK/);
const missing=journal.checkpointPath+'.no-existe-'+randomUUID();
try{await lstat(missing);throw Error('TEST_PATH_EXISTS');}catch(error){if(error.code!=='ENOENT')throw error;}
const unavailable={...env,RIUYA_PURGE_CHECKPOINT_FILE:missing};
let calls=0;
const statusProvider=()=>{calls++;return status;};
await assert.rejects(()=>verifyLocalPurgeReadiness({env:unavailable,statusProvider}),/PURGE_JOURNAL_CONFIG_INVALID/);
await assert.rejects(()=>runLocalPurgeJob({env:unavailable,statusProvider,db:{query(){calls++;}},job:{type:'account.purge',id:randomUUID(),leaseToken:randomUUID()}}),/PURGE_JOURNAL_CONFIG_INVALID/);
assert.equal(calls,0);
assert.deepEqual(await Promise.all(paths.map(digest)),before);
console.log('Z11 custodia: ausencia simulada bloquea la purga; archivos sin cambios: OK');
