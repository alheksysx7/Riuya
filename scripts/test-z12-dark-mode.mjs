import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {createServer} from 'node:net';
import {createRequire} from 'node:module';
const require=createRequire('C:/Users/LINKX7/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/');
const {chromium}=require('playwright');
const axe=createRequire(import.meta.url).resolve('axe-core');
const server=createServer();
await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
const port=server.address().port;await new Promise(resolve=>server.close(resolve));
let child,browser,exited=false;
try{
 child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p',String(port)],{
  cwd:process.cwd(),windowsHide:true,stdio:['ignore','ignore','ignore'],env:{...process.env,RIUYA_ENABLE_ACCOUNT_DELETION:'0'}});
 child.on('exit',()=>{exited=true;});const base='http://127.0.0.1:'+port;
 let ready=false;
 for(let i=0;i<100;i++){
  if(exited)throw Error('DARK_TEST_SERVER_EXITED');
  try{ready=(await fetch(base+'/api/health/live',{signal:AbortSignal.timeout(1000)})).ok;if(ready)break;}catch{}
  await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert(ready);
 browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const page=await browser.newPage({viewport:{width:360,height:900},colorScheme:'dark'});
 for(const width of [360,1280])for(const path of ['/','/cuenta']){
  await page.setViewportSize({width,height:900});
  await page.goto(base+path);await page.waitForLoadState('networkidle');
  assert.equal(await page.locator('.reader-shell').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(13, 23, 38)');
  await page.addScriptTag({path:axe});
  const result=await page.evaluate(async()=>window.axe.run(document,{runOnly:{type:'rule',values:['color-contrast']}}));
  assert.deepEqual(result.violations.map(x=>({id:x.id,nodes:x.nodes.map(n=>n.target)})),[],'DARK_CONTRAST '+path);
  const layout=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));
  assert(layout.scroll<=layout.view+1,'DARK_OVERFLOW '+path);
  if(path==='/'){
   const nav=await page.evaluate(()=>{
    const brand=document.querySelector('.reader-brand'),menu=document.querySelector('.header-nav');
    if(!brand||!menu)return {overlap:false,clipped:0};
    const a=brand.getBoundingClientRect(),b=menu.getBoundingClientRect();
    const overlap=a.right>b.left+1&&b.right>a.left+1&&a.bottom>b.top+1&&b.bottom>a.top+1;
    const clipped=[...document.querySelectorAll('.reader-filters a')].filter(el=>el.scrollWidth>el.clientWidth+1).length;
    return {overlap,clipped};
   });
   assert.equal(nav.overlap,false,'DARK_HEADER_OVERLAP');
   assert.equal(nav.clipped,0,'DARK_FILTER_TEXT_CLIPPED');
   const filters=page.locator('.reader-filters a');
   for(let i=0;i<await filters.count();i++){
    const filter=filters.nth(i);await filter.scrollIntoViewIfNeeded();
    const contrast=await filter.evaluate(async el=>window.axe.run(el,{runOnly:{type:'rule',values:['color-contrast']}}));
    assert.equal(contrast.violations.length,0,'DARK_FILTER_CONTRAST');
    assert.equal(contrast.incomplete.length,0,'DARK_FILTER_INCOMPLETE');
   }
  }

  console.log('Z12 contraste oscuro '+path+' '+width+' px: '+result.violations.length+' infracciones, '+result.incomplete.length+' revisiones manuales');
  if(result.incomplete.length)console.log('Z12 revisión manual: '+JSON.stringify(result.incomplete.map(rule=>({id:rule.id,targets:rule.nodes.map(node=>node.target)}))));
  if(path==='/'&&width===360&&process.env.RIUYA_PREVIEW_PATH){
   assert(!existsSync(process.env.RIUYA_PREVIEW_PATH),'PREVIEW_EXISTS');
   await page.evaluate(()=>{window.scrollTo(0,0);const filters=document.querySelector('.reader-filters');if(filters)filters.scrollLeft=0;});
   await page.screenshot({path:process.env.RIUYA_PREVIEW_PATH});
  }
 }
 await page.goto(base+'/offline.html');
 assert.equal(await page.locator('body').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(13, 23, 38)');
 await page.emulateMedia({colorScheme:'light'});await page.goto(base+'/cuenta');
 assert.notEqual(await page.locator('.reader-shell').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(13, 23, 38)');
 console.log('Z12 tema: preferencia claro/oscuro y diseño móvil OK');
}finally{
 if(browser)await browser.close();
 if(child&&!exited){child.kill();await Promise.race([new Promise(resolve=>child.once('exit',resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);}
}
