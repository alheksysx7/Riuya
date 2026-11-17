import {existsSync,readFileSync} from 'node:fs';
import pg from 'pg';
import {runWorker} from '../src/worker/worker-runtime.mjs';

const raw=readFileSync('.env.worker.local','utf8');
const m=raw.match(/^RIUYA_WORKER_PASSWORD=([a-f0-9]{64})$/m);
if(!m)throw Error('Ejecuta primero npm run worker:setup');
const configuredTransport=process.env.NOTIFICATION_TRANSPORT||(existsSync('.env.local')?readFileSync('.env.local','utf8').match(/^\s*NOTIFICATION_TRANSPORT\s*=\s*([^\s#]+)\s*$/m)?.[1]:null)||'local';
if(configuredTransport!=='local')throw Error('Solo está disponible el transporte local.');
const connection={host:'127.0.0.1',port:54322,user:'riuya_worker_local',password:m[1],database:'postgres',connectionTimeoutMillis:5000};
await runWorker({client:new pg.Client(connection),scheduler:new pg.Client(connection),connection,purgeEnabled:process.env.RIUYA_PURGE_ENABLED==='1'});
