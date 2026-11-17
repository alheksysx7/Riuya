import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
const axe=createRequire(import.meta.url).resolve('axe-core');

export async function probeTextReader({db,browser,id,appPort,authenticatedPage}){
 if(!/^riuya_z11_lab_[a-f0-9]{20}$/.test(id)||!Number.isInteger(appPort)||appPort<1024||appPort>65535)throw Error('LAB_SCOPE_INVALID');
 const article=randomUUID(),revision=randomUUID();
 await db.query('begin');
 try{
  await db.query('insert into private.articles(id,category_id) select $1,id from private.categories order by id limit 1',[article]);
  await db.query("insert into private.article_revisions(id,article_id,revision_number,title,micro_summary,full_paragraphs) values($1,$2,1,'Noticia ficticia de accesibilidad','Resumen ficticio',jsonb_build_array('Texto ficticio para probar lectura.'))",[revision,article]);
  await db.query("insert into private.opinions(revision_id,character_id,body) select $1,id,'Opinión ficticia para lectura accesible.' from private.characters where is_active",[revision]);
  await db.query("update private.articles set status='published',published_at=now(),current_revision_id=$1 where id=$2",[revision,article]);
  await db.query('commit');
 }catch(error){await db.query('rollback');throw error;}
 const context=await browser.newContext({reducedMotion:'reduce'}),page=await context.newPage();
 try{
  for(const width of [360,640,1280]){
   await page.setViewportSize({width,height:900});
   await page.goto('http://127.0.0.1:'+appPort+'/noticias/'+article);
   await page.getByRole('heading',{name:'Noticia ficticia de accesibilidad'}).waitFor();
   await page.evaluate(()=>{document.documentElement.style.setProperty('font-size','32px','important');});
   // Chrome puede estar terminando una transición de font-size; no evaluar el diseño antes de que se aplique.
   await page.waitForFunction(()=>getComputedStyle(document.documentElement).fontSize==='32px',{},{timeout:3000});
   assert.equal(await page.locator('.voice-card').count(),8);
   assert.equal(await page.getByText('Opinión ficticia para lectura accesible.').count(),8);
   if(width===360){
    const actions=page.locator('.participation-actions'),last=page.locator('.voice-like').last();
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.participation-actions')).position==='static',null,{timeout:3000});
    await last.click();assert.equal(await last.getAttribute('aria-pressed'),'true');
    await page.getByText('1 de 8 voces seleccionadas',{exact:true}).waitFor();await last.click();
    await page.evaluate(()=>document.documentElement.style.setProperty('font-size','16px','important'));
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.participation-actions')).position==='fixed',null,{timeout:3000});
    await last.click();assert.equal(await last.getAttribute('aria-pressed'),'true');
    await page.getByText('1 de 8 voces seleccionadas',{exact:true}).waitFor();await last.click();
    await last.focus();await page.keyboard.press('Tab');
    assert.equal(await page.locator('.draft-none').evaluate(el=>el===document.activeElement),true,'LAB_FOOTER_KEYBOARD_ORDER');
    const visible=await page.evaluate(()=>{const focus=document.activeElement.getBoundingClientRect(),bar=document.querySelector('.participation-docked').getBoundingClientRect();return focus.bottom<=bar.top;});
    assert.equal(visible,true,'LAB_FOOTER_OBSCURES_FOCUS');
    await page.keyboard.press('Tab');
    assert.equal(await actions.evaluate(el=>el.contains(document.activeElement)),true,'LAB_FOOTER_ACTION_FOCUS');
    await page.evaluate(()=>document.documentElement.style.setProperty('font-size','32px','important'));
    await page.waitForFunction(()=>getComputedStyle(document.documentElement).fontSize==='32px'&&getComputedStyle(document.querySelector('.participation-actions')).position==='static',null,{timeout:3000});
    assert.equal(await actions.locator('.selection-count').textContent(),'0 de 8 voces seleccionadas');
   }
   const voicesInfo=page.locator('.voices-info');
   await voicesInfo.locator('summary').focus();
   await page.keyboard.press('Enter');
   assert.equal(await voicesInfo.getAttribute('open'),'');
   await voicesInfo.getByText('Son personajes ficticios', {exact:false}).waitFor();
   await page.keyboard.press('Enter');
   assert.equal(await voicesInfo.getAttribute('open'),null);
   const sizes=await page.evaluate(()=>({font:getComputedStyle(document.documentElement).fontSize,scroll:document.documentElement.scrollWidth,view:document.documentElement.clientWidth,x:scrollX,expanded:[...document.querySelectorAll('body *')].filter(el=>el.clientWidth>0&&el.scrollWidth>el.clientWidth+2).slice(0,15).map(el=>({tag:el.tagName,cls:typeof el.className==='string'?el.className:'',scroll:el.scrollWidth,client:el.clientWidth})),offenders:[...document.querySelectorAll('body *')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+2||r.left< -2);}).slice(0,12).map(el=>({tag:el.tagName,cls:typeof el.className==='string'?el.className:''}))}));
   assert.equal(sizes.font,'32px');
   assert(sizes.scroll<=sizes.view+1,'LAB_TEXT_READER_OVERFLOW width='+width+' '+JSON.stringify(sizes));
   const voice=page.getByRole('button',{name:/Rami.*Conoce su mirada/});
   await voice.focus();await page.keyboard.press('Enter');
   const dialog=page.getByRole('dialog');await dialog.waitFor();
   await page.keyboard.press('Tab');
   assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true);
   await page.keyboard.press('Shift+Tab');
   assert.equal(await dialog.evaluate(el=>el.contains(document.activeElement)),true);
   await page.keyboard.press('Escape');
   assert.equal(await voice.evaluate(el=>el===document.activeElement),true);
   assert.equal(await page.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
  }
  if(!authenticatedPage)throw Error('LAB_AUTH_PAGE_MISSING');
  await authenticatedPage.setViewportSize({width:360,height:900});
  await authenticatedPage.goto('http://127.0.0.1:'+appPort+'/noticias/'+article);
  const like=authenticatedPage.getByRole('button',{name:'♡ Me gusta'}).first();
  await like.waitFor({state:'visible'});
  const cdp=await authenticatedPage.context().newCDPSession(authenticatedPage);
  try{
   const root=await cdp.send('DOM.getDocument');
   const targets=await cdp.send('DOM.querySelectorAll',{nodeId:root.root.nodeId,selector:'.voice-card .voice-like'});
   assert.equal(targets.nodeIds.length,8);
   const read=async nodeId=>{const tree=await cdp.send('Accessibility.getPartialAXTree',{nodeId,fetchRelatives:false});return tree.nodes[0];};
   const names=await authenticatedPage.locator('.voice-card .voice-person strong').allTextContents();
   for(let i=0;i<targets.nodeIds.length;i++){
    const node=await read(targets.nodeIds[i]);
    assert.equal(node.role.value,'button');
    assert.equal(node.name.value,'♡ Me gusta');
    assert.equal(node.description?.value,names[i]);
    assert.equal(node.properties.find(property=>property.name==='pressed')?.value.value,'false');
   }
   await like.click();const node=await read(targets.nodeIds[0]);
   assert.equal(node.description?.value,names[0]);
   assert.equal(node.properties.find(property=>property.name==='pressed')?.value.value,'true');
  }finally{await cdp.detach();}
  const review=authenticatedPage.getByRole('button',{name:'Revisar selección'});
  await review.click();
  const confirm=authenticatedPage.getByRole('dialog',{name:'Confirma tu elección'});
  await confirm.waitFor();
  const last=confirm.getByRole('button',{name:'Confirmar elección'});await last.focus();
  await authenticatedPage.keyboard.press('Tab');
  assert.equal(await confirm.evaluate(el=>el.contains(document.activeElement)),true,'LAB_CONFIRM_TAB_ESCAPED');
  await authenticatedPage.keyboard.press('Shift+Tab');
  assert.equal(await confirm.evaluate(el=>el.contains(document.activeElement)),true,'LAB_CONFIRM_SHIFT_TAB_ESCAPED');
  await authenticatedPage.keyboard.press('Escape');
  assert.equal(await review.evaluate(el=>el===document.activeElement),true,'LAB_CONFIRM_FOCUS_NOT_RESTORED');
  await review.click();await confirm.getByRole('button',{name:'Confirmar elección'}).click();
  await authenticatedPage.getByText('Respuesta confirmada. No puedes cambiarla.').waitFor();
  await authenticatedPage.getByRole('button',{name:'Ver resultados'}).click();
  await authenticatedPage.getByRole('heading',{name:'Resultados preliminares'}).waitFor();
  assert.equal(await authenticatedPage.locator('.support-row,.support-track').count(),0,'LAB_PRELIMINARY_GRAPH_EXPOSED');
  for(const path of ['/noticias/'+article,'/actividad','/preferencias']){
   if(!path.startsWith('/noticias/')){
    await authenticatedPage.goto('http://127.0.0.1:'+appPort+path);
    await authenticatedPage.getByRole('heading',{name:path==='/actividad'?'Mi actividad':'Preferencias'}).waitFor();
   }
   const layout=await authenticatedPage.evaluate(()=>({scroll:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));
   assert(layout.scroll<=layout.view+1,'LAB_TOUCH_LAYOUT_OVERFLOW '+path.replace(article,'[fixture]')+' '+JSON.stringify(layout));
   const small=await authenticatedPage.evaluate(()=>[...document.querySelectorAll('button,a,input,select,summary')].filter(el=>{
    const r=el.getBoundingClientRect(),style=getComputedStyle(el);
    return r.width>0&&r.height>0&&style.visibility!=='hidden'&&!el.closest('dialog:not([open])');
   }).map(el=>{
    const target=el instanceof HTMLInputElement&&['checkbox','radio'].includes(el.type)?el.closest('label')||el:el;
    const r=target.getBoundingClientRect();return {tag:el.tagName,cls:typeof el.className==='string'?el.className:'',parent:el.parentElement?.className||'',width:Math.round(r.width),height:Math.round(r.height)};
   }).filter(item=>item.width<44||item.height<44));
   assert.deepEqual(small,[],'LAB_TOUCH_TARGETS '+path.replace(article,'[fixture]')+' '+JSON.stringify(small));
  }

  await authenticatedPage.emulateMedia({colorScheme:'dark'});
  for(const path of ['/noticias/'+article,'/actividad','/preferencias']){
   await authenticatedPage.goto('http://127.0.0.1:'+appPort+path);
   const heading=path.startsWith('/noticias/')?'Noticia ficticia de accesibilidad':path==='/actividad'?'Mi actividad':'Preferencias';
   await authenticatedPage.getByRole('heading',{name:heading}).waitFor();
   assert.equal(await authenticatedPage.locator('.reader-shell').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(13, 23, 38)');
   if(path.startsWith('/noticias/')){
    await authenticatedPage.getByRole('button',{name:'Ver resultados'}).click();
    await authenticatedPage.getByRole('heading',{name:'Resultados preliminares'}).waitFor();
    const arrow=authenticatedPage.locator('.article-expanded summary > span[aria-hidden="true"]');
    const colors=await arrow.evaluate(el=>{
     const parse=value=>value.match(/[\d.]+/g).map(Number);
     const foreground=parse(getComputedStyle(el).color);
     let parent=el;let background;
     while(parent){const value=parse(getComputedStyle(parent).backgroundColor);if(value.length===3||value[3]>0){background=value;break;}parent=parent.parentElement;}
     return {foreground,background};
    });
    assert(colors.background&&colors.background.length===3,'LAB_ARROW_BACKGROUND_NOT_OPAQUE');
    const luminance=rgb=>rgb.slice(0,3).map(x=>x/255).map(x=>x<=0.04045?x/12.92:((x+0.055)/1.055)**2.4).reduce((sum,value,index)=>sum+value*[0.2126,0.7152,0.0722][index],0);
    const light=luminance(colors.foreground),dark=luminance(colors.background);
    const ratio=(Math.max(light,dark)+0.05)/(Math.min(light,dark)+0.05);
    assert(ratio>=4.5,'LAB_ARROW_CONTRAST');
    console.log('Z12 flecha decorativa: contraste calculado '+ratio.toFixed(2)+':1');
   }
   await authenticatedPage.addScriptTag({path:axe});
   const contrast=await authenticatedPage.evaluate(async()=>window.axe.run(document,{runOnly:{type:'rule',values:['color-contrast']}}));
   assert.deepEqual(contrast.violations.map(x=>({id:x.id,nodes:x.nodes.map(n=>n.target)})),[],'LAB_DARK_CONTRAST '+path.replace(article,'[fixture]'));
   const sizes=await authenticatedPage.evaluate(()=>({scroll:document.documentElement.scrollWidth,view:document.documentElement.clientWidth}));
   assert(sizes.scroll<=sizes.view+1,'LAB_DARK_OVERFLOW '+path.replace(article,'[fixture]'));
   console.log('Z12 contraste oscuro autenticado '+path.replace(article,'[fixture]')+': '+contrast.incomplete.length+' revisiones manuales');
   if(contrast.incomplete.length)console.log('Z12 contraste pendiente: '+JSON.stringify(contrast.incomplete.map(rule=>({id:rule.id,targets:rule.nodes.map(node=>node.target)}))));
  }
  await authenticatedPage.emulateMedia({colorScheme:'light'});
  console.log('Z12 accesibilidad aislada: confirmación, foco y resultados preliminares: OK');
  console.log('Z12 accesibilidad aislada: ocho voces, texto ampliado y diálogo de teclado: OK');
  return article;
 }finally{await context.close();}
}
