import {createRequire} from 'node:module';import {execFileSync} from 'node:child_process';import {readFileSync} from 'node:fs';import {randomBytes} from 'node:crypto';import assert from 'node:assert/strict';import {createClient} from '@supabase/supabase-js';
const require=createRequire('C:/Users/LINKX7/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/');const {chromium}=require('playwright');
const status=JSON.parse(execFileSync(process.execPath,['node_modules/supabase/dist/supabase.js','status','-o','json'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));if(status.API_URL!=='http://127.0.0.1:54321'||!status.SERVICE_ROLE_KEY)throw Error('Solo entorno local');
const env=Object.fromEntries(readFileSync('.env.local','utf8').split(/\r?\n/).filter(x=>x.includes('=')&&!x.startsWith('#')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)];}));
const admin=createClient(status.API_URL,status.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});const suffix=randomBytes(6).toString('hex'),password=randomBytes(20).toString('base64url'),ids=[],emails=[`z10-a-${suffix}@example.invalid`,`z10-b-${suffix}@example.invalid`];let browser;
async function login(page,email){await page.goto('http://127.0.0.1:3102/cuenta?next=%2Fpreferencias');await page.getByLabel('Correo').fill(email);await page.getByLabel('Contraseña').fill(password);await page.getByRole('button',{name:'Iniciar sesión',exact:true}).click();await page.waitForURL('**/preferencias');}
try{
 for(const email of emails){const result=await admin.auth.admin.createUser({email,password,email_confirm:true});if(result.error)throw Error('No se pudo crear cuenta ficticia');ids.push(result.data.user.id);}
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const ca=await browser.newContext({viewport:{width:360,height:844}}),cb=await browser.newContext({viewport:{width:360,height:844}});
 const a=await ca.newPage(),b=await cb.newPage();await login(a,emails[0]);const response=await a.reload();assert(/private|no-store/i.test(response.headers()['cache-control']||''));
 assert.equal(await a.getByLabel('Avisos de noticias').isChecked(),false);assert.equal(await a.getByLabel('Avisos de resultados').isChecked(),false);assert.equal(await a.getByLabel('Hora local').inputValue(),'8');assert.equal(await a.getByLabel('Zona horaria').inputValue(),'UTC');
 const stale=await ca.newPage();await stale.goto('http://127.0.0.1:3102/preferencias');
 await a.getByLabel('Avisos de noticias').check();await a.getByLabel('Hora local').selectOption('12');await a.getByLabel('Zona horaria').fill('America/Guayaquil');await a.getByRole('button',{name:'Guardar preferencias'}).click();await a.getByText('Preferencias guardadas.').waitFor();await a.reload();assert(await a.getByLabel('Avisos de noticias').isChecked());assert.equal(await a.getByLabel('Avisos de resultados').isChecked(),false);assert.equal(await a.getByLabel('Zona horaria').inputValue(),'America/Guayaquil');
 await stale.getByLabel('Avisos de resultados').check();await stale.getByRole('button',{name:'Guardar preferencias'}).click();await stale.getByText('Las preferencias cambiaron en otra sesión.',{exact:false}).waitFor();
 await login(b,emails[1]);assert.equal(await b.getByLabel('Avisos de noticias').isChecked(),false);assert.equal(await b.getByLabel('Avisos de resultados').isChecked(),false);await b.getByText('Aún no hay avisos registrados.').waitFor();
 assert.equal(await a.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
 assert(env.NEXT_PUBLIC_SUPABASE_URL===status.API_URL);
 console.log('Z10 navegador: opt-in, zona, conflicto, aislamiento y móvil: OK');
}finally{if(browser)await browser.close();for(const id of ids){const result=await admin.auth.admin.deleteUser(id);if(result.error)throw Error('No se pudo eliminar una cuenta ficticia');}}
