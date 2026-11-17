import {emitKeypressEvents} from 'node:readline';
import {createCustodyBackup,verifyCustodyBackup,restoreCustodyBackup} from '../src/worker/purge-custody-backup.mjs';

// La frase se introduce localmente, sin eco, argumentos ni variables de entorno.
async function promptSecret(label){
 const input=process.stdin,output=process.stderr;
 if(!input.isTTY||typeof input.setRawMode!=='function')throw Error('PURGE_BACKUP_TTY_REQUIRED');
 output.write(label);emitKeypressEvents(input);input.setRawMode(true);input.resume();
 return new Promise((resolve,reject)=>{
  let value='';
  const done=(error)=>{
   input.removeListener('keypress',onKey);input.setRawMode(false);input.pause();output.write('\n');
   if(error)reject(error);else resolve(value);
  };
  const onKey=(text,key={})=>{
   if(key.ctrl&&key.name==='c')return done(Error('PURGE_BACKUP_CANCELLED'));
   if(key.name==='return'||key.name==='enter')return done();
   if(key.name==='backspace'){value=[...value].slice(0,-1).join('');return;}
   if(!key.ctrl&&!key.meta&&text&&!/[\r\n\x00-\x1f\x7f]/.test(text)&&Buffer.byteLength(value+text)<=1024)value+=text;
  };
  input.on('keypress',onKey);
 });
}
try{
 const [action,path,...extra]=process.argv.slice(2);
 if(extra.length||!['crear','verificar','recuperar'].includes(action)||!path)throw Error('PURGE_BACKUP_CONFIG_INVALID');
 const first=await promptSecret('Frase de recuperación (mínimo 16 caracteres): ');
 if(action==='crear'){
  const second=await promptSecret('Repite la frase: ');
  if(first!==second)throw Error('PURGE_BACKUP_PASSPHRASE_MISMATCH');
  const result=await createCustodyBackup({path,passphrase:first});
  console.log('Copia cifrada creada y verificada. Entradas:',result.recorded);
  console.log('No incluye la base de datos, archivos de Storage ni el punto de control.');
 }else if(action==='verificar'){
  const result=await verifyCustodyBackup({path,passphrase:first});
  console.log('Copia cifrada válida. Entradas:',result.recorded);
  console.log('La validación no compara la copia con el punto de control vigente.');
 }else{
  const result=await restoreCustodyBackup({path,passphrase:first});
  console.log('Custodia recuperada en rutas nuevas. Entradas:',result.recorded);
  console.log('Revisa los permisos de la clave y mantén detenidos los servicios hasta completar la auditoría.');
 }
}catch(error){
 const code=typeof error?.message==='string'&&/^[A-Z0-9_]{1,64}$/.test(error.message)?error.message:'PURGE_BACKUP_FAILED';
 console.error('No se completó la operación:',code);
 console.error('No se eliminó ningún archivo; revisa cualquier copia parcial antes de reintentar.');
 process.exitCode=1;
}
