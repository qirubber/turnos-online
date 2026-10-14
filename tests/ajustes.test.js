const { chromium } = require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch();
for(const vw of [{width:390,height:850},{width:1200,height:900}]){
const p=await b.newPage({viewport:vw});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.route('**/*',r=>{const u=r.request().url();if(u.includes('supabase-js'))return r.fulfill({body:fs.readFileSync('tests/mock-supabase.js','utf8'),contentType:'application/javascript'});if(u.startsWith('http://app.local/')){const f=u.replace('http://app.local/','').split('#')[0]||'index.html';return r.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'text/html'});}return r.abort();});
const sw=async(l)=>{const w=await p.evaluate(()=>document.documentElement.scrollWidth); if(w>vw.width) console.log('OVERFLOW',l,w);};
// crear un turno como cliente primero
await p.goto('http://app.local/index.html');await p.waitForSelector('[data-a=pickPro]');
await p.click('[data-a=pickPro][data-v=any]');await p.click('[data-a=pickSvc] >> nth=0');await p.click('.day.ok');await p.click('.slot');await p.click('[data-a=step][data-v=datos]');
await p.fill('#fNombre','Prueba Uno');await p.fill('#fTel','1155559999');await p.click('form[data-f=datos] button[type=submit]');await p.click('[data-a=reservar]');await p.waitForSelector('.ticket');
await p.click('#lnkCentro');await p.waitForTimeout(300);await p.fill('#lgEmail','a@b.com');await p.fill('#lgPass','clave123');await p.click('form[data-f=login] button[type=submit]');await p.waitForSelector('.tabs');
await p.click('[data-a=ptab][data-v=ajustes]');await sw('ajustes');
await p.setInputFiles('#logoFile',{name:'logo.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64')});
await p.waitForTimeout(500);
console.log('toast logo:',await p.locator('#toast').innerText(),'| header img:',await p.locator('#mark img').count(),'| db:',(await p.evaluate(()=>window.__DB.config[0].logo_url)).slice(0,20));
await p.fill('#reinicioConf','borrar');await p.click('form[data-f=reinicio] button[type=submit]');await p.waitForTimeout(150);console.log('toast mal:',await p.locator('#toast').innerText());
await p.fill('#reinicioConf','BORRAR');await p.click('form[data-f=reinicio] button[type=submit]');await p.waitForTimeout(300);
console.log('toast reset:',await p.locator('#toast').innerText(),'| turnos db:',await p.evaluate(()=>window.__DB.turnos.length),'| servicios db:',await p.evaluate(()=>window.__DB.servicios.length));
await p.click('[data-a=ask][data-v=logoDel]');await p.click('[data-a=logoDel]');await p.waitForTimeout(200);console.log('logo quitado, header img:',await p.locator('#mark img').count());
if(vw.width===1200)await p.screenshot({path:'/tmp/claude-0/-home-claude/089651ef-7cb0-5ee1-9cb0-4851b92e1185/scratchpad/ajustes.png',fullPage:true});
console.log(vw.width,'errs',errs);await p.close();}
await b.close();})();
