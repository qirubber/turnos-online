const { chromium } = require('playwright');const fs=require('fs');
const SP='/tmp/claude-0/-home-claude/089651ef-7cb0-5ee1-9cb0-4851b92e1185/scratchpad/';
(async()=>{const b=await chromium.launch();
for(const vw of [{width:390,height:850},{width:1200,height:900}]){
const p=await b.newPage({viewport:vw});const errs=[];p.on('pageerror',e=>errs.push(e.message));
await p.route('**/*',r=>{const u=r.request().url();if(u.includes('supabase-js'))return r.fulfill({body:fs.readFileSync('tests/mock-supabase.js','utf8'),contentType:'application/javascript'});if(u.startsWith('http://app.local/')){const f=u.replace('http://app.local/','').split('#')[0]||'index.html';return r.fulfill({body:fs.readFileSync(f),contentType:f.endsWith('.js')?'application/javascript':f.endsWith('.css')?'text/css':'text/html'});}return r.abort();});
const sw=async(l)=>{const w=await p.evaluate(()=>document.documentElement.scrollWidth); if(w>vw.width) console.log('OVERFLOW',l,w);};
await p.goto('http://app.local/index.html');await p.waitForSelector('.hero');
console.log('multi:',(await p.locator('.hero').innerText()).replace(/\n/g,' | '),'|| h2:',await p.locator('h2').first().innerText());
// dejar una sola profesional
await p.addInitScript(()=>{window.__UNA=true;});await p.reload();await p.waitForSelector('.hero');await sw('single');
console.log('single:',(await p.locator('.hero').innerText()).replace(/\n/g,' | '),'|| pasos:',(await p.locator('.steps').innerText()).replace(/\n/g,' '));
if(vw.width===390)await p.screenshot({path:SP+'bienvenida.png'});
console.log(vw.width,'errs',errs);await p.close();}
await b.close();})();
