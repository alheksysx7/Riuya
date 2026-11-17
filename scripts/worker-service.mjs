import pg from 'pg';
import {runWorker} from '../src/worker/worker-runtime.mjs';
import {workerServiceConfig,verifyWorkerServiceRole} from '../src/worker/worker-service-config.mjs';

try{
 const connection=workerServiceConfig(process.env);
 await runWorker({client:new pg.Client(connection),scheduler:new pg.Client(connection),connection,
  purgeEnabled:false,verify:verifyWorkerServiceRole,prefix:'service'});
}catch{
 // Los detalles de conexión pueden contener credenciales.
 console.error('No se pudo iniciar o continuar el worker; revisa su configuración y permisos.');
 process.exitCode=1;
}
