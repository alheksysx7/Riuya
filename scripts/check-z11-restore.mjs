import pg from 'pg';
import {loadConfiguredPurgeJournal} from '../src/worker/purge-local-journal.mjs';
import {loadCurrentPurgeIntents} from '../src/worker/purge-journal.mjs';
import {inspectRestorePurges,hasUnattributedRestoreStorage} from '../src/worker/purge-restore-audit.mjs';

// Diagnóstico de solo lectura; no controla el tráfico ni autoriza la reapertura.
let db;
try{
 const raw=process.env.RIUYA_RESTORE_AUDIT_DATABASE_URL;
 let target;
 try{target=new URL(raw);}catch{throw Error('RESTORE_AUDIT_DATABASE_INVALID');}
 if(!['postgres:','postgresql:'].includes(target.protocol)||target.hostname!=='127.0.0.1'||target.port!=='54322'||target.pathname!=='/postgres'||target.search||target.hash)throw Error('RESTORE_AUDIT_DATABASE_INVALID');
 const {journal}=await loadConfiguredPurgeJournal();
 await loadCurrentPurgeIntents(journal);
 db=new pg.Client({connectionString:raw,connectionTimeoutMillis:5000});
 await db.connect();
 await db.query('begin isolation level repeatable read read only');
 await db.query('set local role riuya_restore_auditor');
 const report=await inspectRestorePurges({db,journal});
 const unattributed=await hasUnattributedRestoreStorage({db,journal});
 await db.query('rollback');
 console.log('Identidades registradas:',report.recorded);
 console.log('Sin datos detectados:',report.cleared);
 console.log('Pendientes:',report.remaining);
 console.log('Inconsistentes:',report.inconsistent);
 console.log('Archivos sin propietario verificable:',unattributed?'sí':'no');
 if(!report.ready||unattributed){console.error('Hay bajas o inconsistencias por resolver.');process.exitCode=2;}
 else console.log('La auditoría no encontró bajas pendientes ni inconsistencias atribuibles.');
 console.log('El diagnóstico no controla el tráfico ni verifica custodia física; no autoriza por sí solo la reapertura.');
}catch(error){
 const code=typeof error?.message==='string'&&/^[A-Z0-9_]{1,64}$/.test(error.message)?error.message:'RESTORE_AUDIT_FAILED';
 console.error('No se pudo completar la auditoría:',code);
 process.exitCode=1;
}finally{
 if(db){await db.query('rollback').catch(()=>{});await db.end().catch(()=>{});}
}
