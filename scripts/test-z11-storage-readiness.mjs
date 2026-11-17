import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializePurgeJournal,initializePurgeCheckpoint} from '../src/worker/purge-journal.mjs';
import {verifyLocalPurgeReadiness,runLocalPurgeJob} from '../src/worker/purge-local.mjs';

const dir=await mkdtemp(join(tmpdir(),'riuya-disk-check-'));
const journal={dir,key:randomBytes(32),anchorPath:dir+'.anchor',checkpointPath:dir+'.checkpoint'},keyPath=dir+'.key';
const env={RIUYA_PURGE_JOURNAL_DIR:dir,RIUYA_PURGE_JOURNAL_KEY_FILE:keyPath,RIUYA_PURGE_JOURNAL_ANCHOR_FILE:journal.anchorPath,RIUYA_PURGE_CHECKPOINT_FILE:journal.checkpointPath};
try{
 await initializePurgeJournal(journal);await initializePurgeCheckpoint(journal);await writeFile(keyPath,journal.key.toString('hex'),{flag:'wx'});
 let calls=0;const statusProvider=()=>{calls++;throw Error('STATUS_SHOULD_NOT_BE_READ');};
 await assert.rejects(()=>verifyLocalPurgeReadiness({env,statusProvider}),/PURGE_STORAGE_SAME_DISK/);
 await assert.rejects(()=>runLocalPurgeJob({env,statusProvider,db:{query(){calls++;}},job:{type:'account.purge',id:randomUUID(),leaseToken:randomUUID()}}),/PURGE_STORAGE_SAME_DISK/);
 assert.equal(calls,0);
 console.log('Z11 worker: mismo disco bloquea arranque y purga antes de acceder a Auth: OK');
}finally{
 await unlink(join(dir,'purges.ndjson')).catch(()=>{});
 await unlink(journal.anchorPath).catch(()=>{});
 await unlink(journal.checkpointPath).catch(()=>{});
 await unlink(keyPath).catch(()=>{});
 await rmdir(dir);
}
