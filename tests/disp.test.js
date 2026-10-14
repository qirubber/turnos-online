const { chromium } = require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch();
for(const vw of [{width:390,height:850},{width:1200,height:900}]){
const p=await b.newPage({viewport:vw});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.route('**/*',r=>{const u=r.request().url();if(u.includes('supabase-js'))return r.fulfill({body:fs.readFileSync('tests/mock-supabase.js','utf8'),contentType:'application/javascript'});if(u.startsWith('http://app.local/')){const f=u.replace('http://app.local/','').split('#')[0]||'index.html';return r.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'text/html'});}return r.abort();});
const sw=async(l)=>{const w=await p.evaluate(()=>document.documentElement.scrollWidth); if(w>vw.width) console.log('OVERFLOW',l,w);};
await p.goto('http://app.local/index.html#centro');await p.waitForTimeout(300);
await p.fill('#lgEmail','a@b.com');await p.fill('#lgPass','clave123');await p.click('form[data-f=login] button[type=submit]');await p.waitForSelector('.tabs');
await p.click('[data-a=ptab][data-v=disponibilidad]');
const ids=await p.evaluate(()=>window.__DB.profesionales.map(x=>x.id));
// vacaciones de Paula todo el periodo
await p.click(`[data-a=proOpen][data-v="${ids[1]}"]`);await sw('pro-edit');
const hoy=await p.evaluate(()=>{const d=new Date();return d.toISOString().slice(0,10)});const fin=await p.evaluate(()=>{const d=new Date();d.setDate(d.getDate()+40);return d.toISOString().slice(0,10)});
await p.fill(`#vacDesde_${ids[1]}`,hoy);await p.fill(`#vacHasta_${ids[1]}`,fin);await p.click(`form[data-f=vac] button[type=submit]`);await p.waitForTimeout(200);
console.log('toast vac:',await p.locator('#toast').innerText(),'| filas:',await p.evaluate(()=>window.__DB.bloqueos.length));
console.log('chips agrupados:',await p.locator('.ed-b .chip').count(), await p.locator('.ed-b .chip').first().innerText());
// eliminar Valeria
await p.click(`[data-a=proOpen][data-v="${ids[2]}"]`);await p.click(`[data-a=ask][data-v="pdel:${ids[2]}"]`);await p.click(`[data-a=proDel]`);await p.waitForTimeout(200);
console.log('toast del:',await p.locator('#toast').innerText());
console.log('pros en panel:',await p.locator('.ed-h .grow b').allInnerTexts());
// bloqueo rango centro
await p.fill('#bqFecha',hoy);await p.fill('#bqFechaH',hoy);await p.fill('#bqMotivo','Prueba');await p.click('form[data-f=bloq] button[type=submit]');await p.waitForTimeout(150);
console.log('grupos:',await p.locator('section.panel .row .chip').allInnerTexts());
// vista cliente
await p.click('#mCli');await p.waitForTimeout(300);
console.log('pasos:',(await p.locator('.steps').innerText()).replace(/\n/g,' '));
console.log('cards:',(await p.locator('.card h3').allInnerTexts()));
await sw('cliente');
console.log(vw.width,'errs',errs);await p.close();}
await b.close();})();
