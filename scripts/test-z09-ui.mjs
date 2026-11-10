import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';import {spawn,execFileSync} from 'node:child_process';import assert from 'node:assert/strict';
const require=createRequire('C:/Users/LINKX7/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/');const {chromium}=require('playwright');
const c=Object.fromEntries(readFileSync('.env.editor-local','utf8').split(/\r?\n/).filter(x=>x.startsWith('EDITOR_')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)];}));
const worker=spawn(process.execPath,['scripts/worker-local.mjs'],{stdio:'ignore',windowsHide:true});const b=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});let id;
try{
 const p=await b.newPage();await p.goto('http://127.0.0.1:3102/admin');await p.getByLabel('Correo').fill(c.EDITOR_EMAIL);await p.getByLabel('Contraseña').fill(c.EDITOR_PASSWORD);await p.getByRole('button',{name:'Entrar'}).click();await p.getByRole('heading',{name:'Mesa editorial'}).waitFor();
 const before=await p.locator('[data-job-id]').evaluateAll(items=>items.map(x=>x.dataset.jobId));
 const publications=await p.locator('nav[aria-label="Noticias"] li').count();
 await p.getByRole('button',{name:'Crear propuesta ficticia'}).click();await p.getByText('Trabajo ficticio en cola.',{exact:false}).waitFor();
 for(let n=0;n<15;n++){const all=await p.locator('[data-job-id]').evaluateAll(items=>items.map(x=>x.dataset.jobId));id=all.find(x=>!before.includes(x));if(id&&await p.locator('[data-job-id="'+id+'"]').innerText().then(t=>t.includes('terminado')))break;await p.waitForTimeout(1000);await p.reload();}
 assert(id&&/^[0-9a-f-]{36}$/.test(id));const row=p.locator('[data-job-id="'+id+'"]');await row.getByText('SIMULACIÓN · terminado').waitFor();await row.getByText('Revisar propuesta ficticia').click();await row.getByText('SIMULACIÓN · Propuesta editorial local').waitFor();assert.equal(await row.locator('details li').count(),8);assert.equal(await p.locator('nav[aria-label="Noticias"] li').count(),publications);
 console.log('Z09 fixture: cola, worker, ocho voces y ninguna publicación automática: OK');
}finally{
 worker.kill();await b.close();
 if(id&&/^[0-9a-f-]{36}$/.test(id))execFileSync('docker',['exec','-i','supabase_db_app','psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:`delete from private.generation_runs where job_id='${id}';delete from private.jobs where id='${id}';`,stdio:'pipe'});
}
