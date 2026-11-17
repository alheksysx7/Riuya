// Ensayo ficticio: no es una herramienta para respaldar datos reales.
import assert from 'node:assert/strict';
import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdtemp,open,realpath,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,relative,isAbsolute,sep} from 'node:path';
import {Readable,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const dir=await mkdtemp(join(tmpdir(),'riuya-z11-stream-lab-'));
const root=await realpath(tmpdir()),actual=await realpath(dir),rel=relative(root,actual);
if(!rel||rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)||!rel.startsWith('riuya-z11-stream-lab-'))throw Error('LAB_SCOPE_INVALID');
try{
 const path=join(actual,'fixture.enc'),key=randomBytes(32),iv=randomBytes(12);
 const aad=Buffer.from('riuya-z11-stream-fixture-v1');
 const block=Buffer.alloc(1024*1024,0x5a),expected=createHash('sha256');
 async function* fixture(){for(let i=0;i<64;i++){expected.update(block);yield block;}}
 const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(aad);
 await pipeline(Readable.from(fixture()),cipher,createWriteStream(path,{flags:'wx'}));
 const expectedDigest=expected.digest('hex'),tag=cipher.getAuthTag();
 const verify=async(secret,authTag,header=aad)=>{
  const decipher=createDecipheriv('aes-256-gcm',secret,iv);decipher.setAAD(header);decipher.setAuthTag(authTag);
  const hash=createHash('sha256');
  // Ningún contenido descifrado se escribe a disco ni se entrega antes de autenticar.
  const sink=new Writable({write(chunk,_encoding,callback){hash.update(chunk);callback();}});
  await pipeline(createReadStream(path),decipher,sink);
  return hash.digest('hex');
 };
 assert.equal(await verify(key,tag),expectedDigest);
 await assert.rejects(()=>verify(randomBytes(32),tag));
 await assert.rejects(()=>verify(key,tag,Buffer.from('riuya-z11-stream-fixture-v2')));
 const wrongTag=Buffer.from(tag);wrongTag[0]^=1;
 await assert.rejects(()=>verify(key,wrongTag));
 const file=await open(path,'r+');
 try{const byte=Buffer.alloc(1);await file.read(byte,0,1,0);byte[0]^=1;await file.write(byte,0,1,0);}finally{await file.close();}
 await assert.rejects(()=>verify(key,tag));
 const truncated=await open(path,'r+');
 try{const byte=Buffer.alloc(1);await truncated.read(byte,0,1,0);byte[0]^=1;await truncated.write(byte,0,1,0);
  const stat=await truncated.stat();await truncated.truncate(stat.size-1);}finally{await truncated.close();}
 await assert.rejects(()=>verify(key,tag));
 key.fill(0);
 console.log('Z11 laboratorio: cifrado y verificación por flujo de 64 MiB ficticios: OK');
}finally{
 await rm(actual,{recursive:true,force:false});
}
