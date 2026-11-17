import {createCipheriv,createDecipheriv,createHash,createHmac,randomBytes,scrypt as scryptCallback,timingSafeEqual} from 'node:crypto';
import {open,readFile,realpath,lstat,readdir} from 'node:fs/promises';
import {basename,dirname,isAbsolute,join,relative,sep} from 'node:path';
import {promisify} from 'node:util';
import {execFileSync} from 'node:child_process';
import {loadConfiguredPurgeJournal} from './purge-local-journal.mjs';
import {loadCurrentPurgeIntents} from './purge-journal.mjs';
import {verifyPurgeStorageSeparation} from './purge-storage-readiness.mjs';

const scrypt=promisify(scryptCallback),maxJournal=16*1024*1024,maxArchive=32*1024*1024;
const enc=value=>Buffer.from(value).toString('base64url');
function decode(value,max){
 if(typeof value!=='string'||!/^[A-Za-z0-9_-]*$/.test(value)||value.length>max*2)throw Error('PURGE_BACKUP_INVALID');
 const bytes=Buffer.from(value,'base64url');
 if(bytes.length>max||enc(bytes)!==value)throw Error('PURGE_BACKUP_INVALID');
 return bytes;
}
function passwordValid(passphrase){
 return typeof passphrase==='string'&&[...passphrase].length>=16&&Buffer.byteLength(passphrase)<=1024;
}
function inside(dir,path){
 const rel=relative(dir,path);
 return !rel||(!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+sep));
}
function verifyPayload(value){
 if(value?.version!==1||!Number.isSafeInteger(value.count)||value.count<0)throw Error('PURGE_BACKUP_INVALID');
 const key=decode(value.key,32),journal=decode(value.journal,maxJournal),anchor=decode(value.anchor,1024);
 if(key.length!==32)throw Error('PURGE_BACKUP_INVALID');
 let seal;
 try{seal=JSON.parse(anchor.toString('utf8'));}catch{throw Error('PURGE_BACKUP_INVALID');}
 const digest=createHash('sha256').update(journal).digest('hex');
 const text=journal.toString('utf8');
 if(text&&(!text.endsWith('\n')||text.includes('\r')))throw Error('PURGE_BACKUP_INVALID');
 const count=text?text.slice(0,-1).split('\n').length:0;
 if(seal?.version!==2||seal.count!==count||value.count!==count||seal.digest!==digest||!/^[a-f0-9]{64}$/.test(seal.mac||''))throw Error('PURGE_BACKUP_INVALID');
 const mac=createHmac('sha256',key).update('riuya-journal-anchor-v2:'+count+':'+digest).digest();
 if(!timingSafeEqual(mac,Buffer.from(seal.mac,'hex')))throw Error('PURGE_BACKUP_INVALID');
 return {key,journal,anchor,count};
}
async function derive(passphrase,salt){
 if(!passwordValid(passphrase))throw Error('PURGE_BACKUP_PASSPHRASE_INVALID');
 return scrypt(passphrase,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
}
async function decryptArchive(bytes,passphrase){
 if(!Buffer.isBuffer(bytes)||bytes.length>maxArchive)throw Error('PURGE_BACKUP_INVALID');
 let archive;try{archive=JSON.parse(bytes.toString('utf8'));}catch{throw Error('PURGE_BACKUP_INVALID');}
 if(archive?.version!==1||archive.kdf!=='scrypt-32768-8-1'||archive.cipher!=='aes-256-gcm')throw Error('PURGE_BACKUP_INVALID');
 const salt=decode(archive.salt,16),iv=decode(archive.iv,12),tag=decode(archive.tag,16),ciphertext=decode(archive.ciphertext,maxArchive);
 if(salt.length!==16||iv.length!==12||tag.length!==16)throw Error('PURGE_BACKUP_INVALID');
 const header={version:1,kdf:archive.kdf,cipher:archive.cipher,salt:archive.salt,iv:archive.iv};
 const key=await derive(passphrase,salt);let plain;
 try{
  const decipher=createDecipheriv('aes-256-gcm',key,iv);decipher.setAAD(Buffer.from(JSON.stringify(header)));decipher.setAuthTag(tag);
  plain=Buffer.concat([decipher.update(ciphertext),decipher.final()]);
  return verifyPayload(JSON.parse(plain.toString('utf8')));
 }catch{throw Error('PURGE_BACKUP_INVALID');}
 finally{key.fill(0);if(plain)plain.fill(0);}
}
async function readBackup(path,passphrase){
 if(typeof path!=='string'||!isAbsolute(path))throw Error('PURGE_BACKUP_CONFIG_INVALID');
 const info=await lstat(path);
 if(!info.isFile()||info.isSymbolicLink()||info.size>maxArchive)throw Error('PURGE_BACKUP_INVALID');
 return decryptArchive(await readFile(path),passphrase);
}
export async function verifyCustodyBackup({path,passphrase}){
 const result=await readBackup(path,passphrase);
 const count=result.count;result.key.fill(0);result.journal.fill(0);result.anchor.fill(0);
 return {recorded:count};
}

// Copia únicamente la custodia; no incluye la base ni archivos de Storage.
export async function createCustodyBackup({env=process.env,path,passphrase,verifyStorage=verifyPurgeStorageSeparation}){
 if(typeof path!=='string'||!isAbsolute(path)||!passwordValid(passphrase))throw Error('PURGE_BACKUP_CONFIG_INVALID');
 const {journal,checkpoint}=await loadConfiguredPurgeJournal(env);
 const records=await loadCurrentPurgeIntents(journal);
 let parent;try{parent=await realpath(dirname(path));}catch{throw Error('PURGE_BACKUP_CONFIG_INVALID');}
 const output=join(parent,basename(path));
 if(inside(journal.dir,output))throw Error('PURGE_BACKUP_CONFIG_INVALID');
 await verifyStorage(journal);
 // La copia y el punto independiente no deben compartir disco.
 await verifyStorage({...journal,dir:parent,keyPath:parent,anchorPath:parent});
 const journalBytes=await readFile(join(journal.dir,'purges.ndjson')),anchorBytes=await readFile(journal.anchorPath);
 const payload={version:1,count:records.length,key:enc(journal.key),journal:enc(journalBytes),anchor:enc(anchorBytes)};
 const checked=verifyPayload(payload);checked.key.fill(0);checked.journal.fill(0);checked.anchor.fill(0);
 const after=await loadCurrentPurgeIntents(journal);
 if(JSON.stringify(records)!==JSON.stringify(after))throw Error('PURGE_BACKUP_JOURNAL_CHANGED');
 const salt=randomBytes(16),iv=randomBytes(12),header={version:1,kdf:'scrypt-32768-8-1',cipher:'aes-256-gcm',salt:enc(salt),iv:enc(iv)};
 const key=await derive(passphrase,salt),plain=Buffer.from(JSON.stringify(payload));let bytes;
 try{
  const cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(JSON.stringify(header)));
  const ciphertext=Buffer.concat([cipher.update(plain),cipher.final()]);
  bytes=Buffer.from(JSON.stringify({...header,tag:enc(cipher.getAuthTag()),ciphertext:enc(ciphertext)})+'\n');
 }finally{key.fill(0);plain.fill(0);journal.key.fill(0);}
 if(bytes.length>maxArchive)throw Error('PURGE_BACKUP_LIMIT');
 let file;
 try{file=await open(output,'wx',0o600);await file.writeFile(bytes);await file.sync();}
 catch{throw Error('PURGE_BACKUP_WRITE_FAILED');}
 finally{if(file)await file.close();}
 const result=await verifyCustodyBackup({path:output,passphrase});
 if(result.recorded!==records.length)throw Error('PURGE_BACKUP_INVALID');
 const latest=await loadConfiguredPurgeJournal(env);
 try{
  const finalRecords=await loadCurrentPurgeIntents(latest.journal);
  if(JSON.stringify(records)!==JSON.stringify(finalRecords)||JSON.stringify(checkpoint)!==JSON.stringify(latest.checkpoint))throw Error('PURGE_BACKUP_JOURNAL_CHANGED');
 }finally{latest.journal.key.fill(0);}
 return result;
}

