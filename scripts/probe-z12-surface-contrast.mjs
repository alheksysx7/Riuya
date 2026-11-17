import assert from 'node:assert/strict';
import sharp from 'sharp';
const targets='.trend-panel,.activity-list a,.results-panel,.share-card';
function luminance(rgb){
 return rgb.map(n=>{n/=255;return n<=.04045?n/12.92:((n+.055)/1.055)**2.4})
  .reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
}
function contrast(a,b){
 const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
// Muestreo del fondo renderizado; no registra contenido ni credenciales.
export async function measureSurfaceContrast({page,selector,label}){
 let minimum=Infinity,total=0;
 const textRects=await page.evaluate(selector=>{
     const result=[];
     for(const surface of document.querySelectorAll(selector)){
      const walker=document.createTreeWalker(surface,NodeFilter.SHOW_TEXT);
      while(walker.nextNode()){
       const node=walker.currentNode,parent=node.parentElement;
       if(!node.textContent.trim()||!parent||parent.closest('button:disabled,dialog:not([open])'))continue;
       const style=getComputedStyle(parent),match=/^rgb\((\d+), (\d+), (\d+)\)$/.exec(style.color);
       if(style.visibility==='hidden'||style.display==='none'||!match)continue;
       const range=document.createRange();range.selectNodeContents(node);
       for(const rect of range.getClientRects())if(rect.width>0&&rect.height>0)
        result.push({x:rect.x+scrollX,y:rect.y+scrollY,width:rect.width,height:rect.height,fg:match.slice(1).map(Number),tag:parent.tagName,cls:typeof parent.className==='string'?parent.className:''});
      }
     }
     return result;
    },selector);
    assert.ok(textRects.length>0,'LAB_SURFACE_NO_TEXT '+label);
    const style=await page.addStyleTag({content:selector.split(',').map(s=>s+' *, '+s+' *::before, '+s+' *::after, '+s).join(',')+'{color:transparent!important;text-shadow:none!important}'});
    let png;try{png=await page.screenshot({fullPage:true,scale:'css'});}finally{await style.evaluate(el=>el.remove());}
    const {data,info}=await sharp(png).removeAlpha().raw().toBuffer({resolveWithObject:true});
    for(const rect of textRects){
     let low=Infinity,count=0;
     const x0=Math.max(0,Math.floor(rect.x)),y0=Math.max(0,Math.floor(rect.y));
     const x1=Math.min(info.width,Math.ceil(rect.x+rect.width)),y1=Math.min(info.height,Math.ceil(rect.y+rect.height));
     for(let y=y0;y<y1;y+=2)for(let x=x0;x<x1;x+=2){
      const k=(y*info.width+x)*3;low=Math.min(low,contrast(rect.fg,[data[k],data[k+1],data[k+2]]));count++;
     }
     assert.ok(count>0,'LAB_SURFACE_EMPTY');
     minimum=Math.min(minimum,low);total+=count;
     assert.ok(low>=4.5,'LAB_SURFACE_CONTRAST '+label+' '+rect.tag+' '+rect.cls+' '+low.toFixed(2));
    }
 return {minimum,total};
}

// Las capturas solo existen en memoria y utilizan cuentas y noticias ficticias del laboratorio.
export async function probeSurfaceContrast({browser,authenticatedPage,id,appPort,article}){
 if(!/^riuya_z11_lab_[a-f0-9]{20}$/.test(id)||!Number.isInteger(appPort)||appPort<1024||appPort>65535||!/^[a-f0-9-]{36}$/.test(article))throw Error('LAB_SCOPE_INVALID');
 const storageState=await authenticatedPage.context().storageState();
 let minimum=Infinity,total=0;
 for(const scheme of ['light','dark'])for(const width of [360,1200]){
  const context=await browser.newContext({viewport:{width,height:900},deviceScaleFactor:1,storageState});
  const page=await context.newPage();
  try{
   const cdp=await context.newCDPSession(page);
   await cdp.send('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme},{name:'prefers-reduced-transparency',value:'no-preference'}]});
   for(const path of ['/noticias/'+article,'/actividad','/preferencias']){
    await page.goto('http://127.0.0.1:'+appPort+path);
    if(path.startsWith('/noticias/')){
     await page.getByRole('button',{name:'Ver resultados'}).click();
     await page.getByRole('heading',{name:'Resultados preliminares'}).waitFor();
    }else{
     await page.getByRole('heading',{name:path==='/actividad'?'Mi actividad':'Preferencias'}).waitFor();
    }
    const result=await measureSurfaceContrast({page,selector:targets,label:path.replace(article,'[fixture]')+' '+scheme+' '+width});
    minimum=Math.min(minimum,result.minimum);total+=result.total;
   }
  }finally{await context.close();}
 }
 console.log('Z12 contraste de superficies autenticadas: claro y oscuro, 360 y 1200 px; mínimo muestreado '+minimum.toFixed(2)+':1; '+total+' píxeles: OK');
}
