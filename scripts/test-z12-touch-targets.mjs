import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
const require=createRequire('C:/Users/LINKX7/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/');
const {chromium}=require('playwright');
const reservation=createServer();
await new Promise((resolve,reject)=>reservation.once('error',reject).listen(0,'127.0.0.1',resolve));
const port=reservation.address().port;
await new Promise(resolve=>reservation.close(resolve));
let child,browser,exited=false;
try{
 child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{
  cwd:process.cwd(),windowsHide:true,stdio:['ignore','ignore','ignore'],env:{...process.env,RIUYA_ENABLE_ACCOUNT_DELETION:'0'}});
 child.on('exit',()=>{exited=true;});const base='http://127.0.0.1:'+port;
 let ready=false;
 for(let i=0;i<100;i++){
  if(exited)throw Error('TEST_SERVER_EXITED');
  try{ready=(await fetch(base+'/api/health/live',{signal:AbortSignal.timeout(1000)})).ok;if(ready)break;}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert(ready,'TEST_SERVER_TIMEOUT');
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:360,height:900},hasTouch:true});
 const failures=[];
 for(const path of ['/','/cuenta','/actividad','/preferencias']){
  await page.goto(base+path);await page.waitForLoadState('networkidle');
  const items=await page.evaluate(()=>[...document.querySelectorAll('button,a,input,select,summary')].filter(el=>{
   const rect=el.getBoundingClientRect(),style=getComputedStyle(el);
   return rect.width>0&&rect.height>0&&style.visibility!=='hidden'&&!el.closest('dialog:not([open])');
  }).map(el=>{const rect=el.getBoundingClientRect();return {tag:el.tagName,cls:typeof el.className==='string'?el.className:'',width:Math.round(rect.width),height:Math.round(rect.height)};}).filter(item=>item.width<44||item.height<44));
  if(items.length)failures.push({path,items});
 }
 assert.deepEqual(failures,[],'TARGETS_TOO_SMALL '+JSON.stringify(failures));
 console.log('Z12 objetivos táctiles en vistas públicas: mínimo 44 px OK');
}finally{
 if(browser)await browser.close();
 if(child&&!exited){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);}
}
