import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
import {probeLoad} from './probe-z12-load.mjs';
import {probeTextReader} from './probe-z12-text-reader.mjs';
import {probeOffline} from './probe-z12-offline.mjs';
import {probeBackendOutage} from './probe-z12-backend-outage.mjs';
import {probeUncertainNetwork} from './probe-z12-uncertain-network.mjs';
import {probeUncertainResults} from './probe-z12-uncertain-results.mjs';
import {probeCacheIsolation} from './probe-z12-cache-isolation.mjs';
import {probeBrowserFont} from './probe-z12-browser-font.mjs';
import {probeTransparency} from './probe-z12-transparency.mjs';
import {probeArticleContrast} from './probe-z12-article-contrast.mjs';
import {probeFixture} from './probe-z12-fixture.mjs';
import {probeSurfaceContrast} from './probe-z12-surface-contrast.mjs';

const require=createRequire('C:/Users/LINKX7/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/');
const {chromium}=require('playwright');

// La interfaz, la base y la cola pertenecen exclusivamente al proyecto temporal.
export async function probeLabEditorialUi({status,dir,id,appPort,setupLabWorker}){
 const api=new URL(status.API_URL),dbUrl=new URL(status.DB_URL);
 if(!/^riuya_z11_lab_[a-f0-9]{20}$/.test(id)||api.hostname!=='127.0.0.1'||api.port==='54321'||
  dbUrl.hostname!=='127.0.0.1'||dbUrl.port==='54322'||!Number.isInteger(appPort)||appPort<1024||appPort>65535||
  typeof setupLabWorker!=='function')throw Error('LAB_SCOPE_INVALID');
 const suffix=id.slice(-20),image='riuya-z12-ui-'+suffix+':test',container='riuya_z12_ui_'+suffix;
 const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const db=new pg.Client({connectionString:status.DB_URL}),password=randomBytes(32).toString('hex'),editorPassword=randomBytes(32).toString('hex');
 const working=join(dir,'editorial-ui');await mkdir(working);
 await writeFile(join(working,'.env.worker.local'),'RIUYA_WORKER_PASSWORD='+password+'\n',{flag:'wx'});
 await setupLabWorker(password);
 const created=await admin.auth.admin.createUser({email:'z12-ui-'+randomUUID()+'@example.invalid',password:editorPassword,email_confirm:true});
 if(created.error||!created.data.user)throw Error('LAB_EDITOR_CREATE');
 await db.connect();
 let worker,browser,imageBuilt=false,containerStarted=false;
 const docker=args=>{try{return execFileSync('docker',args,{encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true,timeout:240000,maxBuffer:8*1024*1024}).trim();}catch{throw Error('LAB_UI_DOCKER_FAILED');}};
 try{
  const editor=created.data.user;
  await db.query('insert into private.profiles(id) values($1) on conflict(id) do nothing',[editor.id]);
  await db.query("insert into private.user_roles(user_id,role) values($1,'editor') on conflict do nothing",[editor.id]);
  assert.equal((await db.query("select count(*)::int n from private.jobs where status in ('queued','running')")).rows[0].n,0);
  docker(['build','--build-arg','NEXT_PUBLIC_SUPABASE_URL=http://host.docker.internal:'+api.port,
   '--build-arg','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='+status.ANON_KEY,'-t',image,'.']);imageBuilt=true;
  docker(['run','-d','--rm','--name',container,'-p','127.0.0.1:'+appPort+':3000',
   '-e','APP_ORIGIN=http://127.0.0.1:'+appPort,'-e','RIUYA_ENABLE_ACCOUNT_DELETION=0',image]);containerStarted=true;
  let ready=false;
  for(let i=0;i<80&&!ready;i++){try{ready=(await fetch('http://127.0.0.1:'+appPort+'/api/health/ready',{signal:AbortSignal.timeout(1000)})).ok;}catch{}if(!ready)await new Promise(resolve=>setTimeout(resolve,250));}
  if(!ready)throw Error('LAB_UI_NOT_READY');
  browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const page=await browser.newPage();await page.goto('http://127.0.0.1:'+appPort+'/admin');
  await page.getByLabel('Correo').fill(editor.email);await page.getByLabel('Contraseña').fill(editorPassword);
  await page.getByRole('button',{name:'Entrar'}).click();await page.getByRole('heading',{name:'Mesa editorial'}).waitFor();
  const activityStatus=await page.evaluate(async()=>({activity:(await fetch('/api/v1/me/activity')).status,trends:(await fetch('/api/v1/me/trends')).status}));
  assert.deepEqual(activityStatus,{activity:200,trends:200});
  const apiEvents=docker(['logs',container]).split('\n').flatMap(line=>{try{const event=JSON.parse(line);return event.event==='api.request'?[event]:[];}catch{return [];}});
  for(const route of ['/api/v1/me/activity','/api/v1/me/trends'])assert(apiEvents.some(event=>event.route===route&&event.status===200));
  assert(!JSON.stringify(apiEvents).includes(editor.email));
  const before=await page.locator('[data-job-id]').evaluateAll(items=>items.map(x=>x.dataset.jobId));
  const publications=await page.locator('nav[aria-label="Noticias"] li').count();
  await page.getByRole('button',{name:'Crear propuesta ficticia'}).click();
  await page.getByText('Trabajo ficticio en cola.',{exact:false}).waitFor();
  let jobId;
  for(let i=0;i<20&&!jobId;i++){
   const ids=await page.locator('[data-job-id]').evaluateAll(items=>items.map(x=>x.dataset.jobId));
   jobId=ids.find(x=>!before.includes(x));if(!jobId){await new Promise(resolve=>setTimeout(resolve,200));await page.reload();}
  }
  if(!jobId||!/^[a-f0-9-]{36}$/.test(jobId))throw Error('LAB_UI_JOB_MISSING');
  const workerUrl=new URL(status.DB_URL);workerUrl.username='riuya_worker_local';workerUrl.password=password;
  const entry=resolve('scripts/worker-local.mjs'),preload=resolve('scripts/probe-z11-worker-preload.mjs');
  worker=spawn(process.execPath,['--import',pathToFileURL(preload).href,entry],{cwd:working,windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],
   env:{...process.env,RIUYA_LAB_APP_ENTRY:entry,RIUYA_LAB_WORKER_DB:workerUrl.toString(),RIUYA_LAB_API:status.API_URL,RIUYA_PURGE_ENABLED:'0',NOTIFICATION_TRANSPORT:'local'}});
  let exited=false;const exit=new Promise(resolve=>worker.on('exit',code=>{exited=true;resolve(code);}));
  let done=false;
  for(let i=0;i<100&&!done&&!exited;i++){
   done=(await db.query("select exists(select 1 from private.jobs where id=$1 and status='succeeded') ok",[jobId])).rows[0].ok;
   if(!done)await new Promise(resolve=>setTimeout(resolve,200));
  }
  assert.equal(done,true,'LAB_UI_WORKER_FAILED');
  await page.reload();const row=page.locator('[data-job-id="'+jobId+'"]');
  await row.getByText('SIMULACIÓN · terminado').waitFor();await row.getByText('Revisar propuesta ficticia').click();
  await row.getByText('SIMULACIÓN · Propuesta editorial local').waitFor();
  assert.equal(await row.locator('details li').count(),8);
  assert.equal(await page.locator('nav[aria-label="Noticias"] li').count(),publications);
  worker.send('stop');const code=await Promise.race([exit,new Promise((_,reject)=>setTimeout(()=>reject(Error('LAB_UI_STOP_TIMEOUT')),7000))]);
  assert.equal(code,0);worker=null;
  const article=await probeTextReader({db,browser,id,appPort,authenticatedPage:page});
  await probeBrowserFont({chromium,authenticatedPage:page,id,appPort,article});
  await probeTransparency({browser,id,appPort,article});
  await probeArticleContrast({browser,id,appPort,article});
  await probeSurfaceContrast({browser,authenticatedPage:page,id,appPort,article});
  await probeOffline({browser,authenticatedPage:page,id,appPort});
  await probeBackendOutage({page,id,appPort,article,stopBackend:()=>docker(['stop','supabase_kong_'+id]),startBackend:()=>docker(['start','supabase_kong_'+id])});
  await probeUncertainNetwork({db,browser,authenticatedPage:page,id,appPort,userId:editor.id});
  await probeUncertainResults({db,browser,authenticatedPage:page,id,appPort,userId:editor.id});
  await probeCacheIsolation({db,browser,authenticatedPage:page,id,appPort,userId:editor.id,admin});
  await probeFixture({db,id});
  if(process.env.RIUYA_LAB_LOAD_WEB==='1')await probeLoad({status,id,appPort});
  console.log('Z12 laboratorio: interfaz editorial, worker y ocho voces sin publicación automática: OK');
 }finally{
  if(worker&&worker.exitCode===null&&worker.signalCode===null){worker.kill();await new Promise(resolve=>worker.once('exit',resolve));}
  if(browser)await browser.close();
  if(containerStarted)docker(['stop',container]);
  if(imageBuilt)docker(['image','rm',image]);
  await db.end();
 }
}
