const { chromium, devices } = require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch();
const route=async p=>p.route('**/*',r=>{const u=r.request().url();if(u.includes('supabase-js'))return r.fulfill({body:fs.readFileSync('tests/mock-supabase.js','utf8'),contentType:'application/javascript'});if(u.startsWith('http://app.local/')){const f=u.replace('http://app.local/','').split('#')[0]||'index.html';return r.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':f.endsWith('.png')?'image/png':f.endsWith('.webmanifest')?'application/manifest+json':'text/html'});}return r.abort();});
// Android: evento beforeinstallprompt simulado
{const p=await b.newPage({viewport:{width:390,height:850}});const errs=[];p.on('pageerror',e=>errs.push(e.message));await route(p);
await p.goto('http://app.local/index.html');await p.waitForSelector('[data-a=pickPro]');
console.log('android antes del evento, boton visible:',await p.isVisible('#btnInstalar'));
await p.evaluate(()=>{const e=new Event('beforeinstallprompt',{cancelable:true});e.prompt=()=>{window.__prompted=1;};e.userChoice=Promise.resolve({outcome:'accepted'});window.dispatchEvent(e);});
await p.waitForTimeout(100);console.log('despues del evento, boton visible:',await p.isVisible('#btnInstalar'));
await p.click('#btnInstalar');await p.waitForTimeout(200);console.log('prompt llamado:',await p.evaluate(()=>window.__prompted),'| toast:',await p.locator('#toast').innerText(),'| boton:',await p.isVisible('#btnInstalar'));
const man=await p.evaluate(async()=>{const r=await fetch(document.querySelector('link[rel=manifest]').href);return (await r.json()).name;});console.log('manifest:',man);
console.log('errs',errs);await p.close();}
// iPhone
{const ctx=await b.newContext({...devices['iPhone 13']});const p=await ctx.newPage();const errs=[];p.on('pageerror',e=>errs.push(e.message));await route(p);
await p.goto('http://app.local/index.html');await p.waitForSelector('[data-a=pickPro]');
console.log('iphone boton visible:',await p.isVisible('#btnInstalar'));
await p.click('[data-a=pickPro][data-v=any]');await p.click('[data-a=pickSvc] >> nth=0');await p.click('.day.ok');await p.click('.slot');await p.click('[data-a=step][data-v=datos]');
await p.fill('#fNombre','Prueba Uno');await p.fill('#fTel','1155559999');await p.click('form[data-f=datos] button[type=submit]');await p.click('[data-a=reservar]');await p.waitForSelector('.ticket');
console.log('tarjeta instalar en ticket:',await p.locator('.inst').count());
await p.click('.inst [data-a=instalar]');await p.waitForSelector('#hojaIOS');await p.screenshot({path:'/tmp/claude-0/-home-claude/089651ef-7cb0-5ee1-9cb0-4851b92e1185/scratchpad/ios-hoja.png'});
await p.click('#hojaIOS .btn.pri');console.log('hoja cerrada:',await p.locator('#hojaIOS').count()===0);
await p.click('.inst [data-a=instalarNo]');console.log('tarjeta oculta:',await p.locator('.inst').count()===0);
const w=await p.evaluate(()=>document.documentElement.scrollWidth);if(w>390)console.log('OVERFLOW',w);
console.log('errs',errs);await ctx.close();}
await b.close();})();
