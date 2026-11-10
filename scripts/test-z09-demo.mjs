import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';
const require=createRequire('C:/Users/LINKX7/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/');const {chromium}=require('playwright');
const c=Object.fromEntries(readFileSync('.env.editor-local','utf8').split(/\r?\n/).filter(x=>x.startsWith('EDITOR_')).map(x=>{const i=x.indexOf('=');return[x.slice(0,i),x.slice(i+1)];}));
const b=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
try{const p=await b.newPage({viewport:{width:360,height:844}});await p.goto('http://127.0.0.1:3102/admin');await p.getByLabel('Correo').fill(c.EDITOR_EMAIL);await p.getByLabel('Contraseña').fill(c.EDITOR_PASSWORD);await p.getByRole('button',{name:'Entrar'}).click();await p.getByRole('heading',{name:'Mesa editorial'}).waitFor();
 const source=p.locator('[data-source-id="9c41c12c-4c10-4abc-8a6d-460c3b6a2001"]');await source.getByText('SIMULACIÓN · Fuente ficticia').waitFor();assert.equal(await source.getByRole('button',{name:'Consultar fuente'}).count(),0);
 const group=p.locator('[data-group-id="9c41c12c-4c10-4abc-8a6d-460c3b6a2301"]');await group.getByText('Estado: pendiente de revisión').waitFor();await group.getByRole('button',{name:'Confirmar mismo acontecimiento'}).waitFor();
 assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 console.log('Z09 demostración: fuente ficticia inactiva y agrupación revisable en móvil: OK');
}finally{await b.close();}
