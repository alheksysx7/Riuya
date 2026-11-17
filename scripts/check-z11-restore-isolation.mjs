import {checkLocalRestoreIsolation} from '../src/worker/purge-restore-isolation-local.mjs';

try{
 const result=await checkLocalRestoreIsolation();
 if(result.blocked){console.error('No se cumplen las condiciones locales comprobadas:');for(const item of result.blockers)console.error('-',item);process.exitCode=2;}
 else console.log('Las superficies locales comprobadas no muestran bloqueos.');
 console.log('Esto no verifica otros puertos, procesos, redes ni custodia física; no autoriza por sí solo la restauración.');
}catch(error){
 const code=typeof error?.message==='string'&&/^[A-Z0-9_]{1,64}$/.test(error.message)?error.message:'RESTORE_ISOLATION_UNKNOWN';
 console.error('No se pudo comprobar el aislamiento:',code);process.exitCode=1;
}
