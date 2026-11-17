// Instrumentación del diagnóstico solo para el laboratorio desechable.
import {createRequire} from 'node:module';
const require=createRequire(process.env.RIUYA_LAB_APP_ENTRY),pg=require('pg'),Native=pg.Client;
const target=new URL(process.env.RIUYA_LAB_AUDIT_DB);
if(target.hostname!=='127.0.0.1'||target.port==='54322')throw Error('LAB_SCOPE_INVALID');
pg.Client=class extends Native{
 constructor(options){
  const original=new URL(options?.connectionString);
  if(original.hostname!=='127.0.0.1'||original.port!=='54322'||original.pathname!=='/postgres')throw Error('LAB_SCOPE_INVALID');
  super({connectionString:target.toString(),connectionTimeoutMillis:5000});
 }
};
