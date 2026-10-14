const { chromium } = require('playwright');
const fs=require('fs'),path=require('path');
(async()=>{
 const b=await chromium.launch();
 for (const vw of [{width:390,height:850},{width:1200,height:900}]) {
 const ctx=await b.newContext({viewport:vw});
 const p=await ctx.newPage();
 const errs=[]; p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error'&&!/Failed to load resource|ERR_/.test(m.text()))errs.push(m.text())});
 await p.route('**/*',r=>{const u=r.request().url();
   if(u.includes('supabase-js'))return r.fulfill({body:fs.readFileSync('tests/mock-supabase.js','utf8'),contentType:'application/javascript'});
   if(u.startsWith('http://app.local/')){const f=u.replace('http://app.local/','').split('#')[0]||'index.html';return r.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'text/html'});}
   return r.abort();});
 const sw=async(l)=>{const w=await p.evaluate(()=>document.documentElement.scrollWidth); if(w>vw.width) console.log('OVERFLOW',l,w);};
 await p.goto('http://app.local/index.html'); await p.waitForSelector('[data-a=pickPro]');
 await p.click('[data-a=pickPro][data-v=any]'); await p.click('[data-a=pickSvc] >> nth=1'); await p.waitForTimeout(100);
 await p.click('.day.ok'); await p.click('.slot'); await p.click('[data-a=step][data-v=datos]');
 await p.fill('#fNombre','Prueba Uno'); await p.fill('#fTel','1155559999'); await p.click('form[data-f=datos] button[type=submit]');
 await p.click('[data-a=reservar]'); await p.waitForSelector('.ticket'); await sw('done');
 console.log('done:', (await p.locator('.ticket-h').innerText()).replace(/\n/g,' | '));
 console.log('link:', await p.locator('.linkbox code').first().innerText());
 await p.setInputFiles('#compFile',{name:'c.png',mimeType:'image/png',buffer:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==','base64')});
 await p.waitForTimeout(400); await p.click('[data-a=enviarComp]'); await p.waitForTimeout(200);
 console.log('after comp:', await p.locator('.ticket-h .eyebrow').innerText());
 await p.click('[data-a=verMis]'); await sw('mis');
 console.log('mis:', (await p.locator('#app').innerText()).replace(/\s+/g,' ').slice(0,200));
 await p.locator('[data-a=reprog]').first().click(); await p.click('.day.ok >> nth=2'); await p.click('.slot'); await p.click('[data-a=reprogOk]'); await p.waitForTimeout(200);
 console.log('toast:', await p.locator('#toast').innerText());
 // espera
 await p.click('[data-a=nueva]'); await p.click('[data-a=pickPro][data-v=any]'); await p.click('[data-a=pickSvc] >> nth=0'); await p.click('[data-a=esperaOpen]');
 await p.fill('#esFecha', await p.evaluate(()=>{const d=new Date();d.setDate(d.getDate()+3);return d.toISOString().slice(0,10)}));
 await p.click('form[data-f=espera] button[type=submit]'); await p.waitForTimeout(200);
 console.log('espera toast:', await p.locator('#toast').innerText());
 // centro
 await p.click('#lnkCentro'); await p.waitForTimeout(300);
 await p.fill('#lgEmail','admin@centro.com'); await p.fill('#lgPass','mala'); await p.click('form[data-f=login] button[type=submit]'); await p.waitForTimeout(200);
 console.log('login err:', await p.locator('.err').innerText());
 await p.fill('#lgEmail','admin@centro.com'); await p.fill('#lgPass','clave123'); await p.click('form[data-f=login] button[type=submit]'); await p.waitForSelector('.tabs'); await sw('agenda');
 console.log('blocks', await p.locator('.blk').count());
 await p.click('[data-a=ptab][data-v=senas]'); await p.waitForTimeout(200); await sw('senas');
 const so=p.locator('[data-a=senaOk]'); console.log('senaOk', await so.count()); if(await so.count()){await so.first().click(); await p.waitForTimeout(200); console.log('banner', await p.locator('.banner.ok').count());}
 for (const t of ['recordatorios','espera','ingresos','clientes','servicios','disponibilidad','ajustes']) { await p.click(`[data-a=ptab][data-v=${t}]`); await p.waitForTimeout(80); await sw(t); }
 await p.click('[data-a=ptab][data-v=servicios]'); await p.locator('[data-a=svcOpen]').first().click(); await p.fill('[data-k=precio] >> nth=0','16000'); await p.locator('[data-k=precio]').first().dispatchEvent('change'); await p.waitForTimeout(150);
 console.log('precio db', await p.evaluate(()=>window.__DB.servicios[0].precio));
 await p.click('[data-a=ptab][data-v=clientes]'); await p.locator('tr.click').first().click(); await p.click('[data-a=packForm]'); await p.fill('#pkPrecio','100000'); await p.click('form[data-f=pack] button[type=submit]'); await p.waitForTimeout(200);
 console.log('packs', await p.locator('.pack').count());
 await p.click('[data-a=ptab][data-v=agenda]'); await p.click('[data-a=ntOpen]'); await p.selectOption('#ntSvc',{index:2}); await p.waitForTimeout(50);
 console.log('nt hora opts', await p.locator('#ntHora option').count());
 await p.click('[data-a=ptab][data-v=ingresos]'); await p.click('[data-a=exportar]'); await p.waitForTimeout(200); console.log('csv', (await p.locator('#csvTxt').count()));
 if(vw.width===1200){await p.click('[data-a=ptab][data-v=agenda]');await p.screenshot({path:'/tmp/claude-0/-home-claude/089651ef-7cb0-5ee1-9cb0-4851b92e1185/scratchpad/live-agenda.png',fullPage:false});}
 console.log(vw.width,'errs',errs);
 await ctx.close();
 }
 await b.close();
})();
