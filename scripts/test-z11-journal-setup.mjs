import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,unlink,rmdir,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initializeLocalPurgeStorage} from '../src/worker/purge-local-initialize.mjs';
import {loadConfiguredPurgeJournal} from '../src/worker/purge-local-journal.mjs';

const root=await mkdtemp(join(tmpdir(),'riuya-setup-')),dir=join(root,'journal');
await mkdir(dir);
const env={RIUYA_PURGE_JOURNAL_DIR:dir,RIUYA_PURGE_JOURNAL_KEY_FILE:join(root,'key'),RIUYA_PURGE_JOURNAL_ANCHOR_FILE:join(root,'anchor'),RIUYA_PURGE_CHECKPOINT_FILE:join(root,'checkpoint')};
try{
 await assert.rejects(()=>initializeLocalPurgeStorage({env}),/PURGE_STORAGE_SAME_DISK/);
 assert.deepEqual(await readdir(root),['journal']);
 await assert.rejects(()=>initializeLocalPurgeStorage({env:{...env,RIUYA_PURGE_JOURNAL_ANCHOR_FILE:env.RIUYA_PURGE_JOURNAL_KEY_FILE},verifyStorage:()=>{}}),/PURGE_JOURNAL_CONFIG_INVALID/);
 assert.deepEqual(await readdir(root),['journal']);
 let checked=false;
 await initializeLocalPurgeStorage({env,verifyStorage:()=>{checked=true;}});
 assert.equal(checked,true);
 const {checkpoint}=await loadConfiguredPurgeJournal(env);assert.equal(checkpoint.count,0);
 const paths=[join(dir,'purges.ndjson'),env.RIUYA_PURGE_JOURNAL_KEY_FILE,env.RIUYA_PURGE_JOURNAL_ANCHOR_FILE,env.RIUYA_PURGE_CHECKPOINT_FILE];
 const before=await Promise.all(paths.map(path=>readFile(path)));
 await assert.rejects(()=>initializeLocalPurgeStorage({env,verifyStorage:()=>{}}),/PURGE_JOURNAL_ALREADY_EXISTS/);
 assert.deepEqual(await Promise.all(paths.map(path=>readFile(path))),before);
 console.log('Z11 inicialización: mismo disco bloqueado y archivos existentes conservados: OK');
}finally{
 await unlink(join(dir,'purges.ndjson')).catch(()=>{});
 await unlink(env.RIUYA_PURGE_JOURNAL_KEY_FILE).catch(()=>{});
 await unlink(env.RIUYA_PURGE_JOURNAL_ANCHOR_FILE).catch(()=>{});
 await unlink(env.RIUYA_PURGE_CHECKPOINT_FILE).catch(()=>{});
 await rmdir(dir);await rmdir(root);
}
