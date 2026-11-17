import {execFileSync} from 'node:child_process';
import {join} from 'node:path';

// Es una comprobación mínima de discos lógicos; no certifica independencia física.
export function verifyPurgeStorageSeparation(journal){
 if(process.platform!=='win32'||!process.env.SystemRoot)throw Error('PURGE_STORAGE_CHECK_UNAVAILABLE');
 const powershell=join(process.env.SystemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
 const command=`$ErrorActionPreference='Stop'; try {
  $journal = @(Get-Partition -Volume (Get-Volume -FilePath $env:RIUYA_CHECK_JOURNAL_PATH));
  $key = @(Get-Partition -Volume (Get-Volume -FilePath $env:RIUYA_CHECK_KEY_PATH));
  $anchor = @(Get-Partition -Volume (Get-Volume -FilePath $env:RIUYA_CHECK_ANCHOR_PATH));
  $checkpoint = @(Get-Partition -Volume (Get-Volume -FilePath $env:RIUYA_CHECK_CHECKPOINT_PATH));
  if ($journal.Count -ne 1 -or $key.Count -ne 1 -or $anchor.Count -ne 1 -or $checkpoint.Count -ne 1) { exit 1 }
  if ($journal[0].DiskNumber -eq $checkpoint[0].DiskNumber) { exit 2 }
  if ($key[0].DiskNumber -eq $checkpoint[0].DiskNumber) { exit 3 }
  if ($anchor[0].DiskNumber -eq $checkpoint[0].DiskNumber) { exit 4 }
  exit 0
 } catch { exit 1 }`;
 try{
  execFileSync(powershell,['-NoProfile','-NonInteractive','-Command',command],{
   env:{...process.env,RIUYA_CHECK_JOURNAL_PATH:journal.dir,RIUYA_CHECK_KEY_PATH:journal.keyPath,RIUYA_CHECK_ANCHOR_PATH:journal.anchorPath,RIUYA_CHECK_CHECKPOINT_PATH:journal.checkpointPath},
   stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:15000});
 }catch(error){
  if(error?.status===2)throw Error('PURGE_STORAGE_SAME_DISK');
  if(error?.status===3)throw Error('PURGE_KEY_SAME_DISK');
  if(error?.status===4)throw Error('PURGE_ANCHOR_SAME_DISK');
  throw Error('PURGE_STORAGE_CHECK_UNAVAILABLE');
 }
}
