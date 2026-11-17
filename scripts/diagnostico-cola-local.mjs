import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import pg from 'pg';
import {collectDiagnostics,validateLocalTarget} from './local-diagnostics.mjs';

let db;
try{
 const cli=resolve('node_modules/supabase/dist/supabase.js');
 const raw=execFileSync(process.execPath,[cli,'status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore'],windowsHide:true,timeout:15000,maxBuffer:1024*1024});
 const target=validateLocalTarget(JSON.parse(raw));
 db=new pg.Client({connectionString:target,connectionTimeoutMillis:4000,query_timeout:8000});
 await db.connect();
 console.log(JSON.stringify(await collectDiagnostics(db),null,2));
}catch{
 console.error('No se pudo consultar el diagnóstico local. Verifica que Supabase local esté activo y actualizado.');
 process.exitCode=1;
}finally{if(db)await db.end().catch(()=>{});}
