import assert from 'node:assert/strict';

export async function probeBrowserFont({chromium,authenticatedPage,id,appPort,article}){
 if(!/^riuya_z11_lab_[a-f0-9]{20}$/.test(id)||!Number.isInteger(appPort)||appPort<1024||appPort>65535||!/^[a-f0-9-]{36}$/.test(article))throw Error('LAB_SCOPE_INVALID');
 const state=await authenticatedPage.context().storageState();
 const browser=await chromium.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--blink-settings=defaultFontSize=32']});
 const context=await browser.newContext({storageState:state,colorScheme:'dark'}),page=await context.newPage();
 try{
  for(const width of [360,640,1280]){
   await page.setViewportSize({width,height:900});
   for(const path of ['/noticias/'+article,'/actividad','/preferencias']){
    await page.goto('http://127.0.0.1:'+appPort+path);
    const title=path.startsWith('/noticias/')?'Noticia ficticia de accesibilidad':path==='/actividad'?'Mi actividad':'Preferencias';
    await page.getByRole('heading',{name:title}).waitFor();
    const size=await page.evaluate(()=>({font:getComputedStyle(document.documentElement).fontSize,scroll:document.documentElement.scrollWidth,view:document.documentElement.clientWidth,
     expanded:[...document.querySelectorAll('body *')].filter(el=>el.clientWidth>0&&el.scrollWidth>el.clientWidth+2).slice(0,12).map(el=>({tag:el.tagName,cls:typeof el.className==='string'?el.className:'',width:el.clientWidth,scroll:el.scrollWidth}))}));
    assert.equal(size.font,'32px');
    assert(size.scroll<=size.view+1,'LAB_BROWSER_FONT_OVERFLOW '+path.replace(article,'[fixture]')+' '+width+' '+JSON.stringify(size));
   }
  }
  console.log('Z12 fuente de Chrome ampliada: noticia, actividad y preferencias autenticadas en tres anchos: OK');
 }finally{await context.close();await browser.close();}
}
