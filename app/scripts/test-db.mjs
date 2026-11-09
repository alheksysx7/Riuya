import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const sql=readFileSync(new URL('../supabase/tests/z01_catalogos.sql',import.meta.url));
const r=spawnSync(process.platform==='win32'?'docker.exe':'docker',['exec','-i','supabase_db_app','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:sql,stdio:['pipe','inherit','inherit']});
if(r.error) console.error(r.error.message);
process.exitCode=r.status??1;