function verifyCheckpointBytes(bytes,payload){
 let checkpoint;try{checkpoint=JSON.parse(bytes.toString('utf8'));}catch{throw Error('PURGE_BACKUP_CHECKPOINT_INVALID');}
 const digest=createHash('sha256').update(payload.journal).digest('hex');
 if(checkpoint?.version!==1||!Number.isSafeInteger(checkpoint.count)||checkpoint.count<0||
    !/^[a-f0-9]{64}$/.test(checkpoint.digest||'')||!/^[a-f0-9]{64}$/.test(checkpoint.mac||''))throw Error('PURGE_BACKUP_CHECKPOINT_INVALID');
 const mac=createHmac('sha256',payload.key).update('riuya-journal-checkpoint-v1:'+checkpoint.count+':'+checkpoint.digest).digest();
 if(!timingSafeEqual(mac,Buffer.from(checkpoint.mac,'hex')))throw Error('PURGE_BACKUP_CHECKPOINT_INVALID');
 if(checkpoint.count!==payload.count||checkpoint.digest!==digest)throw Error('PURGE_BACKUP_STALE');
}
async function checkpointBytes(path){
 const info=await lstat(path);
 if(!info.isFile()||info.isSymbolicLink()||info.size>1024)throw Error('PURGE_BACKUP_CHECKPOINT_INVALID');
 return readFile(path);
}
async function absent(path){
 try{await lstat(path);return false;}catch(error){if(error?.code==='ENOENT')return true;throw error;}
}
async function writeNew(path,bytes){
 let file;
 try{file=await open(path,'wx',0o600);await file.writeFile(bytes);await file.sync();}
 catch{throw Error('PURGE_BACKUP_RESTORE_FAILED');}
 finally{if(file)await file.close();}
}

