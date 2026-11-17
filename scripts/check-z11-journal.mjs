import {loadConfiguredPurgeJournal} from '../src/worker/purge-local-journal.mjs';
import {loadPurgeIntents} from '../src/worker/purge-journal.mjs';

// Diagnóstico de solo lectura. Ejecutar con el worker y la aplicación detenidos.
try{
 const {journal,checkpoint}=await loadConfiguredPurgeJournal();
 const records=await loadPurgeIntents(journal);
 console.log('Registro y sello: válidos.');
 console.log('Entradas verificadas:',records.length);
 console.log('Entradas del punto de control:',checkpoint.count);
 if(checkpoint.count!==records.length){
  console.error('El punto de control está atrasado. Mantén la restauración detenida y revisa la causa.');
  process.exitCode=2;
 }else{
  console.log('El punto de control coincide con el registro.');
  console.log('Esta comprobación no verifica separación física, durabilidad ni ausencia de tráfico.');
 }
}catch(error){
 const code=typeof error?.message==='string'&&/^[A-Z0-9_]{1,64}$/.test(error.message)?error.message:'PURGE_DIAGNOSTIC_FAILED';
 console.error('No se pudo verificar el registro:',code);
 process.exitCode=1;
}
