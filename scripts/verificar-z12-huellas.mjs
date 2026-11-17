import {createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,relative,isAbsolute,sep} from 'node:path';

const args=process.argv.slice(2);
if(args.length>1||(args.length===1&&args[0]!=='--historico')){console.error('Uso: npm run z12:verificar-huellas [-- --historico]');process.exit(2);}
const root=await realpath(process.cwd());
const name=args[0]==='--historico'?'Z12_huellas_SHA256_2026-11-16.txt':'Z12_huellas_SHA256_2026-11-16_corte2.txt';
const manifest=resolve(root,'../docs/entregas',name);
let failed=0,total=0;
try{
 const lines=(await readFile(manifest,'utf8')).split(/\r?\n/).filter(Boolean);
 if(!lines.length)throw Error('EMPTY_MANIFEST');
 for(const line of lines){
  const match=/^([a-f0-9]{64})  app\/(.+)$/.exec(line);
  if(!match||match[2].includes('\\'))throw Error('INVALID_MANIFEST');
  const target=resolve(root,...match[2].split('/')),inside=relative(root,target);
  if(!inside||inside==='..'||inside.startsWith('..'+sep)||isAbsolute(inside))throw Error('INVALID_MANIFEST');
  total++;
  try{
   const actual=await realpath(target),actualRelative=relative(root,actual);
   if(!actualRelative||actualRelative==='..'||actualRelative.startsWith('..'+sep)||isAbsolute(actualRelative))throw Error('INVALID_TARGET');
   const digest=createHash('sha256').update(await readFile(actual)).digest('hex');
   if(digest!==match[1]){failed++;console.log('Modificado: app/'+match[2]);}
  }catch{failed++;console.log('No verificable: app/'+match[2]);}
 }
 console.log('Archivos verificados: '+total+'; diferencias: '+failed+'.');
 if(failed)process.exitCode=1;
}catch{console.error('No se pudo leer o validar la lista de huellas.');process.exitCode=1;}
