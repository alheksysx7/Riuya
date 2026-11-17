import {loadPurgeIntents} from '../src/worker/purge-journal.mjs';
let input='';for await(const part of process.stdin)input+=part;
const value=JSON.parse(input);
const records=await loadPurgeIntents({dir:value.dir,anchorPath:value.anchorPath,key:Buffer.from(value.key,'hex')});
process.stdout.write(String(records.length));
