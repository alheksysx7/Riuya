import {runLocalRestore} from '../src/worker/purge-restore-runner.mjs';

// Ejecutar solo tras restaurar en un entorno aislado y verificar todas las superficies.
try{
 if(process.argv.length!==3||process.argv[2]!=='--trafico-detenido')throw Error('PURGE_RESTORE_OFFLINE_REQUIRED');
 const report=await runLocalRestore({offline:true});
 console.log('Identidades registradas:',report.recorded);
 console.log('Sin datos detectados:',report.cleared);
 console.log('Reaplicación y auditoría completadas. Mantén el aislamiento hasta completar la revisión operativa.');
}catch(error){
 const code=typeof error?.message==='string'&&/^[A-Z0-9_]{1,64}$/.test(error.message)?error.message:'PURGE_RESTORE_FAILED';
 console.error('La reaplicación se detuvo:',code);
 process.exitCode=1;
}
