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
 child.on('exit',()=>{exited=true;});
 const base='http://127.0.0.1:'+port;
 let ready=false;
 for(let i=0;i<100;i++){
  if(exited)throw Error('TEST_SERVER_EXITED');
  try{ready=(await fetch(base+'/api/health/live',{signal:AbortSignal.timeout(1000)})).ok;if(ready)break;}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert(ready,'TEST_SERVER_TIMEOUT');
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--blink-settings=defaultFontSize=32']});
 const context=await browser.newContext({reducedMotion:'reduce'}),page=await context.newPage();
 for(const width of [360,640,1280]){
  await page.setViewportSize({width,height:900});
  for(const path of ['/','/cuenta']){
   await page.goto(base+path);
   await page.waitForLoadState('networkidle');
   const size=await page.evaluate(()=>({font:getComputedStyle(document.documentElement).fontSize,scroll:document.documentElement.scrollWidth,view:document.documentElement.clientWidth,
    expanded:[...document.querySelectorAll('body *')].filter(el=>el.clientWidth>0&&el.scrollWidth>el.clientWidth+2).slice(0,18).map(el=>({tag:el.tagName,cls:typeof el.className==='string'?el.className:'',width:el.clientWidth,scroll:el.scrollWidth})),offenders:[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+2||r.left< -2);}).slice(0,6).map(el=>({tag:el.tagName,cls:typeof el.className==='string'?el.className:''}))}));
   assert.equal(size.font,'32px','TEXT_SCALING '+path+' '+width+' details='+JSON.stringify(size));
   if(size.scroll>size.view+1)throw Error('TEXT_OVERFLOW '+path+' width='+width+' '+JSON.stringify(size));
   assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
  }
 }
 console.log('Z12 fuente configurada a 32 px en Chrome: portada y cuenta sin desbordamiento: OK');
}finally{
 if(browser)await browser.close();
 if(child&&!exited){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);}
}