// En Windows la opción mode de Node no crea por sí sola una ACL privada.
function protectRestoredKey(path){
 if(process.platform!=='win32'||!process.env.SystemRoot)throw Error('PURGE_BACKUP_KEY_ACL_UNAVAILABLE');
 const powershell=join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
 const command=`$ErrorActionPreference='Stop'; try {
  Import-Module (Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/Modules/Microsoft.PowerShell.Security/Microsoft.PowerShell.Security.psd1');
  $path=$env:RIUYA_RECOVERED_KEY_PATH; $acl=Get-Acl -LiteralPath $path;
  $acl.SetAccessRuleProtection($true,$false);
  $ids=@([System.Security.Principal.WindowsIdentity]::GetCurrent().User,
   [System.Security.Principal.SecurityIdentifier]::new('S-1-5-18'),
   [System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544'));
  foreach($id in $ids){ $rule=[System.Security.AccessControl.FileSystemAccessRule]::new($id,'FullControl','Allow'); [void]$acl.SetAccessRule($rule) }
  Set-Acl -LiteralPath $path -AclObject $acl;
  $check=Get-Acl -LiteralPath $path;
  $rules=@($check.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]));
  if(-not $check.AreAccessRulesProtected -or $rules.Count -ne 3){throw ('RULES '+$rules.Count)}
  foreach($id in $ids){if(-not @($rules | Where-Object { $_.IdentityReference.Value -eq $id.Value -and $_.AccessControlType -eq 'Allow' -and ($_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::FullControl) -eq [System.Security.AccessControl.FileSystemRights]::FullControl }).Count){throw ('MISSING '+$id.Value)}}
  exit 0
 } catch { exit 1 }`;
 try{execFileSync(powershell,['-NoProfile','-NonInteractive','-Command',command],{env:{...process.env,RIUYA_RECOVERED_KEY_PATH:path},stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:15000});}
 catch{throw Error('PURGE_BACKUP_KEY_ACL_UNAVAILABLE');}
}

// Restaura solo en rutas nuevas y nunca escribe el punto de control independiente.
export async function restoreCustodyBackup({env=process.env,path,passphrase,verifyStorage=verifyPurgeStorageSeparation}){
 const paths=[env.RIUYA_PURGE_JOURNAL_DIR,env.RIUYA_PURGE_JOURNAL_KEY_FILE,env.RIUYA_PURGE_JOURNAL_ANCHOR_FILE,env.RIUYA_PURGE_CHECKPOINT_FILE];
 if(paths.some(value=>typeof value!=='string'||!isAbsolute(value)))throw Error('PURGE_BACKUP_CONFIG_INVALID');
 const payload=await readBackup(path,passphrase);
 try{
  let dir,parents,checkpoint;
  try{
   dir=await realpath(paths[0]);parents=await Promise.all(paths.slice(1,3).map(value=>realpath(dirname(value))));
   const info=await lstat(paths[3]);if(!info.isFile()||info.isSymbolicLink())throw Error();
   checkpoint=await realpath(paths[3]);
  }catch{throw Error('PURGE_BACKUP_CONFIG_INVALID');}
  const keyPath=join(parents[0],basename(paths[1])),anchorPath=join(parents[1],basename(paths[2]));
  const normalize=value=>process.platform==='win32'?value.toLowerCase():value;
  if(new Set([keyPath,anchorPath,checkpoint].map(normalize)).size!==3||inside(dir,keyPath)||inside(dir,anchorPath)||inside(dir,checkpoint))throw Error('PURGE_BACKUP_CONFIG_INVALID');
  if((await readdir(dir)).length!==0||!(await absent(keyPath))||!(await absent(anchorPath)))throw Error('PURGE_JOURNAL_ALREADY_EXISTS');
  await verifyStorage({dir,keyPath:parents[0],anchorPath:parents[1],checkpointPath:checkpoint});
  const before=await checkpointBytes(checkpoint);verifyCheckpointBytes(before,payload);
  await writeNew(keyPath,Buffer.from(payload.key.toString('hex')+'\n'));
  protectRestoredKey(keyPath);
  await writeNew(join(dir,'purges.ndjson'),payload.journal);
  await writeNew(anchorPath,payload.anchor);
  const after=await checkpointBytes(checkpoint);
  if(!before.equals(after))throw Error('PURGE_BACKUP_CHECKPOINT_CHANGED');
  const restoredEnv={RIUYA_PURGE_JOURNAL_DIR:dir,RIUYA_PURGE_JOURNAL_KEY_FILE:keyPath,RIUYA_PURGE_JOURNAL_ANCHOR_FILE:anchorPath,RIUYA_PURGE_CHECKPOINT_FILE:checkpoint};
  const {journal}=await loadConfiguredPurgeJournal(restoredEnv);
  const records=await loadCurrentPurgeIntents(journal);journal.key.fill(0);
  if(records.length!==payload.count)throw Error('PURGE_BACKUP_INVALID');
  return {recorded:payload.count};
 }finally{payload.key.fill(0);payload.journal.fill(0);payload.anchor.fill(0);}
}
