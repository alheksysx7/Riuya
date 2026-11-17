import {execFileSync,spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {mkdtemp,cp,symlink,lstat,realpath,unlink,rm,readdir,readFile,writeFile} from 'node:fs/promises';
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
const temp=await mkdtemp(join(tmpdir(),'riuya-z11-success-')),suffix=randomUUID().replaceAll('-','');
const reqName='z11_req_'+suffix,recName='z11_rec_'+suffix,ids=[];let browser,server,connected=false,junction=false,wrappers=false;
async function freePort(){const s=createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port;}
async function noLinks(path){for(const entry of await readdir(path,{withFileTypes:true})){const p=join(path,entry.name),st=await lstat(p);if(st.isSymbolicLink())throw Error('TEST_TEMP_LINK');if(st.isDirectory())await noLinks(p);}}
try{
 await db.connect();connected=true;
 const rights=await db.query("select has_function_privilege('authenticated','api.request_account_deletion()','execute') a,has_function_privilege('authenticated','api.recover_account_deletion()','execute') b");
 if(rights.rows[0].a||rights.rows[0].b)throw Error('TEST_REQUIRES_DISABLED_RPC');
 const email='z11-ui-success-'+randomUUID()+'@example.invalid',password=randomUUID()+'Aa1!';
 const made=await admin.auth.admin.createUser({email,password,email_confirm:true});if(made.error||!made.data.user)throw Error('TEST_USER_CREATE');
 const uid=made.data.user.id;ids.push(uid);
 const witnessEmail='z11-ui-success-'+randomUUID()+'@example.invalid';
 const witnessMade=await admin.auth.admin.createUser({email:witnessEmail,password,email_confirm:true});if(witnessMade.error||!witnessMade.data.user)throw Error('TEST_USER_CREATE');ids.push(witnessMade.data.user.id);
 if(!/^[0-9a-f-]{36}$/i.test(uid)||!/^[a-z0-9_]+$/.test(reqName+recName))throw Error('TEST_IDENTIFIER_INVALID');
 await db.query('begin');
 try{
  await db.query('grant create on schema api to riuya_deletion_user');await db.query('set local role riuya_deletion_user');
  for(const [name,target] of [[reqName,'request_account_deletion'],[recName,'recover_account_deletion']]){
   await db.query(`create function api.${name}() returns jsonb language plpgsql volatile security definer set search_path='' as $$ begin if current_setting('request.jwt.claims',true)::jsonb->>'sub' is distinct from '${uid}' then raise exception 'TEST_SCOPE' using errcode='42501';end if;return api.${target}();end $$`);
   await db.query(`revoke all on function api.${name}() from public,anon;grant execute on function api.${name}() to authenticated`);
  }
  await db.query('reset role');await db.query('revoke create on schema api from riuya_deletion_user');await db.query('commit');wrappers=true;
 }catch(e){await db.query('rollback');throw e;}
 await db.query("notify pgrst, 'reload schema'");
 const port=await freePort(),base='http://localhost:'+port;
 await cp('src',join(temp,'src'),{recursive:true});await cp('public',join(temp,'public'),{recursive:true});
 for(const file of ['package.json','tsconfig.json','next.config.ts','postcss.config.mjs','.env.local'])await cp(file,join(temp,file));
 const flow=join(temp,'src','lib','account-deletion.ts');
 const flowText=await readFile(flow,'utf8');
 if(!flowText.includes("rpc('request_account_deletion')")||!flowText.includes("rpc('recover_account_deletion')"))throw Error('TEST_FIXTURE_INVALID');
 await writeFile(flow,flowText.replace("rpc('request_account_deletion')",`rpc('${reqName}')`).replace("rpc('recover_account_deletion')",`rpc('${recName}')`));
 await symlink(resolve('node_modules'),join(temp,'node_modules'),'junction');junction=true;
 server=spawn(process.execPath,[join(temp,'node_modules','next','dist','bin','next'),'dev','--webpack','-p',String(port)],{cwd:temp,env:{...process.env,RIUYA_ENABLE_ACCOUNT_DELETION:'1',APP_ORIGIN:base},stdio:['ignore','pipe','pipe'],windowsHide:true});
 server.stdout.resume();server.stderr.resume();
 let ready=false;for(let i=0;i<100;i++){if(server.exitCode!==null)throw Error('TEST_SERVER_EXIT');try{if((await fetch(base+'/cuenta')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,300));}
 if(!ready)throw Error('TEST_SERVER_TIMEOUT');
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const context=await browser.newContext({viewport:{width:360,height:844}}),page=await context.newPage();
 await page.goto(base+'/cuenta?next=%2Fpreferencias');await page.getByLabel('Correo').fill(email);await page.getByLabel('Contraseña').fill(password);
 await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await page.waitForURL('**/preferencias');
 const witness=createClient(status.API_URL,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 if((await witness.auth.signInWithPassword({email:witnessEmail,password})).error)throw Error('TEST_WITNESS_LOGIN');
 const blocked=await witness.schema('api').rpc(reqName);assert.equal(blocked.error?.code,'42501');
 const old=createClient(status.API_URL,status.ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
 const oldLogin=await old.auth.signInWithPassword({email,password});if(oldLogin.error)throw Error('TEST_SECOND_SESSION');
 const own='riuya:draft:'+uid+':fixture',other='riuya:draft:'+randomUUID()+':fixture';
 await page.evaluate(({own,other})=>{sessionStorage.setItem(own,'ficticio');sessionStorage.setItem(other,'otro');},{own,other});
 await page.getByRole('link',{name:'Solicitar baja'}).click();await page.getByLabel('Contraseña').fill(password);
 await page.getByLabel('Entiendo que solicito la baja de mi cuenta.').check();await page.getByRole('button',{name:'Solicitar baja'}).click();
 await page.waitForURL('**/cuenta/baja-confirmada');await page.getByRole('heading',{name:'Solicitud recibida'}).waitFor();
 await page.getByText('Se limpiaron los borradores de esta cuenta en esta pestaña.').waitFor();
 assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),own),null);
 assert.equal(await page.evaluate(key=>sessionStorage.getItem(key),other),'otro');
 await page.getByText('UTC',{exact:false}).waitFor();
 let q=await db.query("select p.account_status,r.recover_until-r.requested_at as duration from private.profiles p join private.account_deletion_requests r on r.user_id=p.id where p.id=$1",[uid]);
 assert.equal(q.rows[0].account_status,'deletion_pending');assert.equal(q.rows[0].duration.days,7);
 assert.equal((await db.query('select count(*)::int n from auth.sessions where user_id=$1',[uid])).rows[0].n,0);
 const stale=await old.schema('api').rpc('my_trends');assert.ok(stale.error);
 await page.getByRole('link',{name:'Recuperar mi cuenta'}).click();await page.getByLabel('Correo').fill(email);await page.getByLabel('Contraseña').fill(password);
 await page.getByRole('button',{name:'Recuperar cuenta'}).click();await page.waitForURL('**/preferencias?msg=recuperada');
 await page.getByText('Tu cuenta se recuperó correctamente.').waitFor();
 q=await db.query("select p.account_status,(select count(*)::int from private.account_deletion_requests where user_id=p.id) as requests,(select count(*)::int from private.jobs where created_by=p.id and job_type='account.purge' and status='cancelled') as cancelled from private.profiles p where p.id=$1",[uid]);
 assert.deepEqual(q.rows[0],{account_status:'active',requests:0,cancelled:1});
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert.equal((await admin.auth.admin.getUserById(ids[1])).error,null);
 console.log('Z11 navegador: baja y recuperación reales con cuenta ficticia y permisos aislados: OK');
}finally{
 if(browser)await browser.close().catch(()=>{});
 if(server?.pid){try{execFileSync('taskkill',['/PID',String(server.pid),'/T','/F'],{stdio:'ignore',windowsHide:true});}catch{}}
 if(connected&&wrappers){await db.query('begin');await db.query('set local role riuya_deletion_user');await db.query(`drop function api.${reqName}();drop function api.${recName}()`);await db.query('commit');await db.query("notify pgrst, 'reload schema'");}
 if(connected&&ids.length)await db.query("delete from private.jobs where created_by=any($1::uuid[]) and job_type='account.purge'",[ids]);
 for(const id of ids){const r=await admin.auth.admin.deleteUser(id);if(r.error&&r.error.status!==404)throw Error('TEST_USER_CLEANUP');}
 if(connected)await db.end().catch(()=>{});
 const root=await realpath(tmpdir()),target=await realpath(temp);
 if(!target.startsWith(root+sep)||!basename(target).startsWith('riuya-z11-success-'))throw Error('TEST_TEMP_INVALID');
 if(junction){const link=join(target,'node_modules');if(!(await lstat(link)).isSymbolicLink())throw Error('TEST_TEMP_LINK');await unlink(link);}
 await noLinks(target);await rm(target,{recursive:true,force:true});
}
