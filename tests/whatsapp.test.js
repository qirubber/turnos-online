const { chromium } = require('playwright');const fs=require('fs');
const QR=fs.readFileSync('/tmp/claude-0/-home-claude/089651ef-7cb0-5ee1-9cb0-4851b92e1185/scratchpad/node_modules/qrcode-generator/qrcode.js','utf8');
(async()=>{const b=await chromium.launch();
for(const vw of [{width:390,height:850},{width:1200,height:900}]){
const p=await b.newPage({viewport:vw,acceptDownloads:true});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.route('**/*',r=>{const u=r.request().url();if(u.includes('supabase-js'))return r.fulfill({body:fs.readFileSync('tests/mock-supabase.js','utf8'),contentType:'application/javascript'});if(u.includes('qrcode-generator'))return r.fulfill({body:QR,contentType:'application/javascript'});if(u.startsWith('http://app.local/')){const f=u.replace('http://app.local/','').split('#')[0]||'index.html';return r.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'text/html'});}return r.abort();});
const sw=async(l)=>{const w=await p.evaluate(()=>document.documentElement.scrollWidth); if(w>vw.width) console.log('OVERFLOW',l,w);};
await p.addInitScript(()=>{window.__MP='https://link.mercadopago.com.ar/centro';window.__MSG='Hola {nombre}! Gestioná tu turno: {link}';});
await p.goto('http://app.local/index.html');await p.waitForSelector('[data-a=pickPro]');
// reserva con transferencia
await p.click('[data-a=pickPro][data-v=any]');await p.click('[data-a=pickSvc] >> nth=0');await p.click('.day.ok');await p.click('.slot');await p.click('[data-a=step][data-v=datos]');
await p.fill('#fNombre','Prueba Uno');await p.fill('#fTel','1155559999');await p.click('form[data-f=datos] button[type=submit]');await p.click('[data-a=reservar]');await p.waitForSelector('.ticket');
console.log('boton MP:',await p.locator('a.mp').count(),await p.locator('a.mp').first().getAttribute('href').catch(()=>null));await sw('ticket');
await p.click('#lnkCentro');await p.waitForTimeout(300);await p.fill('#lgEmail','a@b.com');await p.fill('#lgPass','clave123');await p.click('form[data-f=login] button[type=submit]');await p.waitForSelector('.tabs');
await p.click('[data-a=ptab][data-v=whatsapp]');await p.waitForTimeout(200);await sw('whatsapp');
console.log('qr svg:',await p.locator('.qr svg').count(),'| textos:',await p.locator('.watxt').count(),'| link:',await p.locator('.linkbox code').first().innerText());
const [d]=await Promise.all([p.waitForEvent('download'),p.click('[data-a=qrBajar]')]);console.log('descarga:',d.suggestedFilename());
await p.click('[data-a=ptab][data-v=senas]');await p.click('[data-a=senaOk] >> nth=0');await p.waitForTimeout(300);await p.click('[data-a=ptab][data-v=recordatorios]');await p.waitForTimeout(200);
const msgs=await p.locator('.msg').allInnerTexts();console.log('recordatorios:',msgs.map(m=>m.slice(0,160)));
await p.click('[data-a=ptab][data-v=ajustes]');await p.fill('#cfg_mpLink','http://malo');await p.locator('#cfg_mpLink').dispatchEvent('change');await p.waitForTimeout(150);console.log('toast mp malo:',await p.locator('#toast').innerText());await sw('ajustes');
if(vw.width===390){await p.click('[data-a=ptab][data-v=whatsapp]');await p.waitForTimeout(200);await p.screenshot({path:'/tmp/claude-0/-home-claude/089651ef-7cb0-5ee1-9cb0-4851b92e1185/scratchpad/wa390.png',fullPage:true});}
console.log(vw.width,'errs',errs);await p.close();}
await b.close();})();
