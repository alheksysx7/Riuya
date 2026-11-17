import {initializeLocalPurgeStorage} from '../src/worker/purge-local-initialize.mjs';

// Uso explícito con rutas nuevas; no cambia permisos ni habilita la baja.
try{
 await initializeLocalPurgeStorage();
 console.log('Registro, sello, punto de control y clave inicializados.');
 console.log('Comprueba permisos de acceso, independencia física y copias antes de habilitar la baja.');
}catch(error){
 const code=typeof error?.message==='string'&&/^[A-Z0-9_]{1,64}$/.test(error.message)?error.message:'PURGE_JOURNAL_INITIALIZE_FAILED';
 console.error('No se pudo inicializar:',code);
 console.error('No se ha eliminado ningún archivo. Si hubo una interrupción, revisa los archivos creados antes de volver a intentar.');
 process.exitCode=1;
}
