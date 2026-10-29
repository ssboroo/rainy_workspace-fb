const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
(async()=>{
 const loaded=process.env.CHROMIUM_BUNDLE?require(process.env.CHROMIUM_BUNDLE):null;const bundled=loaded?.default||loaded;
 const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||(bundled?await bundled.executablePath():undefined),args:bundled?bundled.args:['--no-sandbox']});
 let count=0;try{
 const base=path.resolve(__dirname,'../extension');const p=await browser.newPage({viewport:{width:780,height:590}}),errors=[];
 await p.addInitScript(()=>{
 const callbacks=[],s={entitlement:{ok:true,valid:true,trial:true,daysLeft:3,expiresAt:Date.now()+3*86400000},savedFormData:{description:'Компьютерийн зайны тусламж — дэлхийн хаанаас ч.',fbGroupUrls:['https://www.facebook.com/groups/example/'],minDelaySec:30},deviceId:'DEV-12345678'};
 window.chrome={windows:{create:async opts=>{window.paymentWindow=opts;}},runtime:{getURL:n=>n,sendMessage:async m=>m.action==='GET_LICENSE'?s.entitlement:m.action==='CREATE_ORDER'?{ok:true,id:'TEST',amount:49900,status:'PENDING',checkoutUrl:'https://pay.wire.mn/test'}:{ok:true,message:'Facebook холболт бэлэн.'}},storage:{local:{get:async keys=>{if(typeof keys==='string')keys=[keys];return Object.fromEntries(keys.map(k=>[k,s[k]]));},set:async data=>{const c={};for(const [k,v] of Object.entries(data)){c[k]={oldValue:s[k],newValue:v};s[k]=v;}callbacks.forEach(fn=>fn(c,'local'));},remove:async keys=>keys.forEach(k=>delete s[k])},onChanged:{addListener:fn=>callbacks.push(fn)}},tabs:{create:async()=>{},query:async()=>[{id:1,windowId:1}]},sidePanel:{open:async()=>{}}};
 });
 p.on('pageerror',e=>errors.push(e.message));await p.goto('file://'+base+'/popup.html');await p.waitForTimeout(400);assert.deepEqual(errors,[]);count++;
 assert.equal(await p.locator('body').evaluate(e=>e.offsetWidth),780);assert.equal(await p.locator('body').evaluate(e=>e.offsetHeight),590);count++;
 assert((await p.locator('#licenseDeadline').innerText()).match(/\d{4}-\d{2}-\d{2}/));assert((await p.locator('#licenseCountdown').innerText()).includes('хоног'));count++;
 assert.equal(await p.locator('#serverUrl').count(),0);assert.equal(await p.locator('#connectServer').count(),0);count++;
 for(const tab of ['compose','groupfinder','leads','examples','schedule','protection','report','billing','settings']){
   await p.locator(`nav [data-view="${tab}"]`).click();await p.waitForTimeout(30);
   const bounds=await p.evaluate(()=>{const view=document.querySelector('.view.active'),shell=document.querySelector('main').getBoundingClientRect();return {scroll:document.documentElement.scrollHeight,height:innerHeight,viewBottom:view.getBoundingClientRect().bottom,shellBottom:shell.bottom,buttons:Array.from(view.querySelectorAll('button,input,textarea,select')).filter(e=>e.getBoundingClientRect().height&&getComputedStyle(e).visibility!=='hidden').map(e=>({id:e.id,bottom:e.getBoundingClientRect().bottom,top:e.getBoundingClientRect().top})).filter(x=>x.bottom>shell.bottom+1||x.top<shell.top-1)};});
   assert(bounds.scroll<=590,tab+': page scroll');assert(bounds.viewBottom<=bounds.shellBottom+1,tab+': view escapes shell');if(tab!=='billing')assert.deepEqual(bounds.buttons,[],tab+': controls outside workspace');else{for(const id of ['newOrder','checkOrder','licenseKey','activateLicense']){await p.locator('#'+id).scrollIntoViewIfNeeded();assert(await p.locator('#'+id).isVisible());}}count++;
   if(tab==='compose'||tab==='billing')await p.screenshot({path:path.resolve('/tmp',`rainy-52-${tab}.png`)});
 }
 await p.locator('nav [data-view="examples"]').click();await p.locator('.example-card').first().click();assert((await p.locator('#description').inputValue()).includes('өрөө'));count++;
 await p.locator('nav [data-view="schedule"]').click();await p.locator('[data-min="20"]').click();assert.equal(await p.locator('#interval').inputValue(),'20');count++;
 await p.locator('nav [data-view="billing"]').click();await p.locator('[data-plan="30"]').click();assert.equal(await p.evaluate(()=>window.paymentWindow.url),'https://pay.wire.mn/test');count++;
 await p.locator('#themeToggle').click();assert.equal(await p.locator('html').getAttribute('data-theme'),'dark');await p.reload();assert.equal(await p.locator('html').getAttribute('data-theme'),'dark');await p.locator('#themeToggle').click();assert.equal(await p.locator('html').getAttribute('data-theme'),'light');count++;
 await p.setViewportSize({width:380,height:820});await p.goto('file://'+base+'/popup.html?mode=side');assert.equal(await p.locator('body').evaluate(e=>e.offsetWidth),380);assert.equal(await p.locator('body').evaluate(e=>e.offsetHeight),820);assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);count++;
 await p.screenshot({path:'/tmp/rainy-53-sidebar-light.png'});await p.locator('#themeToggle').click();await p.screenshot({path:'/tmp/rainy-53-sidebar-dark.png'});await p.goto('file://'+base+'/popup.html');
 await p.locator('nav [data-view="compose"]').click();const privacy=await p.evaluate(async()=>{document.getElementById('optimizeImages').checked=false;document.getElementById('stripMetadata').checked=true;const c=document.createElement('canvas');c.width=c.height=8;c.getContext('2d').fillRect(0,0,8,8);const blob=await new Promise(r=>c.toBlob(r,'image/jpeg'));const bytes=new Uint8Array(await blob.arrayBuffer());const marker=new Uint8Array([255,225,0,12,69,120,105,102,0,0,1,2,3,4]);const input=new File([bytes.slice(0,2),marker,bytes.slice(2)],'private.jpg',{type:'image/jpeg'});const out=await optimizedFile(input);return {before:new TextDecoder('latin1').decode(await input.arrayBuffer()).includes('Exif'),after:new TextDecoder('latin1').decode(await out.arrayBuffer()).includes('Exif')};});assert(privacy.before);assert.equal(privacy.after,false);count++;
 await p.setViewportSize({width:40,height:40});assert.equal(await p.locator('body').evaluate(e=>e.offsetWidth),780);assert.equal(await p.locator('body').evaluate(e=>e.offsetHeight),590);count++;
 assert.deepEqual(errors,[]);count++;
 console.log(`PASS ${count} real Chromium popup layout and UI interaction scenarios`);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
