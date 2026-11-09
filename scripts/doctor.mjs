import { spawnSync } from 'node:child_process';
let failed=false;
const major=Number(process.versions.node.split('.')[0]);
if(major!==24){console.error('Node 24 requerido; versión actual: '+process.versions.node);failed=true}else console.log('Node: '+process.versions.node);
const docker=spawnSync('docker',['info','--format','{{.ServerVersion}}'],{encoding:'utf8',shell:false});
if(docker.status!==0){console.error('Docker no está disponible. Inicia Docker Desktop y vuelve a intentar.');failed=true}else console.log('Docker: '+docker.stdout.trim());
const url='http://127.0.0.1:54321/auth/v1/health';
try{const r=await fetch(url,{signal:AbortSignal.timeout(3000)});if(!r.ok)throw Error(String(r.status));console.log('Supabase local: disponible')}catch{console.error('Supabase local no responde en '+url);failed=true}
process.exitCode=failed?1:0;
