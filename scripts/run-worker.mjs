import {spawn,spawnSync} from 'node:child_process';import {existsSync,readFileSync} from 'node:fs';import {dirname,join,resolve} from 'node:path';import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),wanted=readFileSync(join(root,'.node-version'),'utf8').trim();
const nvm=process.env.NVM_HOME&&join(process.env.NVM_HOME,'v'+wanted,'node.exe');
const node=process.env.RIUYA_NODE||(process.versions.node===wanted?process.execPath:nvm&&existsSync(nvm)?nvm:null);
if(!node||!existsSync(node)){console.error('No se encontró Node '+wanted+'. Selecciónalo con NVM o indica RIUYA_NODE.');process.exit(1);}
const check=spawnSync(node,['--version'],{encoding:'utf8',windowsHide:true});if(check.status!==0||check.stdout.trim()!=='v'+wanted){console.error('El worker requiere Node '+wanted+'.');process.exit(1);}
const child=spawn(node,[join(root,'scripts','worker-local.mjs')],{cwd:root,stdio:'inherit',windowsHide:true});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(!child.killed)child.kill(signal);});
child.on('error',()=>{console.error('No se pudo iniciar el worker.');process.exitCode=1;});
child.on('exit',(code,signal)=>{if(!signal&&code)process.exitCode=code;});
