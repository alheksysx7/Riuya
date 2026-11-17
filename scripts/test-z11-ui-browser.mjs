import {execFileSync,spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdtemp,cp,symlink,lstat,realpath,unlink,rm,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep,basename} from 'node:path';
import {createServer} from 'node:net';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import pg from 'pg';
import {createClient} from '@supabase/supabase-js';
const require=createRequire('C:/Users/LINKX7/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/');
const {chromium}=require('playwright');
const status=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
if(status.API_URL!=='http://127.0.0.1:54321'||!status.DB_URL?.includes('127.0.0.1:54322'))throw Error('Solo entorno local');
const db=new pg.Client({connectionString:status.DB_URL}),admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const temp=await mkdtemp(join(tmpdir(),'riuya-z11-ui-')),ids=[];let browser,server,connected=false,junction=false,serverLog='',lastStatus=0;const browserErrors=[];
async function freePort(){const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port;}
async function noLinks(path){for(const entry of await readdir(path,{withFileTypes:true})){const p=join(path,entry.name);const st=await lstat(p);if(st.isSymbolicLink())throw Error('TEST_TEMP_LINK');if(st.isDirectory())await noLinks(p);}}
try{
 await db.connect();connected=true;
 const rights=await db.query("select has_function_privilege('authenticated','api.request_account_deletion()','execute') deletion,has_function_privilege('authenticated','api.recover_account_deletion()','execute') recovery");
 if(rights.rows[0].deletion||rights.rows[0].recovery)throw Error('TEST_REQUIRES_DISABLED_RPC');
 const port=await freePort(),base='http://localhost:'+port;
 await cp('src',join(temp,'src'),{recursive:true});await cp('public',join(temp,'public'),{recursive:true});
 for(const file of ['package.json','tsconfig.json','next.config.ts','postcss.config.mjs','.env.local'])await cp(file,join(temp,file));
 await symlink(resolve('node_modules'),join(temp,'node_modules'),'junction');junction=true;
 server=spawn(process.execPath,[join(temp,'node_modules','next','dist','bin','next'),'dev','--webpack','-p',String(port)],{cwd:temp,env:{...process.env,RIUYA_ENABLE_ACCOUNT_DELETION:'1',APP_ORIGIN:base},stdio:['ignore','pipe','pipe'],windowsHide:true});
 server.stdout.on('data',chunk=>{serverLog=(serverLog+chunk.toString()).slice(0,6000);});server.stderr.on('data',chunk=>{serverLog=(serverLog+chunk.toString()).slice(0,6000);});
 let ready=false;
 for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('TEST_SERVER_EXIT');try{const response=await fetch(base+'/cuenta');lastStatus=response.status;if(response.ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,300));}
 if(!ready)throw Error('TEST_SERVER_TIMEOUT '+lastStatus+' '+serverLog.slice(0,5000));
 const email='z11-ui-'+randomUUID()+'@example.invalid',password=randomUUID()+'Aa1!';
 const created=await admin.auth.admin.createUser({email,password,email_confirm:true});if(created.error||!created.data.user)throw Error('TEST_USER_CREATE');ids.push(created.data.user.id);
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const context=await browser.newContext({viewport:{width:360,height:844}}),page=await context.newPage();
 page.on('pageerror',error=>browserErrors.push(error.message));
 await page.goto(base+'/cuenta?next=%2Fpreferencias');await page.getByLabel('Correo').fill(email);await page.getByLabel('Contraseña').fill(password);
 await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await page.waitForURL('**/preferencias');
 await page.getByRole('link',{name:'Solicitar baja'}).click();
 await page.getByLabel('Contraseña').fill('clave-incorrecta');await page.getByLabel('Entiendo que solicito la baja de mi cuenta.').check();
 await page.getByRole('button',{name:'Solicitar baja'}).click();await page.getByText('No se pudo verificar la contraseña.').waitFor();
 await page.getByLabel('Contraseña').fill(password);await page.getByLabel('Entiendo que solicito la baja de mi cuenta.').check();
 await page.getByRole('button',{name:'Solicitar baja'}).click();await page.getByText('No pudimos confirmar la solicitud.',{exact:false}).waitFor();
 assert.equal((await admin.auth.admin.getUserById(ids[0])).error,null);
 const q=await db.query('select count(*)::int n from private.account_deletion_requests where user_id=$1',[ids[0]]);assert.equal(q.rows[0].n,0);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 await page.goto(base+'/cuenta/recuperar-cuenta');await page.getByText('Cierra tu sesión actual antes de recuperar una cuenta.').waitFor();
 try{await page.getByRole('button',{name:'Cerrar sesión'}).click({timeout:10000});}catch{throw Error('TEST_LOGOUT_DISABLED '+JSON.stringify(browserErrors).slice(0,1000)+' '+serverLog.slice(0,1500));}await page.waitForURL(base+'/');
 await page.goto(base+'/cuenta/recuperar-cuenta');await page.getByLabel('Correo').fill(email);await page.getByLabel('Contraseña').fill(password);
 await page.getByRole('button',{name:'Recuperar cuenta'}).click();await page.getByText('No pudimos recuperar la cuenta.',{exact:false}).waitFor();
 assert.equal((await admin.auth.admin.getUserById(ids[0])).error,null);
 const other=randomUUID(),ownKey='riuya:draft:'+ids[0]+':fixture',otherKey='riuya:draft:'+other+':fixture';
 await page.evaluate(({ownKey,otherKey})=>{sessionStorage.setItem(ownKey,'ficticio');sessionStorage.setItem(otherKey,'otro');sessionStorage.setItem('riuya:transfer','ficticio');},{ownKey,otherKey});
 await context.addCookies([{name:'riuya-baja-limpieza',value:encodeURIComponent(JSON.stringify({userId:ids[0],recoverUntil:'2030-01-15T12:00:00Z'})),domain:'localhost',path:'/cuenta/baja-confirmada'}]);
 await page.goto(base+'/cuenta/baja-confirmada');
 await page.getByText('Se limpiaron los borradores de esta cuenta en esta pestaña.').waitFor();
 assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),ownKey),null);
 assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),otherKey),'otro');
 assert.equal(await page.evaluate(()=>sessionStorage.getItem('riuya:transfer')),null);
 await page.getByText('UTC',{exact:false}).waitFor();
 console.log('Z11 navegador: móvil, reautenticación, limpieza aislada y RPC deshabilitadas: OK');
}finally{
 if(browser)await browser.close().catch(()=>{});
 if(server?.pid){try{execFileSync('taskkill',['/PID',String(server.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});}catch{}}
 for(const id of ids){const r=await admin.auth.admin.deleteUser(id);if(r.error&&r.error.status!==404)throw Error('TEST_USER_CLEANUP');}
 if(connected)await db.end().catch(()=>{});
 const root=await realpath(tmpdir()),target=await realpath(temp);
 if(!target.startsWith(root+sep)||!basename(target).startsWith('riuya-z11-ui-'))throw Error('TEST_TEMP_INVALID');
 if(junction){const link=join(target,'node_modules');if(!(await lstat(link)).isSymbolicLink())throw Error('TEST_TEMP_LINK');await unlink(link);}
 await noLinks(target);await rm(target,{recursive:true,force:true});
}
