import {checkRecoveryReadiness} from '../src/worker/purge-recovery-readiness.mjs';

// No restaura datos ni controla los servicios.
try{
 const result=await checkRecoveryReadiness();
 if(result.stage==='isolation'){
  console.error('Las superficies locales comprobadas no están aisladas.');
  for(const item of result.blockers)console.error('-',item);
 }else{
  console.log('Identidades registradas:',result.report.recorded);
  console.log('Pendientes:',result.report.remaining);
  console.log('Inconsistentes:',result.report.inconsistent);
  console.log('Archivos sin propietario verificable:',result.unattributed?'sí':'no');
 }
 if(!result.checksPassed)process.exitCode=2;
 else console.log('Las comprobaciones conocidas no encontraron bloqueos.');
 console.log('La verificación no controla todos los accesos ni autoriza por sí sola la reapertura.');
}catch(error){
 const code=typeof error?.message==='string'&&/^[A-Z0-9_]{1,64}$/.test(error.message)?error.message:'PURGE_RECOVERY_CHECK_FAILED';
 console.error('No se pudo completar la verificación:',code);process.exitCode=1;
}
