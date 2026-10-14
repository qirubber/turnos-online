/* Turnos Online · página de reservas y panel del centro conectados a Supabase */
(function(){
"use strict";
const CFG=window.TURNERO_CONFIG||{};
const sb=window.supabase.createClient(CFG.supabaseUrl,CFG.supabaseKey,{auth:{persistSession:true,autoRefreshToken:true}});
const TOKENS_KEY="turnero-tokens";
const DIAS=["Domingo","Lunes","Martes","Miércoles","Jueves","Viernes","Sábado"];
const DCORTO=["Do","Lu","Ma","Mi","Ju","Vi","Sá"];
const ESTADOS={pendiente_pago:"Esperando seña",por_validar:"Seña a validar",confirmado:"Confirmado",completado:"Atendido",ausente:"No asistió",cancelado:"Cancelado",vencido:"Reserva vencida"};
const OCUPA={pendiente_pago:1,por_validar:1,confirmado:1,completado:1,ausente:1};
const ACTIVOS=["confirmado","pendiente_pago","por_validar"];
const FRANJAS=[["manana","Mañana",0,780],["siesta","Siesta",780,960],["tarde","Tarde",960,1200],["noche","Noche",1200,1440]];
const COLORES=[[1,"Verde"],[2,"Violeta"],[3,"Ámbar"],[4,"Azul"]];
const MEDIOS=["Efectivo","Transferencia","Mercado Pago","Débito","Crédito"];
let S={config:null,profesionales:[],servicios:[],bloqueos:[],turnos:[],clientes:[],ventas:[],espera:[],notifs:[],misTurnos:[],misEspera:[]};
let ui;

/* ---------- utilidades ---------- */
const esc=s=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const moneyFmt=new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0});
const $m=n=>moneyFmt.format(Math.round(n||0));
const kfmt=n=>n>=1e6?"$"+(n/1e6).toFixed(1).replace(".",",")+"M":n>=1000?"$"+Math.round(n/1000)+"k":"$"+Math.round(n);
const pad=n=>(n<10?"0":"")+n;
const ymd=d=>d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate());
const parseYmd=s=>{const p=s.split("-");return new Date(+p[0],+p[1]-1,+p[2]);};
const toMin=h=>{const p=h.split(":");return (+p[0])*60+(+p[1]);};
const fromMin=m=>pad(Math.floor(m/60))+":"+pad(m%60);
const addDays=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x;};
const cap=t=>t.charAt(0).toUpperCase()+t.slice(1);
const hhmm=t=>t?String(t).slice(0,5):null;
/* hora de Argentina, sin importar la zona del dispositivo */
const AR_OFFSET=-3*60;
function ahoraAR(){const d=new Date();return new Date(d.getTime()+(d.getTimezoneOffset()+AR_OFFSET)*60000);}
const hoy0=()=>{const d=ahoraAR();d.setHours(0,0,0,0);return d;};
const hoyS=()=>ymd(ahoraAR());
const msAR=ms=>new Date(ms+(new Date(ms).getTimezoneOffset()+AR_OFFSET)*60000);
const fechaLarga=s=>cap(parseYmd(s).toLocaleDateString("es-AR",{weekday:"long",day:"numeric",month:"long"}));
const fechaCorta=s=>parseYmd(s).toLocaleDateString("es-AR",{day:"2-digit",month:"2-digit",year:"2-digit"});
const fechaDM=s=>{const d=parseYmd(s);return d.getDate()+"/"+(d.getMonth()+1);};
const lunes=d=>{const x=new Date(d);x.setHours(0,0,0,0);x.setDate(x.getDate()-((x.getDay()+6)%7));return x;};
const startOf=t=>{const d=parseYmd(t.fecha),m=toMin(t.hora);d.setHours(Math.floor(m/60),m%60,0,0);return d;};
const digits=s=>String(s||"").replace(/\D/g,"");
const waNum=s=>{let d=digits(s);if(d.length===10)d="549"+d;return d;};
const waLink=(num,text)=>"https://wa.me/"+waNum(num)+"?text="+encodeURIComponent(text);
const pagado=t=>(t.pagos||[]).reduce((a,p)=>a+p.monto,0);
const saldo=t=>Math.max(0,t.precio-pagado(t));
const svcById=id=>S.servicios.find(s=>s.id===id);
const cliById=id=>S.clientes.find(c=>c.id===id);
const turnoById=id=>S.turnos.find(t=>t.id===id);
const misTurno=id=>S.misTurnos.find(t=>t.id===id);
const proById=id=>S.profesionales.find(p=>p.id===id);
const prosPanel=()=>S.profesionales.filter(p=>!p.archivado);
const prosActivos=()=>S.profesionales.filter(p=>p.activo&&!p.archivado);
const ocupa=t=>!!OCUPA[t.estado];
const finConPrep=t=>toMin(t.hora)+t.duracion+(t.preparacion||0);
const minutosHasta=t=>(startOf(t)-ahoraAR())/60000;
const puedeCancelar=t=>ACTIVOS.includes(t.estado)&&minutosHasta(t)>=S.config.cancelMin;
const horaDe=ms=>{const d=msAR(ms);return pad(d.getHours())+":"+pad(d.getMinutes());};
const cuandoHold=ms=>{const s=ymd(msAR(ms));return (s===hoyS()?"hoy":s===ymd(addDays(hoy0(),1))?"mañana":fechaCorta(s))+" a las "+horaDe(ms);};
function relTime(ms){const m=Math.round((Date.now()-ms)/60000);if(m<1)return "recién";if(m<60)return "hace "+m+" min";const h=Math.round(m/60);if(h<24)return "hace "+h+" h";return "hace "+Math.round(h/24)+" d";}
function proNombre(id){const p=proById(id);return p?p.nombre:"Sin asignar";}
function proTag(id){const p=proById(id);if(!p)return '<span class="muted">Sin asignar</span>';return `<span class="who-pro pc${p.color}"><span class="dot"></span>${esc(p.nombre)}</span>`;}
const senaDe=s=>Math.round(s.precio*s.sena/100);
const neto=t=>pagado(t)-(t.aFavor||0);
const cuentaIngreso=t=>ocupa(t)||(t.estado==="cancelado"&&neto(t)>0);
const facturacion=t=>(t.estado==="ausente"||t.estado==="cancelado")?neto(t):t.precio;
const packById=(c,id)=>c&&(c.packs||[]).find(p=>p.id===id);
const packDisponible=(c,svcId)=>c&&(c.packs||[]).find(p=>p.servicioId===svcId&&p.usadas<p.total);
const devuelveSena=t=>minutosHasta(t)>=S.config.senaHoras*60||S.config.politica==="favor";
const esAdmin=()=>ui.yo&&ui.yo.rol==="admin";
function politicaTxt(){
  const c=S.config;
  return `Podés reprogramar o cancelar online hasta ${c.cancelMin} minutos antes.`+(c.politica==="pierde"?` Si cancelás con ${c.senaHoras} h o más, lo pagado te queda a favor para otro turno. Si cancelás más tarde o no venís, se pierde.`:` Si cancelás, lo pagado te queda a favor para otro turno.`);
}
let toastTimer;
function toast(msg){const el=document.getElementById("toast");el.textContent=msg;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.hidden=true;},3200);}
function errMsg(e){
  const m=(e&&(e.message||e.error_description))||"";
  if(/Failed to fetch|NetworkError|network/i.test(m))return "No hay conexión. Revisá internet y probá de nuevo.";
  if(/Invalid login credentials/i.test(m))return "Email o contraseña incorrectos.";
  if(/JWT|token is expired/i.test(m))return "Tu sesión venció. Volvé a ingresar.";
  return m||"Algo salió mal. Probá de nuevo.";
}
function fillTpl(tpl,t){
  const c=cliById(t.clienteId)||{nombre:""};
  return tpl.replace(/\{nombre\}/g,c.nombre.split(" ")[0]).replace(/\{servicio\}/g,t.servicioNombre).replace(/\{fecha\}/g,fechaLarga(t.fecha))
    .replace(/\{hora\}/g,t.hora).replace(/\{negocio\}/g,S.config.negocio).replace(/\{profesional\}/g,proNombre(t.profId))
    .replace(/\{cancelacion\}/g,String(S.config.cancelMin)).replace(/\{saldo\}/g,$m(saldo(t)))
    .replace(/\{link\}/g,()=>{const tk=c.token||t.token;return tk?linkMis(tk):linkReservas();});
}
function leerTokens(){try{const v=JSON.parse(localStorage.getItem(TOKENS_KEY)||"[]");return Array.isArray(v)?v.filter(x=>x&&/^[0-9a-f-]{36}$/i.test(x)):[];}catch(e){return [];}}
function guardarToken(tk){if(!tk)return;const l=leerTokens();if(!l.includes(tk))l.unshift(tk);try{localStorage.setItem(TOKENS_KEY,JSON.stringify(l.slice(0,10)));}catch(e){}}
function quitarToken(tk){try{localStorage.setItem(TOKENS_KEY,JSON.stringify(leerTokens().filter(x=>x!==tk)));}catch(e){}}
const linkMis=tk=>location.origin+location.pathname+"#mis-"+tk;
const linkReservas=()=>location.origin+location.pathname;

/* ---------- datos: mapeo de filas ---------- */
const CFG_COLS={negocio:"negocio",whatsapp:"whatsapp",alias:"alias",cbu:"cbu",titular:"titular",banco:"banco",mpLink:"mp_link",exigirSena:"exigir_sena",cancelMin:"cancel_min",senaHoras:"sena_horas",politica:"politica",ventana:"ventana",anticipacion:"anticipacion",holdHoras:"hold_horas",intervalo:"intervalo",recordatorioHoras:"recordatorio_horas",mensaje:"mensaje",mensajeConfirmacion:"mensaje_confirmacion",logoUrl:"logo_url",bienvenidaTitulo:"bienvenida_titulo",bienvenidaTexto:"bienvenida_texto"};
function mapConfig(r){const c={mpActivo:false};Object.keys(CFG_COLS).forEach(k=>{c[k]=r[CFG_COLS[k]];});c.logoUrl=c.logoUrl||"";c.bienvenidaTitulo=c.bienvenidaTitulo||"";c.bienvenidaTexto=c.bienvenidaTexto||"";return c;}
function normH(h){const o={};for(let i=0;i<7;i++)o[i]=Array.isArray(h&&h[i])?h[i]:[];return o;}
const mapPro=r=>({id:r.id,nombre:r.nombre,rol:r.rol||"",tel:r.tel||"",color:r.color||1,activo:r.activo,archivado:!!r.archivado,horario:normH(r.horario),orden:r.orden||0});
const SVC_COLS={nombre:"nombre",categoria:"categoria",desc:"descripcion",duracion:"duracion",preparacion:"preparacion",precio:"precio",sena:"sena",activo:"activo",equipo:"equipo",restringir:"restringir",desde:"desde",hasta:"hasta",profIds:"prof_ids",dias:"dias"};
const mapSvc=r=>({id:r.id,categoria:r.categoria||"",nombre:r.nombre,desc:r.descripcion||"",duracion:r.duracion,preparacion:r.preparacion||0,precio:r.precio,sena:r.sena,activo:r.activo,profIds:r.prof_ids||[],equipo:r.equipo||"",restringir:r.restringir,dias:r.dias||[],desde:hhmm(r.desde),hasta:hhmm(r.hasta),orden:r.orden||0});
const mapBloq=r=>({id:r.id,fecha:r.fecha,desde:hhmm(r.desde),hasta:hhmm(r.hasta),profId:r.profesional_id||null,motivo:r.motivo||""});
function mapTurno(r,pagos){
  const hold=r.hold_hasta?Date.parse(r.hold_hasta):null;
  return {id:r.id,clienteId:r.cliente_id,servicioId:r.servicio_id,servicioNombre:r.servicio_nombre,profId:r.profesional_id,equipo:r.equipo||"",duracion:r.duracion,preparacion:r.preparacion||0,
    precio:r.precio,senaMonto:r.sena_monto,fecha:r.fecha,hora:hhmm(r.hora),estado:(r.estado==="pendiente_pago"&&hold&&hold<=Date.now())?"vencido":r.estado,holdHasta:hold,
    medio:r.medio,origen:r.origen,recordado:r.recordado,aFavor:r.a_favor||0,packId:r.paquete_id,packSesion:r.paquete_sesion,packDevuelto:r.paquete_devuelto,
    comprobante:r.comprobante_path?{path:r.comprobante_path,nombre:r.comprobante_nombre,subido:Date.parse(r.comprobante_subido)}:null,
    pagos:(pagos[r.id]||[])};
}
const mapPack=k=>({id:k.id,servicioId:k.servicio_id,nombre:k.nombre,total:k.total,usadas:k.usadas,fecha:String(k.created_at||k.fecha).slice(0,10)});

async function fetchAll(q){
  const out=[];let from=0;
  for(;;){const {data,error}=await q().range(from,from+999);if(error)throw error;out.push(...data);if(data.length<1000)break;from+=1000;}
  return out;
}
async function loadCatalogo(staff){
  const [c,p,s,b]=await Promise.all([
    sb.from("config").select("*").eq("id",1).single(),
    staff?sb.from("profesionales").select("*").order("orden"):sb.from("profesionales").select("id,nombre,rol,color,activo,horario,orden").order("orden"),
    sb.from("servicios").select("*").order("orden"),
    staff?sb.from("bloqueos").select("*").gte("fecha",ymd(addDays(hoy0(),-60))):sb.from("bloqueos").select("id,fecha,desde,hasta,profesional_id").gte("fecha",hoyS())
  ]);
  for(const r of [c,p,s,b])if(r.error)throw r.error;
  S.config=mapConfig(c.data);S.profesionales=p.data.map(mapPro);S.servicios=s.data.map(mapSvc);S.bloqueos=b.data.map(mapBloq);
}
async function loadOcupados(){
  const {data,error}=await sb.rpc("ocupados",{p_desde:hoyS(),p_hasta:ymd(addDays(hoy0(),S.config.ventana+1))});
  if(error)throw error;
  S.turnos=data.map((o,i)=>({id:"o"+i,fecha:o.fecha,hora:o.hora,duracion:o.fin-toMin(o.hora),preparacion:0,profId:o.profesional_id,equipo:o.equipo||"",estado:"confirmado",pagos:[]}));
}
async function loadMis(){
  const toks=leerTokens();S.clientes=[];S.misTurnos=[];S.misEspera=[];
  const res=await Promise.all(toks.map(tk=>sb.rpc("mis_datos",{p_token:tk}).then(r=>({tk,r}))));
  res.forEach(({tk,r},i)=>{
    if(r.error)return;
    if(!r.data){quitarToken(tk);return;}
    const d=r.data,tel=waNum(d.cliente.tel);
    let c=S.clientes.find(x=>x.tel===tel);
    if(!c){c={id:"m"+i,nombre:d.cliente.nombre,tel,credito:0,packs:[],token:null};S.clientes.push(c);}
    if(d.tipo==="cliente"){c.token=tk;c.credito=d.cliente.credito;c.packs=(d.paquetes||[]).map(mapPack);c.nombre=d.cliente.nombre;}
    (d.turnos||[]).forEach(x=>{
      const prev=S.misTurnos.find(t=>t.id===x.id);
      if(prev){if(d.tipo==="cliente")prev.token=tk;return;}
      S.misTurnos.push({id:x.id,clienteId:c.id,servicioId:x.servicio_id,servicioNombre:x.servicio_nombre,profId:x.profesional_id,duracion:x.duracion,precio:x.precio,senaMonto:x.sena_monto,
        fecha:x.fecha,hora:x.hora,estado:x.estado,holdHasta:x.hold_hasta?Date.parse(x.hold_hasta):null,pagos:x.pagado>0?[{monto:x.pagado}]:[],aFavor:x.a_favor||0,
        packId:x.paquete_id,packSesion:x.paquete_sesion,comprobante:x.comprobante,token:tk});
    });
    (d.espera||[]).forEach(e=>{if(!S.misEspera.find(x=>x.id===e.id))S.misEspera.push({id:e.id,clienteId:c.id,servicioId:e.servicio_id,profId:e.profesional_id,fecha:e.fecha,franja:e.franja,token:tk});});
  });
}
async function loadPublico(){await loadCatalogo(false);await Promise.all([loadOcupados(),loadMis()]);}
async function loadStaff(){
  await loadCatalogo(true);
  const desde=ymd(addDays(hoy0(),-400));
  const [tur,pag,cli,paq,ven,esp,not]=await Promise.all([
    fetchAll(()=>sb.from("turnos").select("*").gte("fecha",desde).order("fecha")),
    fetchAll(()=>sb.from("pagos").select("*").order("created_at")),
    fetchAll(()=>sb.from("clientes").select("id,nombre,tel,email,notas,credito,token,created_at").order("nombre")),
    fetchAll(()=>sb.from("paquetes").select("*")),
    esAdmin()?fetchAll(()=>sb.from("ventas").select("*")):Promise.resolve([]),
    fetchAll(()=>sb.from("espera").select("*").gte("fecha",hoyS())),
    esAdmin()?sb.from("notifs").select("*").order("created_at",{ascending:false}).limit(40).then(r=>{if(r.error)throw r.error;return r.data;}):Promise.resolve([])
  ]);
  const pagosPor={};pag.forEach(p=>{(pagosPor[p.turno_id]=pagosPor[p.turno_id]||[]).push({monto:p.monto,medio:p.medio,tipo:p.tipo,fecha:p.fecha});});
  S.turnos=tur.map(r=>mapTurno(r,pagosPor));
  S.clientes=cli.map(r=>({id:r.id,nombre:r.nombre,tel:r.tel,email:r.email||"",notas:r.notas||"",credito:r.credito||0,token:r.token||null,alta:String(r.created_at).slice(0,10),packs:paq.filter(k=>k.cliente_id===r.id).map(mapPack)}));
  S.ventas=ven.map(v=>({id:v.id,clienteId:v.cliente_id,concepto:v.concepto,monto:v.monto,medio:v.medio,fecha:v.fecha}));
  S.espera=esp.map(e=>({id:e.id,clienteId:e.cliente_id,servicioId:e.servicio_id,profId:e.profesional_id||"any",fecha:e.fecha,franja:e.franja||"",creado:Date.parse(e.created_at),avisado:e.avisado?Date.parse(e.avisado):null}));
  S.notifs=not.map(n=>({id:n.id,texto:n.texto,turnoId:n.turno_id,ts:Date.parse(n.created_at),leida:n.leida}));
}
async function rpc(fn,args){const {data,error}=await sb.rpc(fn,args);if(error)throw error;return data;}
async function upd(tabla,id,cambios){const q=sb.from(tabla).update(cambios);const {error}=await (id==null?q.eq("id",1):q.eq("id",id));if(error)throw error;}

/* ---------- disponibilidad (misma regla que el servidor) ---------- */
function rangosDe(p,svc,d){
  let r=(p.horario[d.getDay()]||[]).map(x=>[toMin(x.desde),toMin(x.hasta)]);
  if(svc&&svc.restringir){
    if(svc.dias.indexOf(d.getDay())<0)return [];
    const a=toMin(svc.desde),b=toMin(svc.hasta);
    r=r.map(x=>[Math.max(x[0],a),Math.min(x[1],b)]).filter(x=>x[1]>x[0]);
  }
  return r;
}
const bloqueosDe=(fecha,profId)=>S.bloqueos.filter(b=>b.fecha===fecha&&(!b.profId||b.profId===profId));
function slotsPro(fecha,svc,p,opts){
  opts=opts||{};
  if(!svc||!p||!p.activo||svc.profIds.indexOf(p.id)<0)return [];
  const d=parseYmd(fecha),hoy=hoy0();
  if(d<hoy)return [];
  if(!opts.panel&&d>addDays(hoy,S.config.ventana))return [];
  const bl=bloqueosDe(fecha,p.id);
  if(bl.some(b=>!b.desde))return [];
  const busy=S.turnos.filter(t=>t.fecha===fecha&&ocupa(t)&&t.id!==opts.ignorar&&(t.profId===p.id||(svc.equipo&&t.equipo===svc.equipo))).map(t=>[toMin(t.hora),finConPrep(t)]);
  bl.forEach(b=>busy.push([toMin(b.desde),toMin(b.hasta)]));
  const limite=new Date(ahoraAR().getTime()+(opts.panel?0:S.config.anticipacion)*60000);
  const out=[];
  rangosDe(p,svc,d).forEach(r=>{
    for(let m=r[0];m+svc.duracion<=r[1];m+=S.config.intervalo){
      const fin=m+svc.duracion+(svc.preparacion||0);
      if(busy.some(b=>m<b[1]&&fin>b[0]))continue;
      const st=new Date(d);st.setHours(Math.floor(m/60),m%60,0,0);
      if(st<limite)continue;
      out.push(fromMin(m));
    }
  });
  return out;
}
function slotsDe(fecha,svc,profSel,opts){
  if(!svc)return [];
  const ps=profSel&&profSel!=="any"?[proById(profSel)]:prosActivos().filter(p=>svc.profIds.indexOf(p.id)>=0);
  const map={};
  ps.forEach(p=>slotsPro(fecha,svc,p,opts).forEach(h=>{(map[h]=map[h]||[]).push(p.id);}));
  return Object.keys(map).sort((a,b)=>toMin(a)-toMin(b)).map(h=>({hora:h,pros:map[h]}));
}
/* al reprogramar, el turno propio no cuenta como ocupado */
function libresDe(f,s,p){
  if(!ui.reprog)return slotsDe(f,s,p);
  const t=misTurno(ui.reprog);if(!t)return slotsDe(f,s,p);
  const prev=S.turnos;
  S.turnos=prev.filter(o=>!(o.fecha===t.fecha&&o.hora===t.hora&&o.profId===t.profId));
  try{return slotsDe(f,s,p);}finally{S.turnos=prev;}
}
function lugaresEspera(e){
  const s=svcById(e.servicioId);if(!s)return [];
  const fr=FRANJAS.find(f=>f[0]===e.franja);
  return slotsDe(e.fecha,s,e.profId||"any").filter(x=>{const m=toMin(x.hora);return !fr||(m>=fr[2]&&m<fr[3]);});
}

/* ---------- estado de la interfaz ---------- */
function freshUI(){
  const t=ahoraAR();
  return {mode:"cliente",ctab:"reservar",step:"pro",checkout:false,done:null,busy:false,
    sel:{profId:null,servicioId:null,fecha:null,hora:null,horaPros:[],franja:null,nombre:"",tel:"",email:"",monto:"sena",medio:"transferencia"},
    mes:new Date(t.getFullYear(),t.getMonth(),1),formErr:"",comp:null,confirm:null,
    yo:null,sesion:null,loginErr:"",ptab:"agenda",vista:"semana",agProf:"todos",agendaFecha:ymd(t),hl:null,payFor:null,nt:null,ntErr:"",
    cliSel:null,cliQ:"",svcOpen:null,proOpen:null,notifOpen:false,ingPer:"prox4",recienConf:null,
    reprog:null,esperaForm:false,mover:null,csv:null,packForm:false,credForm:false,compUrls:{},cargado:false,errorCarga:""};
}
/* disponibilidad real para el cliente: sin horarios en todo el período = no se muestra */
let dispCache=null;
function hayDisp(proId,svc){
  dispCache=dispCache||{};
  const key=proId+"|"+(svc?svc.id:"*");
  if(key in dispCache)return dispCache[key];
  const p=proById(proId);let ok=false;
  const svcs=svc?[svc]:S.servicios.filter(x=>x.activo&&x.profIds.includes(proId));
  const hoy=hoy0();
  if(p)for(let i=0;i<=S.config.ventana&&!ok;i++){const f=ymd(addDays(hoy,i));for(const x of svcs){if(slotsPro(f,x,p).length){ok=true;break;}}}
  return dispCache[key]=ok;
}
const prosCliente=()=>prosActivos().filter(p=>hayDisp(p.id));
const svcDisponible=(x,pid)=>pid&&pid!=="any"?hayDisp(pid,x):x.profIds.some(id=>{const p=proById(id);return p&&p.activo&&!p.archivado&&hayDisp(id,x);});
const multiPro=()=>prosCliente().length>1;
const pasos=()=>multiPro()?["pro","svc","fecha","datos","pago"]:["svc","fecha","datos","pago"];
const NOMBRES_PASO={pro:"Profesional",svc:"Tratamiento",fecha:"Día y hora",datos:"Tus datos",pago:"Seña"};

/* ---------- vistas: cliente ---------- */
function stepsBar(){
  const ps=pasos(),idx=ps.indexOf(ui.step);
  return '<ol class="steps">'+ps.map((k,i)=>{const cls=i===idx?"on":(i<idx?"done":"");return `<li class="${cls}"><i>${i<idx?"✓":i+1}</i>${NOMBRES_PASO[k]}</li>`;}).join("")+"</ol>";
}
function resumen(){
  const s=svcById(ui.sel.servicioId);
  let pro="";
  if(ui.sel.hora&&ui.sel.horaPros.length)pro=proTag(ui.sel.horaPros[0]);
  else if(ui.sel.profId&&ui.sel.profId!=="any")pro=proTag(ui.sel.profId);
  else if(multiPro())pro='<span class="muted">Cualquiera disponible</span>';
  const rt=ui.reprog?misTurno(ui.reprog):null;
  return `<aside class="panel aside stack"><div class="eyebrow">${rt?"Reprogramación":"Tu reserva"}</div>
    ${s?`<h3>${esc(s.nombre)}</h3>`:'<p class="muted">Elegí un tratamiento.</p>'}
    ${rt?`<dl class="sum"><dt>Turno actual</dt><dd>${esc(fechaCorta(rt.fecha))} ${rt.hora}</dd></dl><p class="small muted">Lo que ya pagaste pasa al nuevo horario.</p><hr class="rule">`:""}
    <dl class="sum">${pro?`<dt>Profesional</dt><dd>${pro}</dd>`:""}${s?`<dt>Duración</dt><dd>${s.duracion} min</dd>`:""}
    <dt>Fecha</dt><dd>${ui.sel.fecha?esc(fechaLarga(ui.sel.fecha)):"—"}</dd><dt>Hora</dt><dd class="mono">${ui.sel.hora?ui.sel.hora+" hs":"—"}</dd></dl>
    ${s?`<hr class="rule"><dl class="sum"><dt>Precio</dt><dd class="mono">${$m(s.precio)}</dd>${s.sena<100?`<dt>Seña (${s.sena}%)</dt><dd class="mono">${$m(senaDe(s))}</dd>`:""}</dl>`:""}
    <p class="small muted">Podés reprogramar o cancelar online hasta ${S.config.cancelMin} minutos antes del turno.</p></aside>`;
}
function vReservar(){
  if(ui.reprog)return '<div class="fade"><div class="grid2"><div class="stack">'+vFechaHora()+"</div>"+resumen()+"</div></div>";
  if(ui.done)return vDone();
  if(pasos().indexOf(ui.step)<0)ui.step=pasos()[0];
  const inicio=ui.step===pasos()[0]&&!ui.sel.servicioId&&prosCliente().length?vBienvenida():"";
  if(ui.step==="pro")return '<div class="fade">'+inicio+stepsBar()+vElegirPro()+"</div>";
  if(ui.step==="svc")return '<div class="fade">'+inicio+stepsBar()+vElegirSvc()+"</div>";
  let body="";
  if(ui.step==="fecha")body=vFechaHora();
  if(ui.step==="datos")body=vDatos();
  if(ui.step==="pago")body=vPago();
  return '<div class="fade">'+stepsBar()+'<div class="grid2"><div class="stack">'+body+"</div>"+resumen()+"</div></div>";
}
function textoBienvenida(){
  const ps=prosCliente(),uno=ps.length===1?ps[0]:null,c=S.config;
  const sub=t=>t.replace(/\{profesional\}/g,uno?uno.nombre:"nuestro equipo").replace(/\{negocio\}/g,c.negocio);
  return {uno,titulo:sub(c.bienvenidaTitulo||`¡Te damos la bienvenida a ${c.negocio}!`),
    texto:sub(c.bienvenidaTexto||(uno?`Reservá tu turno con ${uno.nombre}: elegí el tratamiento, el día y el horario que mejor te quede.`:"Elegí con quién querés atenderte, el tratamiento y el horario que mejor te quede."))};
}
function vBienvenida(){
  const b=textoBienvenida();
  return `<section class="hero"><div class="stack" style="gap:6px;min-width:0"><h1>${esc(b.titulo)}</h1><p>${esc(b.texto)}</p></div>${b.uno?`<div class="hero-pro pc${b.uno.color}"><div class="av">${esc(b.uno.nombre.charAt(0))}</div><div style="min-width:0"><b>${esc(b.uno.nombre)}</b><span class="small muted">${esc(b.uno.rol)}</span></div></div>`:""}</section>`;
}
function sinTurnos(){return `<div class="panel stack"><h3>Por ahora no hay turnos disponibles</h3><p class="muted">Escribinos por WhatsApp${S.config.whatsapp?` al <span class="mono">+${esc(S.config.whatsapp)}</span>`:""} y te avisamos cuando se abran nuevos horarios.</p></div>`;}
function vElegirPro(){
  const ps=prosCliente();
  if(!ps.length)return sinTurnos();
  const cats=p=>[...new Set(S.servicios.filter(s=>s.activo&&s.profIds.includes(p.id)).map(s=>s.categoria))].join(" · ");
  return `<div class="stack"><div><h2>¿Con quién querés atenderte?</h2><p class="muted">Si te da lo mismo, te mostramos todos los horarios libres.</p></div>
    <div class="cards">
      <button class="card" data-a="pickPro" data-v="any" aria-pressed="${ui.sel.profId==="any"}"><div class="row"><div class="av">★</div><div><h3>Cualquiera disponible</h3><p class="small muted">Más horarios para elegir</p></div></div></button>
      ${ps.map(p=>`<button class="card pc${p.color}" data-a="pickPro" data-v="${p.id}" aria-pressed="${ui.sel.profId===p.id}"><div class="row"><div class="av">${esc(p.nombre.charAt(0))}</div><div style="min-width:0"><h3>${esc(p.nombre)}</h3><p class="small muted">${esc(p.rol)}</p></div></div><p class="small muted">${esc(cats(p))}</p></button>`).join("")}
    </div></div>`;
}
const diasTxt=s=>s.dias.slice().sort((a,b)=>((a+6)%7)-((b+6)%7)).map(d=>DIAS[d].toLowerCase()).join(", ");
function vElegirSvc(){
  const pid=ui.sel.profId;
  const act=S.servicios.filter(s=>s.activo&&svcDisponible(s,pid));
  const cats=[...new Set(act.map(s=>s.categoria))];
  const back=multiPro()?`<button class="btn sm ghost" data-a="step" data-v="pro">← Cambiar profesional</button>`:"";
  return `<div class="stack"><div class="row between"><div><h2>¿Qué tratamiento querés?</h2><p class="muted">${pid&&pid!=="any"&&multiPro()?"Tratamientos que hace "+esc(proNombre(pid))+".":"Elegí uno para ver los días y horarios libres."}</p></div>${back}</div>
    ${act.length?cats.map(c=>`<div class="cat">${esc(c||"Otros")}</div><div class="cards">${act.filter(s=>s.categoria===c).map(s=>`<button class="card" data-a="pickSvc" data-v="${s.id}" aria-pressed="${ui.sel.servicioId===s.id}"><h3>${esc(s.nombre)}</h3><p class="small muted">${esc(s.desc)}</p>${s.restringir?`<p class="small muted">Solo ${diasTxt(s)}</p>`:""}<div class="meta"><span class="small muted">${s.duracion} min</span><span class="price">${$m(s.precio)}</span></div></button>`).join("")}</div>`).join(""):sinTurnos()}</div>`;
}
function vFechaHora(){
  const s=svcById(ui.sel.servicioId),m=ui.mes,y=m.getFullYear(),mo=m.getMonth();
  if(!s)return '<div class="panel empty">Este tratamiento ya no está disponible.</div>';
  const first=new Date(y,mo,1),last=new Date(y,mo+1,0),hoy=hoy0(),lim=addDays(hoy,S.config.ventana);
  const canPrev=first>new Date(hoy.getFullYear(),hoy.getMonth(),1),canNext=new Date(y,mo+1,1)<=lim;
  let cells=["Lu","Ma","Mi","Ju","Vi","Sá","Do"].map(d=>`<div class="dow">${d}</div>`).join("");
  for(let i=0;i<(first.getDay()+6)%7;i++)cells+="<div></div>";
  for(let dn=1;dn<=last.getDate();dn++){
    const f=ymd(new Date(y,mo,dn)),n=libresDe(f,s,ui.sel.profId).length;
    const cls="day"+(n?" ok":"")+(ui.sel.fecha===f?" sel":"")+(f===ymd(hoy)?" today":"");
    cells+=n?`<button class="${cls}" data-a="pickDay" data-v="${f}" aria-label="${esc(fechaLarga(f))}, ${n} horarios">${dn}</button>`:`<button class="${cls}" disabled aria-label="${esc(fechaLarga(f))}, sin horarios">${dn}</button>`;
  }
  const cal=`<section class="panel"><div class="cal-head"><button class="btn sm ghost" data-a="mes" data-v="-1" ${canPrev?"":"disabled"} aria-label="Mes anterior">←</button><b>${cap(first.toLocaleDateString("es-AR",{month:"long",year:"numeric"}))}</b><button class="btn sm ghost" data-a="mes" data-v="1" ${canNext?"":"disabled"} aria-label="Mes siguiente">→</button></div><div class="cal">${cells}</div><div class="legend"><span>Con horarios libres</span><span class="n">Sin disponibilidad</span></div></section>`;
  let sl;
  if(ui.sel.fecha){
    const arr=libresDe(ui.sel.fecha,s,ui.sel.profId);
    const porF=FRANJAS.map(f=>[f,arr.filter(x=>{const mm=toMin(x.hora);return mm>=f[2]&&mm<f[3];})]);
    let fr=ui.sel.franja;
    if(!fr||!porF.find(x=>x[0][0]===fr&&x[1].length)){const p=porF.find(x=>x[1].length);fr=p?p[0][0]:null;}
    const lista=fr?porF.find(x=>x[0][0]===fr)[1]:[];
    sl=`<section class="panel"><h3>${esc(fechaLarga(ui.sel.fecha))}</h3><p class="small muted">Elegí la franja y después el horario de inicio (${s.duracion} min).</p>
      ${arr.length?`<div class="franjas" role="group" aria-label="Franja horaria">${porF.map(x=>`<button data-a="franja" data-v="${x[0][0]}" aria-pressed="${fr===x[0][0]}" ${x[1].length?"":"disabled"}>${x[0][1]}<small>${x[1].length}</small></button>`).join("")}</div>
      <div class="slots">${lista.map(x=>`<button class="slot" data-a="pickHora" data-v="${x.hora}" aria-pressed="${ui.sel.hora===x.hora}">${x.hora}</button>`).join("")}</div>`:'<p class="empty">Ya no quedan horarios este día.</p>'}</section>`;
  }else sl='<section class="panel"><p class="muted">Elegí un día marcado en el calendario para ver los horarios.</p></section>';
  if(ui.reprog){
    const otro=ui.sel.profId!=="any"&&s.profIds.filter(id=>{const p=proById(id);return p&&p.activo;}).length>1;
    return `<div class="row between"><div><h2>Reprogramar turno</h2><p class="muted small">${esc(s.nombre)}${ui.sel.profId!=="any"?" con "+esc(proNombre(ui.sel.profId)):" · cualquier profesional"}</p></div><button class="btn sm ghost" data-a="reprogCancel">← No reprogramar</button></div>
      ${otro?`<button class="btn sm" data-a="reprogAny" style="align-self:flex-start">Ver horarios con cualquier profesional</button>`:""}${cal}${sl}
      <div class="row end"><button class="btn pri" data-a="reprogOk" ${ui.sel.hora?"":"disabled"}>Confirmar nuevo horario</button></div>`;
  }
  return `<div class="row between"><h2>Elegí día y horario</h2><button class="btn sm ghost" data-a="step" data-v="svc">← Cambiar tratamiento</button></div>${cal}${sl}
    ${vEsperaForm(s)}
    <div class="row end"><button class="btn pri" data-a="step" data-v="datos" ${ui.sel.hora?"":"disabled"}>Continuar</button></div>`;
}
function vEsperaForm(s){
  if(!ui.esperaForm)return `<div class="row small muted"><span>¿Ningún horario te sirve?</span><button class="btn sm" data-a="esperaOpen">Anotarme en la lista de espera</button></div>`;
  const hoy=hoy0(),max=ymd(addDays(hoy,S.config.ventana));
  return `<form class="panel stack" data-f="espera"><div class="row between"><h3>Lista de espera</h3><button class="btn sm ghost" type="button" data-a="esperaClose">Cerrar</button></div>
    <p class="small muted">Si se libera un lugar para ${esc(s.nombre)} ese día, te avisamos por WhatsApp.</p>
    <div class="fgrid"><label class="f">Día<input type="date" id="esFecha" min="${ymd(hoy)}" max="${max}" value="${ui.sel.fecha||""}"></label>
    <label class="f">Franja<select id="esFranja"><option value="">Cualquier horario</option>${FRANJAS.map(f=>`<option value="${f[0]}">${f[1]}</option>`).join("")}</select></label>
    <label class="f">Nombre y apellido<input type="text" id="esNombre" autocomplete="name" value="${esc(ui.sel.nombre)}"></label>
    <label class="f">WhatsApp<input type="tel" id="esTel" autocomplete="tel" inputmode="tel" value="${esc(ui.sel.tel)}"></label></div>
    ${ui.formErr?`<p class="err">${esc(ui.formErr)}</p>`:""}
    <div class="row end"><button class="btn pri" type="submit">Anotarme</button></div></form>`;
}
function vDatos(){
  const s=ui.sel;
  return `<div class="row between"><h2>Tus datos</h2><button class="btn sm ghost" data-a="step" data-v="fecha">← Cambiar horario</button></div>
    <form class="panel stack" data-f="datos" novalidate>
    <label class="f">Nombre y apellido<input type="text" id="fNombre" autocomplete="name" value="${esc(s.nombre)}" required></label>
    <div class="fgrid"><label class="f">WhatsApp<input type="tel" id="fTel" autocomplete="tel" inputmode="tel" placeholder="11 5555 1234" value="${esc(s.tel)}" required></label>
    <label class="f"><span>Email <small>(opcional)</small></span><input type="email" id="fEmail" autocomplete="email" value="${esc(s.email)}"></label></div>
    <p class="small muted">Al WhatsApp te llegan la confirmación y el recordatorio del turno.</p>
    ${ui.formErr?`<p class="err">${esc(ui.formErr)}</p>`:""}
    <div class="row end"><button class="btn pri" type="submit">Continuar</button></div></form>`;
}
const cliPorTel=tel=>digits(tel).length>=10?S.clientes.find(x=>x.tel===waNum(tel)):null;
function vPago(){
  const s=svcById(ui.sel.servicioId),sena=senaDe(s);
  if(s.sena>=100)ui.sel.monto="total";
  if(S.config.exigirSena&&ui.sel.medio==="local")ui.sel.medio="transferencia";
  const c=cliPorTel(ui.sel.tel),identificado=c&&c.token,pk=identificado&&packDisponible(c,s.id),cred=identificado?c.credito||0:0,usaCred=cred>=sena&&cred>0;
  if(ui.sel.medio==="pack"&&!pk)ui.sel.medio="transferencia";
  if(ui.sel.medio==="saldo"&&!usaCred)ui.sel.medio="transferencia";
  const propios=(pk?`<label class="opt"><input type="radio" name="medio" value="pack" data-c="medio" ${ui.sel.medio==="pack"?"checked":""}><span><b>Usar una sesión de tu paquete</b><br><span class="small muted">Te quedan ${pk.total-pk.usadas} de ${pk.total}. No pagás nada ahora.</span></span><span class="tag ok">Paquete</span></label>`:"")
    +(usaCred?`<label class="opt"><input type="radio" name="medio" value="saldo" data-c="medio" ${ui.sel.medio==="saldo"?"checked":""}><span><b>Usar tu saldo a favor</b><br><span class="small muted">Se descuentan ${$m(Math.min(cred,s.precio))}${cred<s.precio?" y el resto ("+$m(s.precio-cred)+") lo abonás en el turno":""}.</span></span><span class="amt">${$m(cred)}</span></label>`:"");
  const notaCred=cred>0&&!usaCred?`<div class="note"><b>Tenés ${$m(cred)} a favor.</b> No alcanza para la seña, pero el centro te lo descuenta del saldo el día del turno.</div>`:"";
  const montos=!["local","pack","saldo"].includes(ui.sel.medio)?`<div class="eyebrow">¿Cuánto querés pagar ahora?</div><div class="opts2">
    ${s.sena<100?`<label class="opt"><input type="radio" name="monto" value="sena" data-c="monto" ${ui.sel.monto==="sena"?"checked":""}><span><b>Seña del ${s.sena}%</b><br><span class="small muted">El resto (${$m(s.precio-sena)}) en el turno.</span></span><span class="amt">${$m(sena)}</span></label>`:""}
    <label class="opt"><input type="radio" name="monto" value="total" data-c="monto" ${ui.sel.monto==="total"||s.sena>=100?"checked":""}><span><b>El total</b><br><span class="small muted">No pagás nada más.</span></span><span class="amt">${$m(s.precio)}</span></label></div>`:"";
  const btn=ui.sel.medio==="transferencia"?"Reservar y ver datos para transferir":"Confirmar turno";
  return `<div class="row between"><h2>Confirmá tu turno</h2><button class="btn sm ghost" data-a="step" data-v="datos">← Editar datos</button></div>
    ${notaCred}<div class="eyebrow">¿Cómo vas a pagar?</div>
    <div class="stack">${propios}
      <label class="opt"><input type="radio" name="medio" value="transferencia" data-c="medio" ${ui.sel.medio==="transferencia"?"checked":""}><span><b>Transferencia al alias</b><br><span class="small muted">Te guardamos el horario ${S.config.holdHoras} h para que envíes el comprobante. El centro confirma la seña.</span></span></label>
      ${S.config.exigirSena?"":`<label class="opt"><input type="radio" name="medio" value="local" data-c="medio" ${ui.sel.medio==="local"?"checked":""}><span><b>Pagar en el centro</b><br><span class="small muted">El turno queda reservado sin pago previo.</span></span></label>`}
    </div>${montos}
    <p class="small muted">${esc(politicaTxt())}</p>
    <div class="row end"><button class="btn pri" data-a="reservar" ${ui.busy?"disabled":""}>${ui.busy?"Reservando…":btn}</button></div>`;
}
function mpUrl(){const u=(S.config.mpLink||"").trim();return /^https:\/\/[^\s"<>]+$/i.test(u)?u:"";}
function bankBox(){
  const c=S.config;
  const mp=mpUrl()?`<div class="row"><a class="btn mp" href="${esc(mpUrl())}" target="_blank" rel="noopener">Pagar con Mercado Pago</a><span class="small muted">Después volvé acá y adjuntá el comprobante.</span></div>`:"";
  if(!c.alias&&!c.cbu)return mp||'<div class="note"><b>El centro todavía no cargó sus datos bancarios.</b> Escribile por WhatsApp para coordinar la seña.</div>';
  const row=(k,v)=>v?`<dt>${k}</dt><dd>${esc(v)}</dd><button class="btn sm" data-a="copy" data-v="${esc(v)}">Copiar</button>`:"";
  return `<dl class="bank">${row("Alias",c.alias)}${row("CBU/CVU",c.cbu)}${c.titular?`<dt>Titular</dt><dd>${esc(c.titular)}</dd><span></span>`:""}${c.banco?`<dt>Banco</dt><dd>${esc(c.banco)}</dd><span></span>`:""}</dl>${mp}`;
}
function linkPrivado(t){
  const c=cliById(t.clienteId),tk=(c&&c.token)||t.token;
  return `<div class="stack" style="gap:6px"><b class="small">Tu link de “Mis turnos”</b><div class="linkbox"><code>${esc(linkMis(tk))}</code><button class="btn sm" data-a="copy" data-v="${esc(linkMis(tk))}">Copiar</button></div><p class="small muted">Guardalo: con este link ves, reprogramás o cancelás tus turnos desde cualquier celular. No lo compartas.</p></div>`;
}
/* ---------- app instalable ---------- */
const INST_KEY="turnero-instalar-oculto";
let instEvento=null;
const esStandalone=()=>{try{return matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;}catch(e){return false;}};
const esIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
const puedeInstalar=()=>!esStandalone()&&(!!instEvento||esIOS());
const instOculto=()=>{try{return localStorage.getItem(INST_KEY)==="1";}catch(e){return false;}};
function vInstalar(){
  if(!puedeInstalar()||instOculto())return "";
  return `<div class="note inst"><span class="inst-ic"><img src="icons/icon-192.png" alt=""></span><span style="min-width:0"><b>Instalá la app</b><br><span class="small muted">Entrá a tus turnos con un toque desde la pantalla de inicio, sin buscar el link.</span></span><span class="row"><button class="btn sm pri" data-a="instalar">Instalar</button><button class="btn sm ghost" data-a="instalarNo">Ahora no</button></span></div>`;
}
function hojaIOS(){
  cerrarHoja();
  const d=document.createElement("div");d.className="hoja-fondo";d.id="hojaIOS";
  const cli=S.clientes.find(c=>c.token),tkIOS=(cli&&cli.token)||leerTokens()[0]||"";
  const comp='<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" style="vertical-align:-3px"><path d="M12 3v12M7.5 7.5 12 3l4.5 4.5M5 11v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-8" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  d.innerHTML=`<div class="hoja" role="dialog" aria-modal="true" aria-labelledby="hojaT"><div class="row between"><h3 id="hojaT">Instalar en iPhone</h3><button class="btn sm ghost" data-a="hojaCerrar" aria-label="Cerrar">✕</button></div>
    ${tkIOS?`<div class="note stack" style="gap:8px"><span><b>Antes de instalar, copiá tu link.</b> En iPhone la app guarda sus datos aparte de Safari: la primera vez que la abras, pegalo en “Mis turnos” para ver tus reservas.</span><div class="row"><button class="btn sm" data-a="copy" data-v="${esc(linkMis(tkIOS))}">Copiar mi link</button></div></div>`:""}
    <ol class="pasos"><li>Tocá el botón <b>Compartir</b> ${comp} en la barra de Safari (abajo o arriba).</li><li>Deslizá y elegí <b>“Agregar a inicio”</b>.</li><li>Tocá <b>Agregar</b>. Listo: el ícono queda en tu pantalla de inicio.</li></ol>
    <p class="small muted">Si no ves la opción, abrí este link en Safari.</p><div class="row end"><button class="btn pri" data-a="hojaCerrar">Entendido</button></div></div>`;
  d.addEventListener("click",e=>{if(e.target===d)cerrarHoja();});
  document.body.appendChild(d);
}
function cerrarHoja(){const h=document.getElementById("hojaIOS");if(h)h.remove();}
async function instalar(){
  if(instEvento){const ev=instEvento;instEvento=null;try{ev.prompt();const r=await ev.userChoice;if(r&&r.outcome==="accepted")toast("¡Listo! La app quedó instalada");}catch(e){}render();return;}
  if(esIOS())return hojaIOS();
  toast("Abrí el menú del navegador y elegí “Instalar app” o “Agregar a pantalla de inicio”");
}
window.addEventListener("beforeinstallprompt",e=>{e.preventDefault();instEvento=e;if(S.config)render();});
window.addEventListener("appinstalled",()=>{instEvento=null;if(S.config)render();});
if("serviceWorker" in navigator&&location.protocol==="https:")window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
function vDone(){
  const t=misTurno(ui.done);if(!t){ui.done=null;return vReservar();}
  const c=cliById(t.clienteId)||{nombre:"",tel:""};
  const head=(cls,eyebrow)=>`<div class="ticket-h ${cls}"><div class="eyebrow" style="color:inherit;opacity:.8">${eyebrow}</div><div class="when">${esc(fechaLarga(t.fecha))}</div><div class="mono" style="font-size:1.2rem">${t.hora} hs · ${t.duracion} min</div><div class="small" style="margin-top:4px">${esc(t.servicioNombre)} con ${esc(proNombre(t.profId))}</div></div>`;
  const wrap=x=>`<div class="fade stack" style="max-width:600px;margin:0 auto">${x}${vInstalar()}</div>`;
  if(t.estado==="pendiente_pago"){
    const msg=`Hola! Soy ${c.nombre}. Reservé ${t.servicioNombre} el ${fechaLarga(t.fecha)} a las ${t.hora} hs y transferí ${$m(t.senaMonto)}. Te envío el comprobante.`;
    return wrap(`<div class="ticket">${head("wait","Horario reservado · falta la seña")}
      <div class="ticket-b"><div class="hold"><span>⏱</span><span>Tenés hasta <b>${cuandoHold(t.holdHasta)}</b> para enviar el comprobante. Si no, el horario se libera.</span></div>
      <div><div class="eyebrow">Transferí</div><div class="big mono">${$m(t.senaMonto)}</div></div>${bankBox()}
      <div class="drop"><b>Adjuntá el comprobante</b><span class="small muted">Captura o PDF de la transferencia (hasta 5 MB).</span>
        <input type="file" id="compFile" accept="image/*,application/pdf" data-c="comp" aria-label="Comprobante">
        ${ui.comp?(ui.comp.dataUrl?`<img src="${ui.comp.dataUrl}" alt="Vista previa del comprobante">`:`<span class="small">Archivo: ${esc(ui.comp.nombre)}</span>`):""}
        <button class="btn pri" data-a="enviarComp" data-v="${t.id}" ${ui.comp&&!ui.busy?"":"disabled"}>${ui.busy?"Enviando…":"Enviar comprobante"}</button></div>
      ${linkPrivado(t)}
      <div class="row"><a class="btn wa" href="${esc(waLink(S.config.whatsapp,msg))}" target="_blank" rel="noopener">Mandarlo por WhatsApp</a>${ui.confirm==="ccan:"+t.id?`<button class="btn danger" data-a="cliCancel" data-v="${t.id}">Sí, cancelar reserva</button><button class="btn" data-a="noConfirm">No</button>`:`<button class="btn ghost" data-a="ask" data-v="ccan:${t.id}">Cancelar reserva</button>`}</div></div></div>`);
  }
  if(t.estado==="por_validar"){
    return wrap(`<div class="ticket">${head("wait","Comprobante recibido")}
      <div class="ticket-b"><p>Recibimos tu comprobante de <b class="mono">${$m(t.senaMonto)}</b>. El centro lo revisa y te confirma el turno por WhatsApp al <span class="mono">${esc(c.tel)}</span>.</p>
      <p class="small muted">Tu horario queda reservado mientras tanto.</p>${linkPrivado(t)}
      <div class="row"><button class="btn pri" data-a="nueva">Reservar otro turno</button><button class="btn" data-a="verMis">Ver mis turnos</button></div></div></div>`);
  }
  if(t.estado==="vencido"||t.estado==="cancelado"){
    return wrap(`<div class="panel stack"><h2>${t.estado==="vencido"?"La reserva venció":"Reserva cancelada"}</h2><p class="muted">El horario quedó libre. Podés elegir otro.</p><div class="row"><button class="btn pri" data-a="nueva">Reservar de nuevo</button></div></div>`);
  }
  const c2=cliById(t.clienteId);
  return wrap(`<div class="ticket">${head("","Turno confirmado")}
    <div class="ticket-b"><dl class="sum">${t.packId?`<dt>Paquete</dt><dd>Sesión ${t.packSesion||"—"} de ${(packById(c2,t.packId)||{total:"—"}).total}</dd>`:`<dt>Pagado</dt><dd class="mono">${$m(pagado(t))}</dd><dt>Saldo en el turno</dt><dd class="mono">${$m(saldo(t))}</dd>`}</dl>
    <div class="note"><b>Recordatorio por WhatsApp.</b> Te vamos a escribir al ${esc(c.tel)} antes del turno.</div>
    ${linkPrivado(t)}<p class="small muted">${esc(politicaTxt())}</p>
    <div class="row"><button class="btn pri" data-a="nueva">Reservar otro turno</button><button class="btn" data-a="verMis">Ver mis turnos</button></div></div></div>`);
}
function vMis(){
  const head=`<div class="stack" style="max-width:640px;margin:0 auto"><div><h2>Mis turnos</h2></div>${vInstalar()}`;
  if(!S.misTurnos.length&&!S.misEspera.length)return head+`<div class="panel stack"><p>No encontramos turnos guardados en este dispositivo.</p><p class="small muted">Abrí el link de “Mis turnos” que te dimos al reservar, o pegalo acá. Si no lo tenés, escribile al centro por WhatsApp${S.config.whatsapp?` al <span class="mono">+${esc(S.config.whatsapp)}</span>`:""}.</p>
    <form class="pega" data-f="pegarLink"><input type="text" inputmode="url" id="pegaLink" placeholder="Pegá tu link de Mis turnos" autocomplete="off" aria-label="Link de Mis turnos"><button class="btn" type="submit">Ver mis turnos</button></form><div class="row"><button class="btn pri" data-a="ctab" data-v="reservar">Reservar un turno</button></div></div></div>`;
  const ahora=ahoraAR();
  const ts=S.misTurnos.slice().sort((a,b)=>startOf(b)-startOf(a));
  const prox=ts.filter(t=>ACTIVOS.includes(t.estado)&&startOf(t)>ahora).reverse();
  const pas=ts.filter(t=>prox.indexOf(t)<0);
  const card=t=>{
    let acts="";
    if(prox.indexOf(t)>=0){
      if(t.estado==="pendiente_pago")acts+=`<button class="btn sm pri" data-a="verDone" data-v="${t.id}">Enviar comprobante</button>`;
      if(puedeCancelar(t)){
        if(ui.confirm==="ccan:"+t.id){
          const dev=devuelveSena(t),p=neto(t);
          const que=t.packId?(dev?"La sesión vuelve a tu paquete.":"Faltan menos de "+S.config.senaHoras+" h: la sesión del paquete se descuenta igual."):p>0?(dev?`Los ${$m(p)} que pagaste te quedan a favor.`:`Faltan menos de ${S.config.senaHoras} h: lo que pagaste (${$m(p)}) no se devuelve.`):"";
          acts+=`<div class="inline" style="width:100%"><span style="flex:1 1 220px">¿Cancelar este turno? ${que}</span><button class="btn sm danger" data-a="cliCancel" data-v="${t.id}">Sí, cancelar</button><button class="btn sm" data-a="noConfirm">No</button></div>`;
        }else acts+=`<button class="btn sm" data-a="reprog" data-v="${t.id}">Reprogramar</button><button class="btn sm danger" data-a="ask" data-v="ccan:${t.id}">Cancelar turno</button>`;
      }else acts+=`<span class="small muted">Faltan menos de ${S.config.cancelMin} min: ya no se puede cambiar online.</span>`;
    }
    const det=t.packId?`sesión ${t.packSesion||""} de tu paquete`:`pagado ${$m(pagado(t))} de ${$m(t.precio)}`;
    return `<div class="panel stack"><div class="row between"><div style="min-width:0"><b>${esc(fechaLarga(t.fecha))}</b> · <span class="mono">${t.hora} hs</span><div class="small muted">${esc(t.servicioNombre)} con ${esc(proNombre(t.profId))} · ${det}</div>${t.estado==="pendiente_pago"?`<div class="small" style="color:var(--warn)">Reservado hasta ${cuandoHold(t.holdHasta)}</div>`:""}${t.aFavor?`<div class="small" style="color:var(--ok)">${$m(t.aFavor)} pasaron a tu saldo a favor</div>`:""}</div><span class="pill ${t.estado}">${ESTADOS[t.estado]}</span></div>${acts?`<div class="row">${acts}</div>`:""}</div>`;
  };
  const cls=S.clientes.filter(c=>c.token);
  const resumenCli=cls.map(c=>(c.credito||c.packs.length)?`<div class="panel stack">${cls.length>1?`<b>${esc(c.nombre)}</b>`:""}${c.credito?`<div class="row between"><span>Saldo a favor</span><b class="mono" style="color:var(--ok)">${$m(c.credito)}</b></div>`:""}${c.packs.map(p=>`<div class="stack" style="gap:6px"><div class="row between"><span>Paquete · ${esc(p.nombre)}</span><span class="mono small">${p.usadas} de ${p.total} usadas</span></div><div class="bar"><i style="width:${Math.round(p.usadas/p.total*100)}%"></i></div></div>`).join("")}</div>`:"").join("");
  const espHtml=S.misEspera.length?`<div class="eyebrow">Lista de espera</div>`+S.misEspera.map(e=>{const s=svcById(e.servicioId);const fr=FRANJAS.find(f=>f[0]===e.franja);return `<div class="panel row between"><div style="min-width:0"><b>${esc(fechaLarga(e.fecha))}</b><div class="small muted">${esc(s?s.nombre:"")} · ${fr?fr[1].toLowerCase():"cualquier horario"}</div></div><button class="btn sm ghost" data-a="esperaQuitarCli" data-v="${e.id}">Salir de la lista</button></div>`;}).join(""):"";
  return head+`<p><b>${esc(S.clientes.map(c=>c.nombre).filter((v,i,a)=>a.indexOf(v)===i).join(" · "))}</b></p>${resumenCli}<div class="eyebrow">Próximos</div>${prox.length?prox.map(card).join(""):'<p class="muted">No tenés turnos próximos.</p>'}${espHtml}${pas.length?'<div class="eyebrow">Historial</div>'+pas.map(card).join(""):""}<p class="small muted">${esc(politicaTxt())}</p></div>`;
}

/* ---------- vistas: centro ---------- */
function vLogin(){
  return `<form class="panel stack fade" data-f="login" style="max-width:380px;margin:40px auto"><h2>Panel del centro</h2><p class="muted small">Ingresá con el email y la contraseña que te dio la administración.</p>
    <label class="f">Email<input type="email" id="lgEmail" autocomplete="username" required></label>
    <label class="f">Contraseña<input type="password" id="lgPass" autocomplete="current-password" required></label>
    ${ui.loginErr?`<p class="err">${esc(ui.loginErr)}</p>`:""}
    <button class="btn pri" type="submit" ${ui.busy?"disabled":""}>${ui.busy?"Ingresando…":"Ingresar"}</button>
    <button class="btn ghost sm" type="button" data-a="mode" data-v="cliente">← Volver a reservas</button></form>`;
}
function pendientesRecordar(){
  const now=ahoraAR(),lim=new Date(now.getTime()+S.config.recordatorioHoras*3600000);
  return S.turnos.filter(t=>{const st=startOf(t);return (t.estado==="confirmado"||t.estado==="por_validar")&&st>now&&st<=lim&&!t.recordado;});
}
function vPro(){
  if(!ui.sesion)return vLogin();
  if(!ui.yo)return `<div class="panel stack" style="max-width:420px;margin:40px auto"><h2>Sin acceso al panel</h2><p class="muted">Tu usuario (${esc(ui.sesion.user.email)}) todavía no está habilitado como personal del centro. Pedile a la administración que te dé acceso.</p><button class="btn" data-a="logout">Cerrar sesión</button></div>`;
  if(!ui.cargado)return ui.errorCarga?`<div class="panel stack"><p class="err">${esc(ui.errorCarga)}</p><button class="btn" data-a="recargar">Reintentar</button></div>`:'<p class="loading">Cargando agenda…</p>';
  const adm=esAdmin();
  const tabs=[["agenda","Agenda"],["senas","Señas"],["recordatorios","Recordatorios"],["espera","Lista de espera"]].concat(adm?[["ingresos","Ingresos"]]:[]).concat([["clientes","Clientes"]]).concat(adm?[["servicios","Tratamientos"],["disponibilidad","Disponibilidad"],["whatsapp","WhatsApp"],["ajustes","Ajustes"]]:[]);
  if(!tabs.find(t=>t[0]===ui.ptab))ui.ptab="agenda";
  const cnt={senas:S.turnos.filter(t=>t.estado==="por_validar").length,recordatorios:pendientesRecordar().length,espera:S.espera.filter(e=>!e.avisado&&lugaresEspera(e).length).length};
  const nNew=S.notifs.filter(n=>!n.leida).length;
  let h=`<div class="row between" style="margin-bottom:8px"><span class="eyebrow">${esc(ui.yo.nombre||ui.sesion.user.email)} · ${adm?"Administración":"Profesional"}</span><div class="row">${adm?`<button class="btn sm" data-a="notifs" aria-expanded="${ui.notifOpen}">Novedades ${nNew?`<span class="n">${nNew}</span>`:""}</button>`:""}${puedeInstalar()?'<button class="btn sm" data-a="instalar">Instalar app</button>':""}<button class="btn sm ghost" data-a="logout">Salir</button></div></div>`;
  if(ui.notifOpen&&adm)h+=`<div class="list notifs">${S.notifs.length?S.notifs.slice(0,15).map(n=>`<div class="notif ${n.leida?"":"new"}"><span>${esc(n.texto)}</span><time>${relTime(n.ts)}</time></div>`).join(""):'<p class="empty">Sin novedades.</p>'}${nNew?'<div style="padding:8px 14px"><button class="btn sm ghost" data-a="leerTodo">Marcar todo como leído</button></div>':""}</div>`;
  h+='<div class="tabs" role="tablist">'+tabs.map(t=>`<button role="tab" data-a="ptab" data-v="${t[0]}" aria-selected="${ui.ptab===t[0]}">${t[1]}${cnt[t[0]]?`<span class="count">${cnt[t[0]]}</span>`:""}</button>`).join("")+"</div>";
  const b={agenda:vAgenda,senas:vSenas,recordatorios:vRecordatorios,espera:vEspera,ingresos:vIngresos,clientes:vClientes,servicios:vServicios,disponibilidad:vDisponibilidad,whatsapp:vWhatsApp,ajustes:vAjustes}[ui.ptab]();
  return '<div class="fade">'+h+b+"</div>";
}
const filtroPro=t=>ui.agProf==="todos"||t.profId===ui.agProf;
function vAgenda(){
  const f=ui.agendaFecha,sem=ui.vista==="semana";
  const ini=sem?lunes(parseYmd(f)):parseYmd(f),fin=addDays(ini,sem?6:0);
  const mes=d=>d.toLocaleDateString("es-AR",{month:"short"}).replace(".","");
  const titulo=sem?`Semana del ${ini.getDate()} ${mes(ini)} al ${fin.getDate()} ${mes(fin)}`:fechaLarga(f);
  const enRango=S.turnos.filter(t=>{const d=parseYmd(t.fecha);return d>=ini&&d<=fin&&filtroPro(t);});
  const act=enRango.filter(ocupa);
  const fact=act.reduce((a,t)=>a+facturacion(t),0);
  const cobr=enRango.filter(cuentaIngreso).reduce((a,t)=>a+neto(t),0);
  const pend=enRango.filter(t=>t.estado==="pendiente_pago"||t.estado==="por_validar").length;
  const pros=esAdmin()?prosPanel():prosPanel().filter(p=>p.id===ui.yo.profId);
  let html=`<div class="row between" style="margin-bottom:12px"><div><div class="eyebrow">${sem?"Agenda semanal":(f===hoyS()?"Hoy":"Agenda del día")}</div><h2>${esc(titulo)}</h2></div><button class="btn pri" data-a="ntOpen">+ Nuevo turno</button></div>
    <div class="row between" style="margin-bottom:14px"><div class="row"><div class="seg" role="group" aria-label="Vista"><button data-a="vista" data-v="dia" aria-pressed="${!sem}">Día</button><button data-a="vista" data-v="semana" aria-pressed="${sem}">Semana</button></div>
      ${pros.length>1?`<select id="agProf" data-c="agProf" style="width:auto" aria-label="Profesional"><option value="todos">Todos los profesionales</option>${pros.map(p=>`<option value="${p.id}" ${ui.agProf===p.id?"selected":""}>${esc(p.nombre)}</option>`).join("")}</select>`:""}</div>
      <div class="row"><button class="btn sm" data-a="adia" data-v="-1" aria-label="Anterior">←</button><button class="btn sm" data-a="ahoy">Hoy</button><button class="btn sm" data-a="adia" data-v="1" aria-label="Siguiente">→</button><input type="date" id="agendaFecha" data-c="agendaFecha" value="${f}" style="width:auto" aria-label="Ir a fecha"></div></div>`;
  if(ui.nt)html+=vNuevoTurno();
  html+=`<div class="stats" style="margin-bottom:16px"><div class="stat"><b>${act.length}</b><span>Turnos</span></div><div class="stat"><b>${$m(fact)}</b><span>Facturación</span></div><div class="stat"><b>${$m(cobr)}</b><span>Ya cobrado</span></div><div class="stat"><b>${pend}</b><span>Con seña pendiente</span></div></div>`;
  return html+(sem?vSemana(ini):vDia(f));
}
function vSemana(ini){
  const dias=[];for(let i=0;i<7;i++)dias.push(addDays(ini,i));
  const pros=prosPanel().filter(p=>(ui.agProf==="todos"||p.id===ui.agProf)&&(esAdmin()||p.id===ui.yo.profId));
  const ts=S.turnos.filter(t=>ocupa(t)&&filtroPro(t));
  const domingo=ymd(dias[6]);
  const usaDom=pros.some(p=>(p.horario[0]||[]).length)||ts.some(t=>t.fecha===domingo);
  const cols=usaDom?dias:dias.slice(0,6);
  let a=24*60,b=0;
  pros.forEach(p=>Object.keys(p.horario).forEach(k=>p.horario[k].forEach(r=>{a=Math.min(a,toMin(r.desde));b=Math.max(b,toMin(r.hasta));})));
  cols.forEach(d=>ts.filter(t=>t.fecha===ymd(d)).forEach(t=>{a=Math.min(a,toMin(t.hora));b=Math.max(b,toMin(t.hora)+t.duracion);}));
  if(a>=b){a=8*60;b=20*60;}
  a=Math.floor(a/60)*60;b=Math.ceil(b/60)*60;
  const H=b-a,hs=hoyS();
  let horas="";for(let m=a+60;m<b;m+=60)horas+=`<span style="top:${m-a}px">${fromMin(m)}</span>`;
  let html=`<div class="wk"><div class="wk-in" style="--n:${cols.length}"><div class="wk-corner"></div>`;
  cols.forEach(d=>{const s=ymd(d),dt=ts.filter(t=>t.fecha===s);html+=`<button class="wk-h ${s===hs?"today":""}" data-a="irDia" data-v="${s}"><b>${DCORTO[d.getDay()]} ${d.getDate()}</b><span>${dt.length} · ${kfmt(dt.reduce((x,t)=>x+facturacion(t),0))}</span></button>`;});
  html+=`<div class="wk-times" style="height:${H}px">${horas}</div>`;
  cols.forEach(d=>{
    const s=ymd(d);
    const dt=ts.filter(t=>t.fecha===s).sort((x,y)=>toMin(x.hora)-toMin(y.hora));
    const lanes=[],lane={};
    dt.forEach(t=>{const st=toMin(t.hora);let i=lanes.findIndex(e=>e<=st);if(i<0){i=lanes.length;lanes.push(0);}lanes[i]=st+t.duracion;lane[t.id]=i;});
    const n=Math.max(1,lanes.length),w=100/n;
    let inner="";
    S.bloqueos.filter(x=>x.fecha===s&&(ui.agProf==="todos"||!x.profId||x.profId===ui.agProf)).forEach(x=>{
      const d0=Math.max(a,x.desde?toMin(x.desde):a),d1=Math.min(b,x.hasta?toMin(x.hasta):b);
      inner+=`<div class="blk bloq" style="top:${d0-a}px;height:${Math.max(18,d1-d0)}px;left:2px;right:2px">${esc(x.motivo||"Bloqueado")}${x.profId?" · "+esc(proNombre(x.profId)):""}</div>`;
    });
    dt.forEach(t=>{
      const p=proById(t.profId)||{color:1},c=cliById(t.clienteId)||{nombre:"—"};
      const top=toMin(t.hora)-a,h=Math.max(20,t.duracion-2);
      const cls=(t.estado==="pendiente_pago"||t.estado==="por_validar")?" pend":(t.estado==="completado"||t.estado==="ausente")?" done":"";
      inner+=`<button class="blk pc${p.color}${cls}" data-a="verTurno" data-v="${t.id}" style="top:${top}px;height:${h}px;left:calc(${lane[t.id]*w}% + 2px);width:calc(${w}% - 4px)" title="${esc(t.hora+" "+c.nombre+" · "+t.servicioNombre+" · "+ESTADOS[t.estado])}"><b><span class="dot"></span>${t.hora}</b>${esc(c.nombre.split(" ")[0])}${h>34&&n<3?`<br><span class="muted">${esc(t.servicioNombre)}</span>`:""}</button>`;
    });
    html+=`<div class="wk-col" style="height:${H}px">${inner}</div>`;
  });
  html+=`</div></div><div class="wk-legend">${pros.map(p=>`<span class="who-pro pc${p.color}"><span class="dot"></span>${esc(p.nombre)}</span>`).join("")}<span>Rayado: seña pendiente</span><span>Tocá un turno o un día para ver el detalle</span></div>`;
  return html;
}
function vDia(f){
  const del=S.turnos.filter(t=>t.fecha===f&&filtroPro(t)).sort((a,b)=>toMin(a.hora)-toMin(b.hora));
  const bl=S.bloqueos.filter(b=>b.fecha===f);
  const html=bl.length?`<div class="row" style="margin-bottom:10px">${bl.map(b=>`<span class="chip" style="padding-right:12px">${b.desde?b.desde+"–"+b.hasta:"Todo el día"} · ${esc(b.motivo||"Bloqueado")}${b.profId?" · "+esc(proNombre(b.profId)):""}</span>`).join("")}</div>`:"";
  if(!del.length)return html+'<div class="list empty">No hay turnos este día.</div>';
  return html+'<div class="list">'+del.map(apptRow).join("")+"</div>";
}
function apptRow(t){
  const c=cliById(t.clienteId)||{nombre:"(cliente)",tel:"",credito:0};
  const fin=fromMin(toMin(t.hora)+t.duracion);
  let acts="";
  if(t.estado==="por_validar"||t.estado==="pendiente_pago")acts+=`<button class="btn sm pri" data-a="senaOk" data-v="${t.id}">Confirmar seña</button>`;
  if(ACTIVOS.includes(t.estado)){
    if(t.estado==="confirmado"&&saldo(t)>0)acts+=`<button class="btn sm" data-a="payFor" data-v="${t.id}">Registrar pago</button>`;
    if(t.estado==="confirmado")acts+=`<button class="btn sm" data-a="estado" data-v="${t.id}" data-e="completado">Atendido</button><button class="btn sm" data-a="estado" data-v="${t.id}" data-e="ausente">No vino</button>`;
    acts+=`<button class="btn sm" data-a="mover" data-v="${t.id}">Mover</button>`;
    if(ui.confirm==="pcan:"+t.id){
      acts+=(neto(t)>0||t.packId)?`<button class="btn sm" data-a="proCancel" data-v="${t.id}" data-m="favor">Cancelar · ${t.packId?"devolver sesión":"queda a favor"}</button><button class="btn sm danger" data-a="proCancel" data-v="${t.id}" data-m="pierde">Cancelar · ${t.packId?"se descuenta":"se retiene"}</button>`:`<button class="btn sm danger" data-a="proCancel" data-v="${t.id}" data-m="favor">Confirmar cancelación</button>`;
      acts+=`<button class="btn sm" data-a="noConfirm">No</button>`;
    }else acts+=`<button class="btn sm danger" data-a="ask" data-v="pcan:${t.id}">Cancelar</button>`;
    acts+=`<a class="btn sm wa" href="${esc(waLink(c.tel,fillTpl(S.config.mensaje,t)))}" target="_blank" rel="noopener" data-a="recordado" data-v="${t.id}">WhatsApp</a>`;
  }else if(t.estado==="completado"&&saldo(t)>0)acts+=`<button class="btn sm" data-a="payFor" data-v="${t.id}">Registrar pago</button>`;
  else if(t.estado==="completado"||t.estado==="ausente")acts+=`<button class="btn sm ghost" data-a="estado" data-v="${t.id}" data-e="confirmado">Deshacer</button>`;
  const medios=MEDIOS.concat(c.credito>0?["Saldo a favor"]:[]);
  const pay=ui.payFor===t.id?`<form class="inline" data-f="pay" data-v="${t.id}"><label class="f">Monto<input type="number" id="payMonto" min="1" step="1" value="${saldo(t)}"></label><label class="f">Medio<select id="payMedio">${medios.map(m=>`<option>${m}</option>`).join("")}</select></label><button class="btn sm pri" type="submit">Guardar</button><button class="btn sm" type="button" data-a="payFor" data-v="">Cerrar</button></form>`:"";
  let mv="";
  if(ui.mover&&ui.mover.id===t.id){
    const s=svcById(t.servicioId),p=proById(t.profId);
    const sl=s&&p?slotsPro(ui.mover.fecha,s,p,{panel:true,ignorar:t.id}):[];
    mv=`<form class="inline" data-f="mv" data-v="${t.id}"><label class="f">Nueva fecha<input type="date" id="mvFecha" data-c="mv" value="${ui.mover.fecha}"></label><label class="f">Hora libre<select id="mvHora" ${sl.length?"":"disabled"}>${sl.length?sl.map(h=>`<option ${h===t.hora&&ui.mover.fecha===t.fecha?"selected":""}>${h}</option>`).join(""):"<option>Sin horarios libres</option>"}</select></label><button class="btn sm pri" type="submit" ${sl.length?"":"disabled"}>Mover turno</button><button class="btn sm" type="button" data-a="mover" data-v="">Cerrar</button></form>`;
  }
  const det=t.packId?`<span class="tag ok">Paquete · sesión ${t.packSesion||"—"}</span>`:`<span class="mono">${$m(pagado(t))}</span> de <span class="mono">${$m(t.precio)}</span>${saldo(t)>0&&ocupa(t)?` · saldo <span class="mono">${$m(saldo(t))}</span>`:""}`;
  return `<div class="appt ${t.estado}${ui.hl===t.id?" hl":""}" id="t_${t.id}"><div class="t">${t.hora}<small>${fin}</small></div>
    <div style="min-width:0"><div class="row" style="gap:8px"><b class="who">${esc(c.nombre)}</b><span class="pill ${t.estado}">${ESTADOS[t.estado]}</span>${c.credito>0&&ACTIVOS.includes(t.estado)?`<span class="tag ok">A favor ${$m(c.credito)}</span>`:""}${t.origen==="panel"?'<span class="small muted">· cargado en el panel</span>':""}</div>
    <div class="small muted">${esc(t.servicioNombre)} · ${proTag(t.profId)}</div>
    <div class="small muted">${det}${t.estado==="pendiente_pago"?` · reservado hasta ${cuandoHold(t.holdHasta)}`:""}${t.aFavor?` · ${$m(t.aFavor)} pasó a saldo a favor`:""}${t.estado==="cancelado"&&neto(t)>0?` · seña retenida ${$m(neto(t))}`:""}</div>${pay}${mv}</div>
    <div class="acts">${acts}</div></div>`;
}
function vNuevoTurno(){
  const n=ui.nt,s=svcById(n.svcId);
  let pros=s?prosActivos().filter(p=>s.profIds.includes(p.id)):[];
  if(!esAdmin())pros=pros.filter(p=>p.id===ui.yo.profId);
  if(s&&!pros.find(p=>p.id===n.profId))n.profId=pros[0]?pros[0].id:"";
  const slots=s&&n.profId&&n.fecha?slotsPro(n.fecha,s,proById(n.profId),{panel:true}):[];
  if(!n.sobre&&n.hora&&slots.indexOf(n.hora)<0)n.hora="";
  const pkNT=n.cliId&&s?packDisponible(cliById(n.cliId),s.id):null;
  if(n.pago==="pack"&&!pkNT)n.pago="ninguno";
  const svcs=esAdmin()?S.servicios:S.servicios.filter(x=>x.profIds.includes(ui.yo.profId));
  return `<form class="panel stack" data-f="nt" style="margin-bottom:16px"><div class="row between"><h3>Nuevo turno</h3><button class="btn sm ghost" type="button" data-a="ntClose">Cerrar</button></div>
    <div class="fgrid">
      <label class="f">Cliente<select id="ntCli" data-c="nt" data-k="cliId"><option value="">+ Cliente nuevo</option>${S.clientes.slice().sort((a,b)=>a.nombre.localeCompare(b.nombre)).map(c=>`<option value="${c.id}" ${n.cliId===c.id?"selected":""}>${esc(c.nombre)}</option>`).join("")}</select></label>
      ${n.cliId?"":`<label class="f">Nombre<input type="text" id="ntNombre" value="${esc(n.nombre)}"></label><label class="f">WhatsApp<input type="tel" id="ntTel" value="${esc(n.tel)}"></label>`}
      <label class="f">Tratamiento<select id="ntSvc" data-c="nt" data-k="svcId"><option value="">Elegí…</option>${svcs.map(x=>`<option value="${x.id}" ${n.svcId===x.id?"selected":""}>${esc(x.nombre)}${x.activo?"":" (oculto)"}</option>`).join("")}</select></label>
      <label class="f">Profesional<select id="ntPro" data-c="nt" data-k="profId" ${s?"":"disabled"}>${pros.length?pros.map(p=>`<option value="${p.id}" ${n.profId===p.id?"selected":""}>${esc(p.nombre)}</option>`).join(""):"<option>—</option>"}</select></label>
      <label class="f">Fecha<input type="date" id="ntFecha" data-c="nt" data-k="fecha" value="${n.fecha}"></label>
      ${n.sobre?`<label class="f">Hora (sobreturno)<input type="time" id="ntHoraL" data-c="nt" data-k="hora" value="${n.hora}"></label>`:`<label class="f">Hora libre<select id="ntHora" data-c="nt" data-k="hora" ${slots.length?"":"disabled"}><option value="">${s?(slots.length?"Elegí…":"Sin horarios libres"):"Elegí tratamiento"}</option>${slots.map(h=>`<option ${n.hora===h?"selected":""}>${h}</option>`).join("")}</select></label>`}
      <label class="f">Pago recibido<select id="ntPago" data-c="nt" data-k="pago"><option value="ninguno" ${n.pago==="ninguno"?"selected":""}>Todavía no</option><option value="sena" ${n.pago==="sena"?"selected":""}>Seña${s?" ("+$m(senaDe(s))+")":""}</option><option value="total" ${n.pago==="total"?"selected":""}>Total${s?" ("+$m(s.precio)+")":""}</option>${pkNT?`<option value="pack" ${n.pago==="pack"?"selected":""}>Sesión de paquete (quedan ${pkNT.total-pkNT.usadas})</option>`:""}</select></label>
      ${n.pago!=="ninguno"&&n.pago!=="pack"?`<label class="f">Medio<select id="ntMedio" data-c="nt" data-k="medio">${MEDIOS.map(m=>`<option ${n.medio===m?"selected":""}>${m}</option>`).join("")}</select></label>`:""}
    </div>
    <label class="switch small"><input type="checkbox" id="ntSobre" data-c="nt" data-k="sobre" ${n.sobre?"checked":""}>Sobreturno (fuera de los horarios disponibles)</label>
    ${ui.ntErr?`<p class="err">${esc(ui.ntErr)}</p>`:""}
    <div class="row end"><button class="btn pri" type="submit" ${ui.busy?"disabled":""}>Guardar turno</button></div></form>`;
}
function vSenas(){
  const pv=S.turnos.filter(t=>t.estado==="por_validar").sort((a,b)=>(a.comprobante?a.comprobante.subido:0)-(b.comprobante?b.comprobante.subido:0));
  const pp=S.turnos.filter(t=>t.estado==="pendiente_pago").sort((a,b)=>a.holdHasta-b.holdHasta);
  let html='<div class="stack"><div><h2>Señas</h2><p class="muted">Revisá cada comprobante contra tu cuenta antes de confirmar. Las reservas sin comprobante se liberan solas cuando vencen.</p></div>';
  if(ui.recienConf){const t=turnoById(ui.recienConf);if(t){const c=cliById(t.clienteId)||{nombre:"",tel:""};html+=`<div class="banner ok"><span>Seña de <b>${esc(c.nombre)}</b> confirmada.</span><span class="row"><a class="btn sm wa" href="${esc(waLink(c.tel,fillTpl(S.config.mensajeConfirmacion,t)))}" target="_blank" rel="noopener">Avisarle por WhatsApp</a><button class="btn sm ghost" data-a="cerrarConf">Listo</button></span></div>`;}}
  const card=(t,modo)=>{
    const c=cliById(t.clienteId)||{nombre:"—",tel:""};
    let comp="";
    if(t.comprobante){
      const u=ui.compUrls[t.comprobante.path];
      if(u===undefined)pedirUrl(t.comprobante.path);
      const esPdf=/\.pdf$/i.test(t.comprobante.path);
      comp=`<div class="comp stack" style="gap:6px"><span class="small muted">Comprobante enviado ${relTime(t.comprobante.subido)} · ${esc(t.comprobante.nombre||"")}</span>${u?(esPdf?`<a class="btn sm" href="${esc(u)}" target="_blank" rel="noopener">Abrir PDF ↗</a>`:`<a href="${esc(u)}" target="_blank" rel="noopener"><img src="${esc(u)}" alt="Comprobante de ${esc(c.nombre)}"></a>`):'<span class="small muted">Cargando comprobante…</span>'}</div>`;
    }
    const acts=modo==="pv"
      ?`<button class="btn sm pri" data-a="senaOk" data-v="${t.id}">Confirmar seña</button>${ui.confirm==="rech:"+t.id?`<button class="btn sm" data-a="senaReintento" data-v="${t.id}">Pedir otro comprobante</button><button class="btn sm danger" data-a="liberar" data-v="${t.id}">Liberar horario</button><button class="btn sm ghost" data-a="noConfirm">Volver</button>`:`<button class="btn sm danger" data-a="ask" data-v="rech:${t.id}">Rechazar</button>`}`
      :`<button class="btn sm" data-a="senaOk" data-v="${t.id}">Ya vi la transferencia</button><button class="btn sm" data-a="extender" data-v="${t.id}">+${S.config.holdHoras} h</button>${ui.confirm==="lib:"+t.id?`<button class="btn sm danger" data-a="liberar" data-v="${t.id}">Sí, liberar</button><button class="btn sm ghost" data-a="noConfirm">No</button>`:`<button class="btn sm danger" data-a="ask" data-v="lib:${t.id}">Liberar horario</button>`}`;
    return `<div class="appt"><div class="t">${t.hora}<small>${fechaDM(t.fecha)}</small></div><div style="min-width:0" class="stack"><div><div class="row" style="gap:8px"><b>${esc(c.nombre)}</b><span class="pill ${t.estado}">${ESTADOS[t.estado]}</span></div>
      <div class="small muted">${esc(t.servicioNombre)} · ${proTag(t.profId)} · seña <span class="mono">${$m(t.senaMonto)}</span>${modo==="pp"?` · vence ${cuandoHold(t.holdHasta)}`:""}</div></div>${comp}</div><div class="acts">${acts}</div></div>`;
  };
  html+=`<h3>Comprobantes por revisar <span class="muted mono">${pv.length}</span></h3>${pv.length?'<div class="list">'+pv.map(t=>card(t,"pv")).join("")+"</div>":'<div class="list empty">No hay comprobantes para revisar.</div>'}`;
  html+=`<h3>Esperando transferencia <span class="muted mono">${pp.length}</span></h3>${pp.length?'<div class="list">'+pp.map(t=>card(t,"pp")).join("")+"</div>":'<div class="list empty">Nadie está pendiente de transferir.</div>'}`;
  return html+"</div>";
}
function pedirUrl(path){
  ui.compUrls[path]=null;
  sb.storage.from("comprobantes").createSignedUrl(path,3600).then(({data,error})=>{ui.compUrls[path]=error?"":data.signedUrl;render();});
}
function vRecordatorios(){
  const list=pendientesRecordar().sort((a,b)=>startOf(a)-startOf(b));
  const man=ymd(addDays(hoy0(),1));
  let html=`<div class="stack"><div><h2>Recordatorios por WhatsApp</h2><p class="muted">Turnos de las próximas ${S.config.recordatorioHoras} horas que todavía no recibieron aviso.</p></div>
    <div class="note"><b>Cómo funciona.</b> Cada botón abre WhatsApp con el mensaje listo. Para que salgan solos hace falta conectar la API de WhatsApp Business (paso 3). Los mensajes se editan en Ajustes.</div>`;
  html+=list.length?'<div class="list">'+list.map(t=>{const c=cliById(t.clienteId)||{nombre:"",tel:""};return `<div class="appt"><div class="t">${t.hora}<small>${fechaDM(t.fecha)}</small></div><div style="min-width:0" class="stack"><div><b>${esc(c.nombre)}</b> <span class="small muted mono">+${esc(waNum(c.tel))}</span> · ${proTag(t.profId)}</div><div class="msg">${esc(fillTpl(S.config.mensaje,t))}</div></div><div class="acts"><a class="btn sm wa" href="${esc(waLink(c.tel,fillTpl(S.config.mensaje,t)))}" target="_blank" rel="noopener" data-a="recordado" data-v="${t.id}">Enviar por WhatsApp</a><button class="btn sm ghost" data-a="recordado" data-v="${t.id}">Marcar enviado</button></div></div>`;}).join("")+"</div>":'<div class="list empty">No hay recordatorios pendientes para clientes.</div>';
  const pros=esAdmin()?prosActivos():prosActivos().filter(p=>p.id===ui.yo.profId);
  html+=`<h3>Agenda de mañana ${pros.length>1?"para cada profesional":""}</h3><div class="list">`+pros.map(p=>{
    const ts=S.turnos.filter(t=>t.fecha===man&&t.profId===p.id&&ocupa(t)).sort((a,b)=>toMin(a.hora)-toMin(b.hora));
    const txt=`Hola ${p.nombre.split(" ")[0]}! Tu agenda de mañana (${fechaLarga(man)}):\n`+(ts.length?ts.map(t=>`• ${t.hora} ${(cliById(t.clienteId)||{nombre:""}).nombre} – ${t.servicioNombre}${t.estado!=="confirmado"?" ("+ESTADOS[t.estado].toLowerCase()+")":""}`).join("\n"):"Sin turnos.");
    return `<div class="appt"><div class="t"><div class="av pc${p.color}">${esc(p.nombre.charAt(0))}</div></div><div style="min-width:0" class="stack"><b>${esc(p.nombre)} <span class="small muted">${ts.length} turnos</span></b><div class="msg">${esc(txt)}</div></div><div class="acts">${p.tel?`<a class="btn sm wa" href="${esc(waLink(p.tel,txt))}" target="_blank" rel="noopener">Enviar por WhatsApp</a>`:'<span class="small muted">Cargá su WhatsApp en Disponibilidad</span>'}</div></div>`;
  }).join("")+"</div></div>";
  return html;
}
function vEspera(){
  const list=S.espera.map(e=>({e,l:lugaresEspera(e)})).sort((a,b)=>(b.l.length&&!b.e.avisado)-(a.l.length&&!a.e.avisado)||a.e.fecha.localeCompare(b.e.fecha));
  const html=`<div class="stack"><div><h2>Lista de espera</h2><p class="muted">Clientes que buscan lugar un día completo. Cuando se libera un horario que les sirve, aparece arriba con el mensaje listo para avisarles.</p></div>`;
  if(!list.length)return html+'<div class="list empty">Nadie está esperando lugar.</div></div>';
  return html+'<div class="list">'+list.map(({e,l})=>{
    const c=cliById(e.clienteId)||{nombre:"—",tel:""},s=svcById(e.servicioId)||{nombre:"(tratamiento borrado)"},fr=FRANJAS.find(f=>f[0]===e.franja);
    const msg=l.length?`Hola ${c.nombre.split(" ")[0]}! Se liberó un lugar para ${s.nombre} el ${fechaLarga(e.fecha)} a las ${l[0].hora} hs${l.length>1?" (también "+l.slice(1,4).map(x=>x.hora).join(", ")+")":""}. ¿Te lo reservamos? Respondé este mensaje o reservá desde la página de turnos.`:"";
    const estado=l.length?(e.avisado?`<span class="tag">Avisado ${relTime(e.avisado)}</span>`:`<span class="tag ok">Hay lugar: ${l.slice(0,4).map(x=>x.hora).join(", ")}${l.length>4?"…":""}</span>`):`<span class="tag warn">Sin lugar todavía</span>`;
    return `<div class="appt"><div class="t">${fechaDM(e.fecha)}<small>${fr?fr[1]:"Cualquiera"}</small></div><div style="min-width:0;gap:6px" class="stack"><div><div class="row" style="gap:8px"><b>${esc(c.nombre)}</b>${estado}</div><div class="small muted">${esc(s.nombre)} · ${e.profId&&e.profId!=="any"?proTag(e.profId):"cualquier profesional"} · anotado ${relTime(e.creado)}</div></div>${msg&&!e.avisado?`<div class="msg">${esc(msg)}</div>`:""}</div>
      <div class="acts">${msg?`<a class="btn sm wa" href="${esc(waLink(c.tel,msg))}" target="_blank" rel="noopener" data-a="esperaAvisado" data-v="${e.id}">Avisar por WhatsApp</a>`:""}<button class="btn sm ghost" data-a="esperaQuitar" data-v="${e.id}">Quitar</button></div></div>`;
  }).join("")+"</div></div>";
}
function periodo(){
  const h=hoy0();let a,b,lab;
  if(ui.ingPer==="semana"){a=lunes(h);b=addDays(a,6);lab="Esta semana";}
  else if(ui.ingPer==="mes"){a=new Date(h.getFullYear(),h.getMonth(),1);b=new Date(h.getFullYear(),h.getMonth()+1,0);lab="Este mes";}
  else if(ui.ingPer==="mesprox"){a=new Date(h.getFullYear(),h.getMonth()+1,1);b=new Date(h.getFullYear(),h.getMonth()+2,0);lab="Mes que viene";}
  else{a=h;b=addDays(h,27);lab="Próximas 4 semanas";}
  return {a,b,lab};
}
function calcPeriodo(a,b,profId){
  const ts=S.turnos.filter(t=>{const d=parseYmd(t.fecha);return d>=a&&d<=b&&cuentaIngreso(t)&&(!profId||t.profId===profId);});
  const vs=profId?[]:S.ventas.filter(v=>{const d=parseYmd(v.fecha);return d>=a&&d<=b;});
  const ventas=vs.reduce((x,v)=>x+v.monto,0);
  const fact=ts.reduce((x,t)=>x+facturacion(t),0)+ventas,cobr=ts.reduce((x,t)=>x+neto(t),0)+ventas;
  const senP=ts.filter(t=>t.estado==="pendiente_pago"||t.estado==="por_validar").reduce((x,t)=>x+t.senaMonto,0);
  let disp=0;
  for(let d=new Date(a);d<=b;d=addDays(d,1)){
    const s=ymd(d);
    S.profesionales.filter(p=>p.activo&&!p.archivado&&(!profId||p.id===profId)).forEach(p=>{
      if(bloqueosDe(s,p.id).some(x=>!x.desde))return;
      (p.horario[d.getDay()]||[]).forEach(r=>{disp+=toMin(r.hasta)-toMin(r.desde);});
    });
  }
  const ocup=ts.filter(ocupa).reduce((x,t)=>x+t.duracion,0);
  return {ts,vs,ventas,fact,cobr,senP,aCobrar:Math.max(0,fact-cobr-senP),ocupPct:disp?Math.min(100,Math.round(ocup/disp*100)):0};
}
function vIngresos(){
  const {a,b,lab}=periodo(),r=calcPeriodo(a,b);
  const pers=[["semana","Esta semana"],["prox4","Próximas 4 semanas"],["mes","Este mes"],["mesprox","Mes que viene"]];
  let html=`<div class="stack"><div class="row between"><div><h2>Ingresos</h2><p class="muted small">${lab}: del ${fechaCorta(ymd(a))} al ${fechaCorta(ymd(b))}. Incluye turnos confirmados y con seña pendiente.</p></div>
    <div class="row"><select id="ingPer" data-c="ingPer" style="width:auto" aria-label="Período">${pers.map(p=>`<option value="${p[0]}" ${ui.ingPer===p[0]?"selected":""}>${p[1]}</option>`).join("")}</select><button class="btn" data-a="exportar">Exportar a Excel</button></div></div>
    ${ui.csv!=null?`<section class="panel stack"><div class="row between"><h3>Datos para Excel</h3><button class="btn sm ghost" data-a="csvClose">Cerrar</button></div><p class="small muted">Copiá el texto y pegalo en una hoja de Excel o Google Sheets: cada dato cae en su columna.</p><textarea class="paste" id="csvTxt" readonly>${esc(ui.csv)}</textarea><div class="row"><button class="btn pri" data-a="copyCsv">Copiar todo</button></div></section>`:""}
    <div class="stats"><div class="stat hi"><b>${$m(r.fact)}</b><span>Facturación proyectada</span></div><div class="stat"><b>${$m(r.cobr)}</b><span>Ya cobrado (señas y pagos)</span></div><div class="stat"><b>${$m(r.aCobrar)}</b><span>A cobrar en los turnos</span></div><div class="stat"><b>${$m(r.senP)}</b><span>Señas pendientes</span></div></div>
    <div class="row small muted"><span>Ocupación de agenda: <b class="mono" style="color:var(--ink)">${r.ocupPct}%</b></span><span>· ${r.ts.length} turnos</span><span>· Ticket promedio <b class="mono" style="color:var(--ink)">${$m(r.ts.length?(r.fact-r.ventas)/r.ts.length:0)}</b></span>${r.ventas?`<span>· Paquetes vendidos <b class="mono" style="color:var(--ink)">${$m(r.ventas)}</b></span>`:""}<span>· Saldo a favor de clientes <b class="mono" style="color:var(--ink)">${$m(S.clientes.reduce((x,c)=>x+(c.credito||0),0))}</b></span></div>`;
  const w0=addDays(lunes(hoy0()),-21),weeks=[];
  for(let i=0;i<8;i++){const wa=addDays(w0,i*7),x=calcPeriodo(wa,addDays(wa,6));weeks.push({wa,fact:x.fact,cobr:x.cobr,cur:i===3});}
  const max=Math.max(1,...weeks.map(w=>w.fact)),step=max>400000?100000:max>150000?50000:max>60000?20000:10000,top=Math.ceil(max/step)*step;
  const W=640,Hh=220,L=46,B=26,T=10,cw=(W-L-8)/8,y=v=>T+(Hh-T-B)*(1-v/top);
  let g="";
  for(let v=0;v<=top;v+=step)g+=`<line class="grid" x1="${L}" x2="${W-4}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L-6}" y="${y(v)+4}" text-anchor="end">${kfmt(v)}</text>`;
  weeks.forEach((w,i)=>{
    const x=L+i*cw+cw*0.18,bw=cw*0.64;
    g+=`<rect class="b2" x="${x}" y="${y(w.fact)}" width="${bw}" height="${Math.max(0,y(0)-y(w.fact))}" rx="3"><title>Semana del ${w.wa.getDate()}/${w.wa.getMonth()+1}: ${$m(w.fact)} proyectado</title></rect>`;
    g+=`<rect class="b1" x="${x}" y="${y(w.cobr)}" width="${bw}" height="${Math.max(0,y(0)-y(w.cobr))}" rx="3"><title>Cobrado: ${$m(w.cobr)}</title></rect>`;
    g+=`<text class="ax${w.cur?" cur":""}" x="${x+bw/2}" y="${Hh-8}" text-anchor="middle">${w.cur?"Esta sem.":w.wa.getDate()+"/"+(w.wa.getMonth()+1)}</text>`;
  });
  html+=`<section class="panel stack"><div class="row between"><h3>Semana a semana</h3><div class="key"><span><i style="background:var(--accent)"></i>Cobrado</span><span><i style="background:var(--accent-soft);outline:1px dashed var(--accent)"></i>Proyectado sin cobrar</span></div></div><div class="chart"><svg viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Facturación y cobros de las últimas 3 semanas, esta semana y las próximas 4">${g}</svg></div></section>`;
  const porS={};r.ts.forEach(t=>{const k=t.servicioNombre;porS[k]=porS[k]||{n:0,f:0,c:0};porS[k].n++;porS[k].f+=facturacion(t);porS[k].c+=neto(t);});
  r.vs.forEach(v=>{const k="Paquetes vendidos";porS[k]=porS[k]||{n:0,f:0,c:0};porS[k].n++;porS[k].f+=v.monto;porS[k].c+=v.monto;});
  const filas=Object.keys(porS).sort((x,y)=>porS[y].f-porS[x].f);
  html+=`<section class="list"><div style="padding:14px 14px 0"><h3>Por tratamiento</h3></div>${filas.length?`<div class="tbl-wrap"><table><thead><tr><th>Tratamiento</th><th class="num">Cantidad</th><th class="num">Facturación</th><th class="num">Cobrado</th><th>Peso</th></tr></thead><tbody>${filas.map(k=>`<tr><td>${esc(k)}</td><td class="num">${porS[k].n}</td><td class="num">${$m(porS[k].f)}</td><td class="num">${$m(porS[k].c)}</td><td><div class="bar"><i style="width:${r.fact?Math.round(porS[k].f/r.fact*100):0}%"></i></div></td></tr>`).join("")}</tbody></table></div>`:'<p class="empty">Sin turnos en el período.</p>'}</section>`;
  html+=`<section class="list"><div style="padding:14px 14px 0"><h3>Por profesional</h3></div><div class="tbl-wrap"><table><thead><tr><th>Profesional</th><th class="num">Turnos</th><th class="num">Facturación</th><th class="num">Cobrado</th><th class="num">Ocupación</th></tr></thead><tbody>${S.profesionales.map(p=>({p,x:calcPeriodo(a,b,p.id)})).filter(({p,x})=>!p.archivado||x.ts.length).map(({p,x})=>{return `<tr><td>${proTag(p.id)}</td><td class="num">${x.ts.length}</td><td class="num">${$m(x.fact)}</td><td class="num">${$m(x.cobr)}</td><td class="num">${x.ocupPct}%</td></tr>`;}).join("")}</tbody></table></div></section></div>`;
  return html;
}
function statsCliente(c){
  const ts=S.turnos.filter(t=>t.clienteId===c.id);
  const real=ts.reduce((a,t)=>a+(t.pagos||[]).filter(p=>p.medio!=="Saldo a favor").reduce((x,p)=>x+p.monto,0),0)+S.ventas.filter(v=>v.clienteId===c.id).reduce((a,v)=>a+v.monto,0);
  return {ts,vis:ts.filter(t=>t.estado==="completado").length,aus:ts.filter(t=>t.estado==="ausente").length,pag:real,
    deuda:ts.filter(t=>t.estado==="completado").reduce((a,t)=>a+saldo(t),0),
    prox:ts.filter(t=>ACTIVOS.includes(t.estado)&&startOf(t)>ahoraAR()).sort((a,b)=>startOf(a)-startOf(b))[0],
    ult:ts.filter(t=>t.estado==="completado").sort((a,b)=>startOf(b)-startOf(a))[0]};
}
function vClientes(){
  if(ui.cliSel)return vCliente(cliById(ui.cliSel));
  const q=ui.cliQ.toLowerCase();
  const list=S.clientes.filter(c=>!q||c.nombre.toLowerCase().includes(q)||(digits(q)&&digits(c.tel).includes(digits(q)))).sort((a,b)=>a.nombre.localeCompare(b.nombre));
  const html=`<div class="row between" style="margin-bottom:14px"><h2>Clientes <span class="muted mono" style="font-size:1rem">${S.clientes.length}</span></h2><input type="text" id="cliQ" placeholder="Buscar por nombre o teléfono" value="${esc(ui.cliQ)}" style="max-width:280px" aria-label="Buscar cliente"></div>`;
  if(!list.length)return html+`<div class="list empty">${S.clientes.length?"Sin resultados.":"Todavía no hay clientes. Se agregan solos cuando alguien reserva."}</div>`;
  return html+`<div class="list tbl-wrap"><table><thead><tr><th>Cliente</th><th>WhatsApp</th><th class="num">Visitas</th><th class="num">Pagado</th><th class="num">Debe</th><th class="num">A favor</th><th>Próximo turno</th></tr></thead><tbody>${list.map(c=>{const s=statsCliente(c);return `<tr class="click" data-a="cliSel" data-v="${c.id}" tabindex="0"><td><b>${esc(c.nombre)}</b>${(c.packs||[]).some(p=>p.usadas<p.total)?' <span class="tag ok">Paquete</span>':""}</td><td class="mono small">${esc(c.tel)}</td><td class="num">${s.vis}</td><td class="num">${$m(s.pag)}</td><td class="num" style="color:${s.deuda?"var(--bad)":"inherit"}">${$m(s.deuda)}</td><td class="num" style="color:${c.credito?"var(--ok)":"inherit"}">${$m(c.credito)}</td><td class="small">${s.prox?fechaCorta(s.prox.fecha)+" "+s.prox.hora:'<span class="muted">—</span>'}</td></tr>`;}).join("")}</tbody></table></div>`;
}
function vCliente(c){
  if(!c){ui.cliSel=null;return vClientes();}
  const adm=esAdmin(),s=statsCliente(c),pagos=[];
  s.ts.forEach(t=>(t.pagos||[]).forEach(p=>pagos.push({p,concepto:p.tipo+" · "+t.servicioNombre})));
  S.ventas.filter(v=>v.clienteId===c.id).forEach(v=>pagos.push({p:{fecha:v.fecha,medio:v.medio,monto:v.monto},concepto:v.concepto}));
  pagos.sort((a,b)=>a.p.fecha<b.p.fecha?1:-1);
  const svcAct=S.servicios.filter(x=>x.activo);
  const packsHtml=`<section class="list"><div class="row between" style="padding:14px 14px 0"><h3>Paquetes de sesiones</h3>${adm?`<button class="btn sm" data-a="packForm">${ui.packForm?"Cerrar":"+ Vender paquete"}</button>`:""}</div>
    ${ui.packForm&&adm?`<form class="inline" data-f="pack" data-v="${c.id}" style="margin:12px 14px 0"><label class="f">Tratamiento<select id="pkSvc">${svcAct.map(x=>`<option value="${x.id}">${esc(x.nombre)}</option>`).join("")}</select></label><label class="f">Sesiones<input type="number" id="pkN" min="2" max="50" value="6"></label><label class="f">Precio total $<input type="number" id="pkPrecio" min="0" step="500" placeholder="Ej. 190000"></label><label class="f">Medio de pago<select id="pkMedio">${MEDIOS.map(m=>`<option>${m}</option>`).join("")}</select></label><button class="btn sm pri" type="submit">Registrar venta</button></form>`:""}
    ${(c.packs||[]).length?(c.packs||[]).map(p=>`<div class="pack"><div><b>${esc(p.nombre)}</b><div class="small muted">Comprado el ${fechaCorta(p.fecha)}</div></div><span class="mono">${p.usadas} de ${p.total}</span><div class="bar"><i style="width:${Math.round(p.usadas/p.total*100)}%"></i></div></div>`).join(""):'<p class="empty">Sin paquetes.</p>'}</section>`;
  const credHtml=ui.credForm&&adm?`<form class="inline" data-f="cred" data-v="${c.id}"><label class="f">Saldo a favor $<input type="number" id="credMonto" min="0" step="100" value="${c.credito||0}"></label><button class="btn sm pri" type="submit">Guardar</button><button class="btn sm" type="button" data-a="credForm">Cerrar</button></form>`:"";
  const dis=adm?"":"disabled";
  return `<div class="stack"><button class="btn sm ghost" data-a="cliSel" data-v="" style="align-self:flex-start">← Todos los clientes</button>
    <div class="row between"><div><h2>${esc(c.nombre)}</h2><p class="small muted">Cliente desde ${fechaCorta(c.alta)}${s.ult?" · última visita "+fechaCorta(s.ult.fecha):""}</p></div><div class="row"><button class="btn" data-a="ntOpen" data-v="${c.id}">+ Turno</button><a class="btn wa" href="${esc(waLink(c.tel,"Hola "+c.nombre.split(" ")[0]+"!"))}" target="_blank" rel="noopener">WhatsApp</a></div></div>
    <div class="stats"><div class="stat"><b>${s.vis}</b><span>Visitas · ${s.aus} ${s.aus===1?"ausencia":"ausencias"}</span></div><div class="stat"><b>${$m(s.pag)}</b><span>Total pagado</span></div><div class="stat"><b style="color:${s.deuda?"var(--bad)":"inherit"}">${$m(s.deuda)}</b><span>Saldo adeudado</span></div>${adm?`<button class="stat" data-a="credForm" style="text-align:left;cursor:pointer;font:inherit"><b style="color:${c.credito?"var(--ok)":"inherit"}">${$m(c.credito)}</b><span>Saldo a favor · ajustar</span></button>`:`<div class="stat"><b>${$m(c.credito)}</b><span>Saldo a favor</span></div>`}</div>${credHtml}
    ${packsHtml}
    <section class="panel stack"><h3>Datos</h3><div class="fgrid">
      <label class="f">Nombre<input type="text" id="cn" data-c="cli" data-id="${c.id}" data-k="nombre" value="${esc(c.nombre)}" ${dis}></label>
      <label class="f">WhatsApp<input type="tel" id="ct" data-c="cli" data-id="${c.id}" data-k="tel" value="${esc(c.tel)}" ${dis}></label>
      <label class="f">Email<input type="email" id="ce" data-c="cli" data-id="${c.id}" data-k="email" value="${esc(c.email)}" ${dis}></label></div>
      <label class="f"><span>Notas internas <small>Solo las ve el centro.</small></span><textarea id="cno" data-c="cli" data-id="${c.id}" data-k="notas" ${dis}>${esc(c.notas)}</textarea></label></section>
    <section class="list"><div style="padding:14px 14px 0"><h3>Historial de turnos</h3></div>${s.ts.length?`<div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Tratamiento</th><th>Profesional</th><th>Estado</th><th class="num">Precio</th><th class="num">Pagado</th></tr></thead><tbody>${s.ts.slice().sort((a,b)=>startOf(b)-startOf(a)).map(t=>`<tr><td class="mono small">${fechaCorta(t.fecha)} ${t.hora}</td><td>${esc(t.servicioNombre)}</td><td class="small">${proTag(t.profId)}</td><td><span class="pill ${t.estado}">${ESTADOS[t.estado]}</span></td><td class="num">${$m(t.precio)}</td><td class="num">${$m(pagado(t))}</td></tr>`).join("")}</tbody></table></div>`:'<p class="empty">Sin turnos.</p>'}</section>
    <section class="list"><div style="padding:14px 14px 0"><h3>Pagos</h3></div>${pagos.length?`<div class="tbl-wrap"><table><thead><tr><th>Fecha</th><th>Concepto</th><th>Medio</th><th class="num">Monto</th></tr></thead><tbody>${pagos.map(x=>`<tr><td class="mono small">${fechaCorta(x.p.fecha)}</td><td>${esc(x.concepto)}</td><td>${esc(x.p.medio)}</td><td class="num">${$m(x.p.monto)}</td></tr>`).join("")}</tbody></table></div>`:'<p class="empty">Sin pagos registrados.</p>'}</section></div>`;
}
function vServicios(){
  const equipos=[...new Set(S.servicios.map(s=>s.equipo).filter(Boolean))];
  return `<div class="stack"><div class="row between"><div><h2>Tratamientos</h2><p class="muted small">Duración, precio, seña, quién lo hace y en qué días se ofrece. Los cambios de precio no afectan turnos ya reservados.</p></div><button class="btn pri" data-a="svcAdd">Agregar tratamiento</button></div>
    <datalist id="equipos">${equipos.map(e=>`<option value="${esc(e)}">`).join("")}</datalist>
    ${S.servicios.map(s=>{
      const open=ui.svcOpen===s.id;
      const head=`<div class="ed-h"><div class="grow"><b>${esc(s.nombre)}</b><div class="small muted">${esc(s.categoria||"Sin categoría")} · ${s.duracion} min${s.preparacion?" + "+s.preparacion+" prep.":""} · <span class="mono">${$m(s.precio)}</span> · seña ${s.sena}%${s.equipo?" · "+esc(s.equipo):""}</div><div class="row small" style="gap:8px;margin-top:4px">${s.profIds.map(proTag).join("")}${s.restringir?`<span class="muted">· ${s.dias.slice().sort((a,b)=>((a+6)%7)-((b+6)%7)).map(d=>DCORTO[d]).join(" ")} ${s.desde}–${s.hasta}</span>`:""}</div></div>
        <span class="pill ${s.activo?"confirmado":"ausente"}">${s.activo?"Visible":"Oculto"}</span><button class="btn sm" data-a="svcOpen" data-v="${open?"":s.id}">${open?"Cerrar":"Editar"}</button></div>`;
      if(!open)return `<div class="ed">${head}</div>`;
      const f=(k,l,type,extra)=>`<label class="f">${l}<input type="${type||"text"}" id="s_${k}_${s.id}" data-c="svc" data-id="${s.id}" data-k="${k}" value="${esc(s[k])}" ${extra||""}></label>`;
      return `<div class="ed">${head}<div class="ed-b">
        <div class="fgrid">${f("nombre","Nombre")}${f("categoria","Categoría")}${f("duracion","Duración (min)","number",'min="10" step="5"')}${f("preparacion","Preparación después (min)","number",'min="0" step="5"')}${f("precio","Precio ($)","number",'min="0" step="500"')}${f("sena","Seña (%)","number",'min="0" max="100" step="5"')}</div>
        ${f("desc","Descripción para el cliente")}
        <label class="f"><span>Equipo o cabina compartida <small>Dos turnos que usan el mismo equipo no se superponen, aunque sean de distintos profesionales.</small></span><input type="text" id="s_eq_${s.id}" list="equipos" data-c="svc" data-id="${s.id}" data-k="equipo" value="${esc(s.equipo)}" placeholder="Ej. Láser diodo"></label>
        <div class="stack" style="gap:6px"><b class="small">Profesionales que lo hacen</b><div class="chips">${prosPanel().map(p=>`<label class="tchip pc${p.color}"><input type="checkbox" id="sp_${s.id}_${p.id}" data-c="svcPro" data-id="${s.id}" data-p="${p.id}" ${s.profIds.includes(p.id)?"checked":""}><span class="dot"></span>${esc(p.nombre)}</label>`).join("")}</div></div>
        <div class="stack" style="gap:8px"><label class="switch"><input type="checkbox" id="sr_${s.id}" data-c="svc" data-id="${s.id}" data-k="restringir" ${s.restringir?"checked":""}>Ofrecerlo solo algunos días y horarios</label>
          ${s.restringir?`<div class="chips">${[1,2,3,4,5,6,0].map(d=>`<label class="tchip"><input type="checkbox" id="sd_${s.id}_${d}" data-c="svcDia" data-id="${s.id}" data-d="${d}" ${s.dias.includes(d)?"checked":""}>${DCORTO[d]}</label>`).join("")}</div>
          <div class="rng"><span class="small muted">De</span><input type="time" id="sdesde_${s.id}" data-c="svc" data-id="${s.id}" data-k="desde" value="${s.desde}" aria-label="Desde"><span class="small muted">a</span><input type="time" id="shasta_${s.id}" data-c="svc" data-id="${s.id}" data-k="hasta" value="${s.hasta}" aria-label="Hasta"></div><p class="small muted">Se cruza con el horario de cada profesional: solo aparecen los turnos que entran en los dos.</p>`:""}</div>
        <div class="row between"><label class="switch"><input type="checkbox" id="sa_${s.id}" data-c="svc" data-id="${s.id}" data-k="activo" ${s.activo?"checked":""}>Visible para los clientes</label>
          ${ui.confirm==="sdel:"+s.id?`<span class="row"><span class="small">¿Borrar este tratamiento? Si tiene turnos, mejor ocultalo.</span><button class="btn sm danger" data-a="svcDel" data-v="${s.id}">Borrar</button><button class="btn sm" data-a="noConfirm">No</button></span>`:`<button class="btn sm ghost" data-a="ask" data-v="sdel:${s.id}">Borrar tratamiento</button>`}</div>
      </div></div>`;
    }).join("")}</div>`;
}
/* agrupa bloqueos de días completos consecutivos (mismo profesional y motivo) */
function gruposBloqueo(list){
  const ord=list.slice().sort((a,b)=>((a.profId||"")+a.motivo+a.fecha+(a.desde||"")).localeCompare((b.profId||"")+b.motivo+b.fecha+(b.desde||"")));
  const out=[];
  ord.forEach(b=>{
    const g=out[out.length-1];
    if(g&&!b.desde&&!g.hDesde&&g.profId===b.profId&&g.motivo===b.motivo&&ymd(addDays(parseYmd(g.hasta),1))===b.fecha){g.hasta=b.fecha;g.ids.push(b.id);}
    else out.push({desde:b.fecha,hasta:b.fecha,hDesde:b.desde,hHasta:b.hasta,profId:b.profId,motivo:b.motivo,ids:[b.id]});
  });
  return out.sort((a,b)=>a.desde.localeCompare(b.desde));
}
function vDisponibilidad(){
  const c=S.config,orden=[1,2,3,4,5,6,0];
  const sel=(id,k,opts,cur)=>`<select id="${id}" data-c="cfg" data-k="${k}" data-n="1">${opts.map(v=>`<option value="${v[0]}" ${cur===v[0]?"selected":""}>${v[1]}</option>`).join("")}</select>`;
  let html=`<div class="stack"><div><h2>Disponibilidad</h2><p class="muted small">El cliente solo ve horarios dentro de estas franjas que no estén ocupados ni bloqueados.</p></div>
    <section class="panel stack"><h3>Reglas de reserva</h3><div class="fgrid">
      <label class="f">Intervalo entre inicios${sel("cfgInt","intervalo",[[15,"Cada 15 min"],[20,"Cada 20 min"],[30,"Cada 30 min"],[45,"Cada 45 min"],[60,"Cada 60 min"]],c.intervalo)}</label>
      <label class="f">Reservas con hasta${sel("cfgVen","ventana",[[7,"7 días"],[14,"14 días"],[30,"30 días"],[60,"60 días"],[90,"90 días"]],c.ventana)}</label>
      <label class="f">Aviso mínimo para reservar${sel("cfgAnt","anticipacion",[[30,"30 minutos"],[60,"1 hora"],[120,"2 horas"],[720,"12 horas"],[1440,"24 horas"]],c.anticipacion)}</label>
      <label class="f">Reserva sin seña dura${sel("cfgHold","holdHoras",[[1,"1 hora"],[2,"2 horas"],[4,"4 horas"],[12,"12 horas"],[24,"24 horas"]],c.holdHoras)}</label></div></section>
    <div class="row between"><h3>Profesionales</h3><button class="btn sm" data-a="proAdd">+ Agregar profesional</button></div>`;
  html+=prosPanel().map(p=>{
    const open=ui.proOpen===p.id;
    const dias=orden.filter(d=>(p.horario[d]||[]).length).map(d=>DCORTO[d]).join(" ");
    const vac=gruposBloqueo(S.bloqueos.filter(b=>b.profId===p.id&&b.fecha>=hoyS()&&!b.desde));
    const ausenteHoy=vac.find(g=>g.desde<=hoyS()&&g.hasta>=hoyS());
    let h=`<div class="ed"><div class="ed-h"><div class="av pc${p.color}">${esc(p.nombre.charAt(0))}</div><div class="grow"><b>${esc(p.nombre)}</b><div class="small muted">${esc(p.rol||"Sin especialidad")} · ${dias||"sin días"}${vac.length?` · ${ausenteHoy?"ausente hasta el "+fechaDM(ausenteHoy.hasta):"ausencia desde el "+fechaDM(vac[0].desde)}`:""}</div></div><span class="pill ${p.activo?"confirmado":"ausente"}">${p.activo?"Recibe reservas":"Pausado"}</span><button class="btn sm" data-a="proOpen" data-v="${open?"":p.id}">${open?"Cerrar":"Editar"}</button></div>`;
    if(!open)return h+"</div>";
    const futuros=S.turnos.filter(t=>t.profId===p.id&&ACTIVOS.includes(t.estado)&&t.fecha>=hoyS()).length;
    h+=`<div class="ed-b"><div class="fgrid">
      <label class="f">Nombre<input type="text" id="pn_${p.id}" data-c="pro" data-id="${p.id}" data-k="nombre" value="${esc(p.nombre)}"></label>
      <label class="f">Especialidad<input type="text" id="pr_${p.id}" data-c="pro" data-id="${p.id}" data-k="rol" value="${esc(p.rol)}"></label>
      <label class="f"><span>WhatsApp <small>Para mandarle su agenda</small></span><input type="tel" id="pt_${p.id}" data-c="pro" data-id="${p.id}" data-k="tel" value="${esc(p.tel)}"></label>
      <label class="f">Color en la agenda<select id="pc_${p.id}" data-c="pro" data-id="${p.id}" data-k="color">${COLORES.map(x=>`<option value="${x[0]}" ${p.color===x[0]?"selected":""}>${x[1]}</option>`).join("")}</select></label></div>
      <label class="switch"><input type="checkbox" id="pa_${p.id}" data-c="pro" data-id="${p.id}" data-k="activo" ${p.activo?"checked":""}>Recibe reservas</label>
      <div>${orden.map(d=>{const r=p.horario[d]||[];return `<div class="dayrow"><label class="switch"><input type="checkbox" id="don_${p.id}_${d}" data-c="dayon" data-p="${p.id}" data-d="${d}" ${r.length?"checked":""}>${DIAS[d]}</label><div>${r.length?r.map((x,i)=>`<div class="rng"><input type="time" id="rd_${p.id}_${d}_${i}" data-c="rng" data-p="${p.id}" data-d="${d}" data-i="${i}" data-k="desde" value="${x.desde}" aria-label="Desde"><span class="muted">a</span><input type="time" id="rh_${p.id}_${d}_${i}" data-c="rng" data-p="${p.id}" data-d="${d}" data-i="${i}" data-k="hasta" value="${x.hasta}" aria-label="Hasta"><button class="btn sm ghost" data-a="rngDel" data-p="${p.id}" data-d="${d}" data-i="${i}">Quitar</button></div>`).join("")+`<button class="btn sm" data-a="rngAdd" data-p="${p.id}" data-d="${d}">+ Franja</button>`:'<span class="muted small">No atiende</span>'}</div></div>`;}).join("")}</div>
      <div class="stack" style="gap:8px;border-top:1px solid var(--line);padding-top:14px"><b>Vacaciones o ausencias</b><p class="small muted">Durante esos días no aparece para reservar. Los turnos que ya tenga no se borran: te avisamos para que los muevas.</p>
        <form class="inline" data-f="vac" data-v="${p.id}" style="margin-top:0"><label class="f">Desde<input type="date" id="vacDesde_${p.id}" min="${hoyS()}"></label><label class="f">Hasta<input type="date" id="vacHasta_${p.id}" min="${hoyS()}"></label><label class="f">Motivo<input type="text" id="vacMot_${p.id}" value="Vacaciones"></label><button class="btn sm pri" type="submit">Bloquear días</button></form>
        ${vac.length?`<div class="row">${vac.map(g=>`<span class="chip">${fechaDM(g.desde)}${g.hasta!==g.desde?" al "+fechaDM(g.hasta):""}${g.motivo?" · "+esc(g.motivo):""}<button data-a="bloqDel" data-v="${g.ids.join(",")}" aria-label="Quitar ausencia">×</button></span>`).join("")}</div>`:""}</div>
      <div class="row between" style="border-top:1px solid var(--line);padding-top:14px"><span class="small muted">Eliminar no borra su historial de turnos ni pagos.</span>
        ${ui.confirm==="pdel:"+p.id?(futuros?`<span class="row"><span class="small" style="color:var(--bad)">Tiene ${futuros} ${futuros===1?"turno próximo":"turnos próximos"}. Movelos o cancelalos desde la Agenda antes de eliminarlo.</span><button class="btn sm" data-a="noConfirm">Entendido</button></span>`:`<span class="row"><span class="small">¿Eliminar a ${esc(p.nombre)}?</span><button class="btn sm danger" data-a="proDel" data-v="${p.id}">Sí, eliminar</button><button class="btn sm" data-a="noConfirm">No</button></span>`):`<button class="btn sm danger" data-a="ask" data-v="pdel:${p.id}">Eliminar profesional</button>`}</div></div></div>`;
    return h;
  }).join("");
  const grupos=gruposBloqueo(S.bloqueos.filter(b=>b.fecha>=hoyS()));
  html+=`<section class="panel stack"><div><h3>Bloqueos</h3><p class="small muted">Feriados, vacaciones, una capacitación o un rato libre. Puede ser uno o varios días completos, o unas horas de un día, para todo el centro o para un profesional.</p></div>
    <form class="fgrid" data-f="bloq" style="align-items:end">
      <label class="f">Desde el día<input type="date" id="bqFecha" min="${hoyS()}"></label>
      <label class="f"><span>Hasta el día <small>vacío = un solo día</small></span><input type="date" id="bqFechaH" min="${hoyS()}"></label>
      <label class="f"><span>Desde la hora <small>vacío = día completo</small></span><input type="time" id="bqDesde"></label>
      <label class="f">Hasta la hora<input type="time" id="bqHasta"></label>
      <label class="f">Para<select id="bqPro"><option value="">Todo el centro</option>${prosPanel().map(p=>`<option value="${p.id}">${esc(p.nombre)}</option>`).join("")}</select></label>
      <label class="f">Motivo<input type="text" id="bqMotivo" placeholder="Ej. Feriado"></label>
      <button class="btn" type="submit">Bloquear</button></form>
    <div class="row">${grupos.length?grupos.map(g=>`<span class="chip">${fechaCorta(g.desde)}${g.hasta!==g.desde?" al "+fechaCorta(g.hasta):""} · ${g.hDesde?g.hDesde+"–"+g.hHasta:"todo el día"}${g.profId?" · "+esc(proNombre(g.profId)):" · todo el centro"}${g.motivo?" · "+esc(g.motivo):""}<button data-a="bloqDel" data-v="${g.ids.join(",")}" aria-label="Quitar bloqueo">×</button></span>`).join(""):'<span class="small muted">Ninguno.</span>'}</div></section></div>`;
  return html;
}
function textosWa(){
  const n=S.config.negocio||"el centro",l=linkReservas();
  return [
    ["bienvenida","Mensaje de bienvenida","Lo recibe automáticamente quien escribe por primera vez (o después de 14 días sin escribir).",
     `¡Hola! Gracias por escribir a ${n}.\nPodés reservar tu turno acá, con los horarios disponibles en el momento:\n${l}\nSi tenés una consulta, escribila y te respondemos a la brevedad.`],
    ["ausencia","Mensaje de ausencia","Se envía fuera del horario de atención que configures en WhatsApp Business.",
     `¡Hola! En este momento no podemos responder, pero podés reservar tu turno las 24 horas acá:\n${l}\nTe contestamos apenas volvamos.`],
    ["turno","Respuesta rápida /turno","Para mandar el link escribiendo /turno en cualquier chat.",
     `Reservá tu turno acá y elegí el día y horario que mejor te quede:\n${l}`],
    ["misturnos","Respuesta rápida /misturnos","Para quien quiere cambiar o cancelar un turno.",
     `Para ver, reprogramar o cancelar tu turno, abrí el link de “Mis turnos” que te llegó al reservar. Se puede cancelar online hasta ${S.config.cancelMin>=60?(S.config.cancelMin/60)+" h":S.config.cancelMin+" minutos"} antes. Si no lo encontrás, avisanos por acá y te lo reenviamos.`]
  ];
}
function vWhatsApp(){
  const l=linkReservas(),num=S.config.whatsapp;
  const qr=qrSvg(l);
  return `<div class="stack"><div><h2>WhatsApp</h2><p class="muted">Todo listo para usar con la app gratuita de WhatsApp Business: el link de reservas, un QR para el local y las respuestas automáticas.</p></div>
    <section class="panel stack"><h3>Link de reservas</h3>
      <div class="linkbox"><code>${esc(l)}</code><button class="btn sm" data-a="copy" data-v="${esc(l)}">Copiar</button></div>
      <div class="qrwrap">${qr?`<div class="qr">${qr}</div>`:""}<div class="stack" style="gap:8px;min-width:0">
        <p class="small muted">Ponelo en la bio de Instagram, en el perfil de WhatsApp Business (campo “Sitio web”) o imprimí el QR para el mostrador.</p>
        <div class="row">${qr?'<button class="btn sm" data-a="qrBajar">Descargar QR</button>':""}${num?`<a class="btn sm wa" href="${esc(waLink(num,"Reservá tu turno en "+(S.config.negocio||"el centro")+": "+l))}" target="_blank" rel="noopener">Probar en WhatsApp</a>`:""}</div></div></div></section>
    <section class="panel stack"><div><h3>Respuestas automáticas</h3><p class="small muted">Copiá cada texto y pegalo en WhatsApp Business → <b>Herramientas para la empresa</b>. Así, cuando un cliente escribe, recibe el link al instante y reserva solo.</p></div>
      ${textosWa().map(([k,t,d,m])=>`<div class="watxt"><div class="row between"><div style="min-width:0"><b>${t}</b><br><span class="small muted">${d}</span></div><button class="btn sm" data-a="copy" data-v="${esc(m)}">Copiar</button></div><div class="msg">${esc(m)}</div></div>`).join("")}</section>
    <section class="panel stack"><h3>Cómo activarlo</h3><ol class="pasos">
      <li>Instalá <b>WhatsApp Business</b> en el celular del centro (es gratis) con el número ${num?`<span class="mono">+${esc(num)}</span>`:"del centro"}.</li>
      <li>Entrá a <b>Herramientas para la empresa → Mensaje de bienvenida</b>, activalo y pegá el primer texto.</li>
      <li>En <b>Mensaje de ausencia</b>, activalo, elegí “Fuera del horario comercial” y pegá el segundo texto.</li>
      <li>En <b>Respuestas rápidas</b>, creá /turno y /misturnos con los últimos dos textos.</li>
      <li>Los recordatorios, confirmaciones de seña y avisos de lista de espera se mandan desde las pestañas del panel con el botón verde: se abre WhatsApp con el mensaje escrito y solo tocás enviar.</li></ol>
      <p class="small muted">Más adelante, si el volumen lo justifica, se puede pasar a la API oficial de WhatsApp para que los recordatorios salgan solos, sin tocar nada.</p></section></div>`;
}
function qrSvg(texto){
  if(typeof window.qrcode!=="function")return "";
  try{const q=window.qrcode(0,"M");q.addData(texto);q.make();return q.createSvgTag({cellSize:5,margin:2,scalable:true});}catch(e){return "";}
}
function bajarQr(){
  if(typeof window.qrcode!=="function")return toast("No se pudo generar el QR");
  const q=window.qrcode(0,"M");q.addData(linkReservas());q.make();
  const n=q.getModuleCount(),cel=16,m=4,tam=(n+m*2)*cel,cv=document.createElement("canvas");cv.width=cv.height=tam;
  const x=cv.getContext("2d");x.fillStyle="#fff";x.fillRect(0,0,tam,tam);x.fillStyle="#000";
  for(let r=0;r<n;r++)for(let c=0;c<n;c++)if(q.isDark(r,c))x.fillRect((c+m)*cel,(r+m)*cel,cel,cel);
  const a=document.createElement("a");a.href=cv.toDataURL("image/png");a.download="qr-reservas.png";document.body.appendChild(a);a.click();a.remove();
}
function vAjustes(){
  const c=S.config;
  const txt=(k,l,type,help,ph)=>`<label class="f"><span>${l}${help?` <small>${help}</small>`:""}</span><input type="${type||"text"}" id="cfg_${k}" data-c="cfg" data-k="${k}" value="${esc(c[k])}" ${ph?`placeholder="${esc(ph)}"`:""}></label>`;
  return `<div class="stack"><h2>Ajustes</h2>
    <section class="panel stack"><h3>Centro</h3><div class="fgrid">${txt("negocio","Nombre del centro")}${txt("whatsapp","WhatsApp del centro","tel","Con código de país")}</div>
      <div class="logo-edit"><div class="logo-prev">${c.logoUrl?`<img src="${esc(c.logoUrl)}" alt="Logo actual">`:`<span class="mark">${esc((c.negocio.trim()[0]||"T").toUpperCase())}</span>`}</div>
        <div class="stack" style="gap:6px;min-width:0"><b>Logo</b><span class="small muted">PNG, JPG o WEBP de hasta 2 MB. Mejor con fondo transparente. Se muestra junto al nombre en la página de reservas y en el panel.</span>
          <div class="row"><label class="btn sm" for="logoFile">${c.logoUrl?"Cambiar logo":"Subir logo"}</label><input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp" data-c="logo" hidden>${c.logoUrl?(ui.confirm==="logoDel"?`<span class="small">¿Quitar el logo?</span><button class="btn sm danger" data-a="logoDel">Sí, quitar</button><button class="btn sm" data-a="noConfirm">No</button>`:`<button class="btn sm ghost" data-a="ask" data-v="logoDel">Quitar logo</button>`):""}${ui.busy?'<span class="small muted">Subiendo…</span>':""}</div></div></div></section>
    <section class="panel stack"><div><h3>Bienvenida de la página de reservas</h3><p class="small muted">Es lo primero que ve el cliente. Si lo dejás vacío se usa el texto de ejemplo. Podés usar {profesional} y {negocio}.</p></div>
      <div class="fgrid">${txt("bienvenidaTitulo","Título","text","",`¡Te damos la bienvenida a ${c.negocio}!`)}</div>
      <label class="f">Texto<textarea id="cfg_bienvenidaTexto" data-c="cfg" data-k="bienvenidaTexto" placeholder="${esc(textoBienvenida().texto)}" style="min-height:64px">${esc(c.bienvenidaTexto)}</textarea></label></section>
    <section class="panel stack"><h3>Cobro de señas</h3>
      <div class="fgrid">${txt("alias","Alias")}${txt("cbu","CBU / CVU")}${txt("titular","Titular de la cuenta")}${txt("banco","Banco o billetera")}</div>
      <div class="fgrid">${txt("mpLink","Link de cobro de Mercado Pago","url","Opcional","https://link.mercadopago.com.ar/…")}</div>
      <label class="switch"><input type="checkbox" id="cfg_exigir" data-c="cfg" data-k="exigirSena" data-b="1" ${c.exigirSena?"checked":""}>Exigir seña para confirmar el turno</label>
      <p class="small muted">El porcentaje de seña se define en cada tratamiento. Si cargás un link de cobro de Mercado Pago, el cliente ve un botón para pagar con Mercado Pago además de los datos para transferir. En los dos casos envía el comprobante y el centro confirma la seña.</p></section>
    <section class="panel stack"><h3>Cancelaciones y mensajes</h3><div class="fgrid">
      <label class="f">Cancelación online hasta<select id="cfg_cancel" data-c="cfg" data-k="cancelMin" data-n="1">${[[30,"30 minutos antes"],[60,"1 hora antes"],[120,"2 horas antes"],[1440,"24 horas antes"]].map(v=>`<option value="${v[0]}" ${c.cancelMin===v[0]?"selected":""}>${v[1]}</option>`).join("")}</select></label>
      <label class="f">Enviar recordatorio<select id="cfg_rec" data-c="cfg" data-k="recordatorioHoras" data-n="1">${[[2,"2 horas antes"],[12,"12 horas antes"],[24,"24 horas antes"],[48,"48 horas antes"]].map(v=>`<option value="${v[0]}" ${c.recordatorioHoras===v[0]?"selected":""}>${v[1]}</option>`).join("")}</select></label>
      <label class="f">Lo pagado queda a favor si cancela con<select id="cfg_senaH" data-c="cfg" data-k="senaHoras" data-n="1">${[[2,"2 horas o más"],[12,"12 horas o más"],[24,"24 horas o más"],[48,"48 horas o más"]].map(v=>`<option value="${v[0]}" ${c.senaHoras===v[0]?"selected":""}>${v[1]}</option>`).join("")}</select></label>
      <label class="f">Si cancela más tarde o no viene<select id="cfg_pol" data-c="cfg" data-k="politica">${[["pierde","Pierde la seña y la sesión del paquete"],["favor","Lo pagado igual queda a favor"]].map(v=>`<option value="${v[0]}" ${c.politica===v[0]?"selected":""}>${v[1]}</option>`).join("")}</select></label></div>
      <p class="small muted">Así lo ve el cliente: “${esc(politicaTxt())}”</p>
      <p class="small muted">Variables: {nombre} {servicio} {profesional} {fecha} {hora} {negocio} {cancelacion} {saldo} {link}. <b>{link}</b> es el link privado del cliente para ver, reprogramar o cancelar sus turnos.</p>
      <label class="f">Recordatorio del turno<textarea id="cfg_msg" data-c="cfg" data-k="mensaje">${esc(c.mensaje)}</textarea></label>
      <label class="f">Confirmación de seña<textarea id="cfg_msg2" data-c="cfg" data-k="mensajeConfirmacion">${esc(c.mensajeConfirmacion)}</textarea></label></section>
    <section class="panel stack"><h3>Acceso del personal</h3><p class="small muted">Los usuarios del centro se crean en Supabase (Authentication → Users) y después se habilitan como administración o profesional. Pedíselo a quien administra el sistema.</p></section>
    <section class="panel stack peligro"><div><h3>Empezar de cero</h3><p class="small muted">Para dejar el sistema limpio después de las pruebas. No se puede deshacer.</p></div>
      <form class="stack" data-f="reinicio">
        <label class="opt"><input type="radio" name="alcance" value="mov" checked><span><b>Solo movimientos</b><br><span class="small muted">Borra turnos, clientes, pagos, señas, comprobantes, paquetes, lista de espera y novedades. Mantiene profesionales, tratamientos, horarios y ajustes.</span></span></label>
        <label class="opt"><input type="radio" name="alcance" value="todo"><span><b>Todo</b><br><span class="small muted">Lo anterior más profesionales, tratamientos y bloqueos. Mantiene los ajustes del centro, el logo y los usuarios del personal.</span></span></label>
        <label class="f"><span>Para confirmar, escribí <b class="mono">BORRAR</b></span><input type="text" id="reinicioConf" autocomplete="off" style="max-width:220px"></label>
        <div class="row"><button class="btn danger" type="submit" ${ui.busy?"disabled":""}>${ui.busy?"Borrando…":"Borrar definitivamente"}</button></div></form></section></div>`;
}

/* ---------- render ---------- */
let faviconActual=null;
function ponerFavicon(url){
  if(url===faviconActual)return;faviconActual=url;
  let l=document.querySelector('link[rel="icon"]');
  if(!url)url="icons/favicon-32.png";
  if(!l){l=document.createElement("link");l.rel="icon";document.head.appendChild(l);}
  l.href=url;
}
function render(){
  if(!S.config){return;}
  dispCache=null;
  document.getElementById("bizName").textContent=S.config.negocio;
  document.title=(ui.mode==="pro"?"Panel · ":"Turnos · ")+S.config.negocio;
  const pa=prosActivos();
  document.getElementById("bizSub").textContent=pa.length>1?pa.length+" profesionales":(pa[0]||{nombre:""}).nombre;
  const mk=document.getElementById("mark");
  if(S.config.logoUrl){if(mk.dataset.logo!==S.config.logoUrl){mk.innerHTML=`<img src="${esc(S.config.logoUrl)}" alt="">`;mk.dataset.logo=S.config.logoUrl;}mk.classList.add("logo");}
  else{mk.classList.remove("logo");mk.dataset.logo="";mk.textContent=(S.config.negocio.trim()[0]||"T").toUpperCase();}
  ponerFavicon(S.config.logoUrl);
  document.getElementById("modeSeg").hidden=!ui.yo;
  document.getElementById("mCli").setAttribute("aria-pressed",ui.mode==="cliente");
  document.getElementById("mPro").setAttribute("aria-pressed",ui.mode==="pro");
  document.getElementById("bnav").hidden=ui.mode!=="cliente";
  document.getElementById("foot").hidden=ui.mode!=="cliente"||!!ui.yo;
  document.getElementById("btnInstalar").hidden=!puedeInstalar();
  const mt=document.querySelector('meta[name="apple-mobile-web-app-title"]');if(mt&&S.config.negocio)mt.content=S.config.negocio.slice(0,30);
  document.getElementById("nRes").setAttribute("aria-current",ui.ctab==="reservar"?"page":"false");
  document.getElementById("nMis").setAttribute("aria-current",ui.ctab==="mis"?"page":"false");
  document.getElementById("app").innerHTML=ui.mode==="pro"?vPro():(ui.ctab==="mis"?vMis():vReservar());
}

/* ---------- acciones ---------- */
function leerComprobante(file,cb){
  if(!file)return;
  if(file.size>5*1024*1024&&!/^image\//.test(file.type)){toast("El archivo pesa más de 5 MB. Mandá una captura.");return;}
  if(!/^image\//.test(file.type)){cb({nombre:file.name,dataUrl:null,blob:file,tipo:file.type||"application/pdf",ext:"pdf"});return;}
  const fr=new FileReader();
  fr.onload=()=>{const img=new Image();img.onload=()=>{const k=Math.min(1,1400/Math.max(img.width,img.height));const cv=document.createElement("canvas");cv.width=Math.round(img.width*k);cv.height=Math.round(img.height*k);cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height);
      cv.toBlob(b=>{cb({nombre:file.name,dataUrl:cv.toDataURL("image/jpeg",0.6),blob:b||file,tipo:b?"image/jpeg":file.type,ext:b?"jpg":(file.name.split(".").pop()||"jpg")});},"image/jpeg",0.82);};
    img.onerror=()=>cb({nombre:file.name,dataUrl:null,blob:file,tipo:file.type,ext:file.name.split(".").pop()||"jpg"});img.src=fr.result;};
  fr.readAsDataURL(file);
}
const uuid=()=>(crypto.randomUUID?crypto.randomUUID():Date.now().toString(16)+Math.random().toString(16).slice(2));
async function exportar(){
  const {a,b,lab}=periodo(),r=calcPeriodo(a,b);
  const dentro=f=>{const d=parseYmd(f);return d>=a&&d<=b;};
  const turnos=S.turnos.filter(t=>dentro(t.fecha)).sort((x,y)=>startOf(x)-startOf(y)).map(t=>{const c=cliById(t.clienteId)||{nombre:"",tel:""};return {
    "Fecha":fechaCorta(t.fecha),"Hora":t.hora,"Cliente":c.nombre,"WhatsApp":c.tel,"Tratamiento":t.servicioNombre,"Profesional":proNombre(t.profId),
    "Estado":ESTADOS[t.estado],"Precio":t.precio,"Cobrado":neto(t),"Saldo":ocupa(t)?saldo(t):0,"Paquete":t.packId?"Sí":"","Origen":t.origen==="panel"?"Panel":"Web"};});
  const pagos=[];
  S.turnos.forEach(t=>(t.pagos||[]).forEach(p=>{if(dentro(p.fecha)){const c=cliById(t.clienteId)||{nombre:""};pagos.push({"Fecha":fechaCorta(p.fecha),"Cliente":c.nombre,"Concepto":p.tipo+" · "+t.servicioNombre,"Medio":p.medio,"Monto":p.monto,_o:p.fecha});}}));
  S.ventas.filter(v=>dentro(v.fecha)).forEach(v=>{const c=cliById(v.clienteId)||{nombre:""};pagos.push({"Fecha":fechaCorta(v.fecha),"Cliente":c.nombre,"Concepto":v.concepto,"Medio":v.medio,"Monto":v.monto,_o:v.fecha});});
  pagos.sort((x,y)=>x._o.localeCompare(y._o));pagos.forEach(p=>delete p._o);
  const res=[{"Concepto":"Período","Valor":`${lab} (${fechaCorta(ymd(a))} al ${fechaCorta(ymd(b))})`},{"Concepto":"Turnos","Valor":r.ts.length},{"Concepto":"Facturación proyectada","Valor":r.fact},{"Concepto":"Ya cobrado","Valor":r.cobr},{"Concepto":"A cobrar en los turnos","Valor":r.aCobrar},{"Concepto":"Señas pendientes","Valor":r.senP},{"Concepto":"Paquetes vendidos","Valor":r.ventas}];
  if(window.XLSX){
    const X=window.XLSX,wb=X.utils.book_new();
    const add=(rows,name,cols)=>{const ws=X.utils.json_to_sheet(rows.length?rows:[{}]);ws["!cols"]=cols.map(w=>({wch:w}));X.utils.book_append_sheet(wb,ws,name);};
    add(res,"Resumen",[26,40]);add(turnos,"Turnos",[10,7,22,16,28,16,16,10,10,10,9,8]);add(pagos,"Pagos",[10,22,44,16,10]);
    X.writeFile(wb,`turnos-${ymd(a)}-al-${ymd(b)}.xlsx`);
    toast("Archivo de Excel descargado");return;
  }
  const tsv=rows=>{if(!rows.length)return "";const h=Object.keys(rows[0]);return [h.join("\t")].concat(rows.map(r=>h.map(k=>String(r[k]==null?"":r[k]).replace(/\t|\n/g," ")).join("\t"))).join("\n");};
  ui.csv=`RESUMEN\n${tsv(res)}\n\nTURNOS\n${tsv(turnos)}\n\nPAGOS\n${tsv(pagos)}`;
}
async function recargar(){
  if(ui.mode==="pro"&&ui.yo){await loadStaff();ui.cargado=true;ui.errorCarga="";}
  else{await loadCatalogo(false);await Promise.all([loadOcupados(),loadMis()]);}
}
async function staffDo(fn,args,ok){await rpc(fn,args);await loadStaff();if(ok)toast(ok);}

const A={
  mode:async v=>{
    if(v==="pro"){ui.mode="pro";history.replaceState(null,"","#centro");if(ui.yo&&!ui.cargado){render();try{await loadStaff();ui.cargado=true;}catch(e){ui.errorCarga=errMsg(e);}}}
    else{ui.mode="cliente";history.replaceState(null,"",location.pathname);await loadPublico();}
    ui.confirm=null;
  },
  ctab:v=>{ui.ctab=v;ui.confirm=null;if(ui.reprog){ui.reprog=null;ui.sel=Object.assign({},ui.sel,{servicioId:null,fecha:null,hora:null,profId:null});ui.step=pasos()[0];}if(v==="reservar"&&ui.done)ui.done=null;},
  pickPro:v=>{if(ui.sel.profId!==v){ui.sel.fecha=null;ui.sel.hora=null;const s=svcById(ui.sel.servicioId);if(s&&v!=="any"&&!s.profIds.includes(v))ui.sel.servicioId=null;}ui.sel.profId=v;ui.step="svc";},
  pickSvc:async v=>{if(ui.sel.servicioId!==v){ui.sel.fecha=null;ui.sel.hora=null;}ui.sel.servicioId=v;const s=svcById(v);ui.sel.monto=s.sena<100?"sena":"total";if(!ui.sel.profId)ui.sel.profId="any";ui.step="fecha";loadOcupados().then(render).catch(()=>{});},
  pickDay:v=>{ui.sel.fecha=v;ui.sel.hora=null;ui.sel.franja=null;},
  franja:v=>{ui.sel.franja=v;},
  pickHora:v=>{ui.sel.hora=v;const x=libresDe(ui.sel.fecha,svcById(ui.sel.servicioId),ui.sel.profId).find(s=>s.hora===v);ui.sel.horaPros=x?x.pros:[];},
  mes:v=>{ui.mes=new Date(ui.mes.getFullYear(),ui.mes.getMonth()+(+v),1);},
  step:v=>{ui.step=v;ui.checkout=false;ui.formErr="";},
  reservar:async()=>{
    const s=svcById(ui.sel.servicioId),c=cliPorTel(ui.sel.tel);
    ui.busy=true;render();
    try{
      const r=await rpc("reservar",{p_servicio:s.id,p_profesional:ui.sel.profId&&ui.sel.profId!=="any"?ui.sel.profId:(ui.sel.horaPros[0]||null),p_fecha:ui.sel.fecha,p_hora:ui.sel.hora,
        p_nombre:ui.sel.nombre,p_tel:ui.sel.tel,p_email:ui.sel.email,p_medio:ui.sel.medio,p_monto:ui.sel.monto,p_token:c&&c.token?c.token:null});
      guardarToken(r.token);
      await Promise.all([loadOcupados(),loadMis()]);
      ui.done=r.turno_id;ui.comp=null;
      ui.sel=Object.assign({},ui.sel,{servicioId:null,fecha:null,hora:null,horaPros:[],franja:null,profId:null});ui.step=pasos()[0];
      toast(ui.sel.medio==="transferencia"?"Horario reservado. Falta la seña.":"Turno confirmado");
    }catch(e){
      const m=errMsg(e);toast(m);
      if(/ocupar/.test(m)){ui.step="fecha";ui.sel.hora=null;await loadOcupados();}
    }finally{ui.busy=false;}
  },
  reprog:v=>{const t=misTurno(v);if(!t||!puedeCancelar(t)){toast("Ya no se puede reprogramar online.");return;}const s=svcById(t.servicioId),p=proById(t.profId);
    if(!s){toast("Ese tratamiento ya no se ofrece. Escribile al centro.");return;}
    ui.reprog=v;ui.done=null;ui.ctab="reservar";ui.confirm=null;ui.esperaForm=false;
    ui.sel=Object.assign({},ui.sel,{servicioId:t.servicioId,profId:p&&p.activo&&s.profIds.includes(p.id)?p.id:"any",fecha:null,hora:null,horaPros:[],franja:null});
    const n=ahoraAR();ui.mes=new Date(n.getFullYear(),n.getMonth(),1);},
  reprogCancel:()=>{ui.reprog=null;ui.ctab="mis";ui.sel=Object.assign({},ui.sel,{servicioId:null,fecha:null,hora:null,profId:null});},
  reprogAny:()=>{ui.sel.profId="any";ui.sel.fecha=null;ui.sel.hora=null;},
  reprogOk:async()=>{const t=misTurno(ui.reprog);if(!t)return;
    try{await rpc("reprogramar_turno",{p_token:t.token,p_turno:t.id,p_fecha:ui.sel.fecha,p_hora:ui.sel.hora,p_profesional:ui.sel.profId!=="any"?ui.sel.profId:null});
      await Promise.all([loadOcupados(),loadMis()]);ui.done=t.id;ui.reprog=null;ui.sel=Object.assign({},ui.sel,{servicioId:null,fecha:null,hora:null,profId:null});toast("Turno reprogramado");}
    catch(e){toast(errMsg(e));ui.sel.hora=null;await loadOcupados();}},
  esperaOpen:()=>{ui.esperaForm=true;ui.formErr="";},
  esperaClose:()=>{ui.esperaForm=false;ui.formErr="";},
  esperaQuitarCli:async v=>{const e=S.misEspera.find(x=>x.id===v);if(!e)return;try{await rpc("quitar_espera",{p_token:e.token,p_id:v});await loadMis();toast("Saliste de la lista de espera");}catch(err){toast(errMsg(err));}},
  nueva:()=>{ui.done=null;ui.step=pasos()[0];ui.ctab="reservar";},
  verMis:()=>{ui.done=null;ui.ctab="mis";},
  verDone:v=>{ui.done=v;ui.ctab="reservar";ui.comp=null;},
  qrBajar:()=>bajarQr(),
  instalar:()=>instalar(),
  instalarNo:()=>{try{localStorage.setItem(INST_KEY,"1");}catch(e){}render();},
  hojaCerrar:()=>cerrarHoja(),
  copy:v=>{const fb=()=>toast("Seleccioná y copiá: "+v);try{navigator.clipboard.writeText(v).then(()=>toast("Copiado"),fb);}catch(e){fb();}},
  enviarComp:async v=>{const t=misTurno(v);if(!t||!ui.comp)return;ui.busy=true;render();
    try{const path=`${t.id}/${uuid()}.${ui.comp.ext||"jpg"}`;
      const up=await sb.storage.from("comprobantes").upload(path,ui.comp.blob,{contentType:ui.comp.tipo||"image/jpeg",upsert:false});
      if(up.error)throw up.error;
      await rpc("registrar_comprobante",{p_token:t.token,p_turno:t.id,p_path:path,p_nombre:ui.comp.nombre});
      ui.comp=null;await loadMis();toast("Comprobante enviado");}
    catch(e){toast(errMsg(e));}finally{ui.busy=false;}},
  ask:v=>{ui.confirm=v;},
  noConfirm:()=>{ui.confirm=null;},
  cliCancel:async v=>{const t=misTurno(v);ui.confirm=null;if(!t)return;
    try{const r=await rpc("cancelar_turno",{p_token:t.token,p_turno:t.id});await Promise.all([loadOcupados(),loadMis()]);toast(r&&r.a_favor?"Turno cancelado. "+$m(r.a_favor)+" quedan a favor.":"Turno cancelado");}
    catch(e){toast(errMsg(e));}},
  /* centro */
  logout:async()=>{await sb.auth.signOut();ui.yo=null;ui.sesion=null;ui.cargado=false;ui.mode="cliente";history.replaceState(null,"",location.pathname);await loadPublico();},
  recargar:async()=>{try{await loadStaff();ui.cargado=true;ui.errorCarga="";}catch(e){ui.errorCarga=errMsg(e);}},
  ptab:v=>{ui.ptab=v;ui.confirm=null;ui.payFor=null;ui.cliSel=null;ui.recienConf=null;ui.mover=null;},
  notifs:()=>{ui.notifOpen=!ui.notifOpen;},
  leerTodo:async()=>{const ids=S.notifs.filter(n=>!n.leida).map(n=>n.id);if(!ids.length)return;const {error}=await sb.from("notifs").update({leida:true}).in("id",ids);if(error)toast(errMsg(error));else S.notifs.forEach(n=>n.leida=true);},
  vista:v=>{ui.vista=v;ui.hl=null;},
  adia:v=>{ui.agendaFecha=ymd(addDays(parseYmd(ui.agendaFecha),(+v)*(ui.vista==="semana"?7:1)));ui.payFor=null;ui.confirm=null;ui.hl=null;},
  ahoy:()=>{ui.agendaFecha=hoyS();ui.hl=null;},
  irDia:v=>{ui.agendaFecha=v;ui.vista="dia";ui.hl=null;},
  verTurno:v=>{const t=turnoById(v);if(t){ui.agendaFecha=t.fecha;ui.vista="dia";ui.hl=v;}},
  ntOpen:v=>{ui.nt={cliId:v||"",nombre:"",tel:"",svcId:"",profId:esAdmin()?"":ui.yo.profId,fecha:ui.agendaFecha<hoyS()?hoyS():ui.agendaFecha,hora:"",pago:"ninguno",medio:"Efectivo",sobre:false};ui.ntErr="";ui.ptab="agenda";ui.cliSel=null;},
  ntClose:()=>{ui.nt=null;},
  payFor:v=>{ui.payFor=v||null;ui.mover=null;},
  estado:async(v,el)=>{try{await staffDo("staff_estado",{p_turno:v,p_estado:el.getAttribute("data-e")});}catch(e){toast(errMsg(e));}},
  proCancel:async(v,el)=>{ui.confirm=null;try{const r=await rpc("staff_cancelar",{p_turno:v,p_favor:el.getAttribute("data-m")==="favor"});await loadStaff();toast(r&&r.a_favor?"Cancelado. "+$m(r.a_favor)+" quedan a favor.":"Turno cancelado");}catch(e){toast(errMsg(e));}},
  recordado:async v=>{try{await staffDo("staff_recordado",{p_turno:v});}catch(e){toast(errMsg(e));}},
  senaOk:async v=>{try{await staffDo("staff_confirmar_sena",{p_turno:v},"Seña confirmada");ui.recienConf=v;ui.ptab="senas";ui.confirm=null;}catch(e){toast(errMsg(e));}},
  cerrarConf:()=>{ui.recienConf=null;},
  senaReintento:async v=>{ui.confirm=null;try{await staffDo("staff_reintento",{p_turno:v},"Volvió a esperando seña");}catch(e){toast(errMsg(e));}},
  extender:async v=>{try{await staffDo("staff_extender",{p_turno:v},"Reserva extendida");}catch(e){toast(errMsg(e));}},
  liberar:async v=>{ui.confirm=null;try{await staffDo("staff_cancelar",{p_turno:v,p_favor:true},"Horario liberado");}catch(e){toast(errMsg(e));}},
  esperaQuitar:async v=>{const {error}=await sb.from("espera").delete().eq("id",v);if(error)toast(errMsg(error));else{S.espera=S.espera.filter(e=>e.id!==v);toast("Quitado de la lista de espera");}},
  esperaAvisado:async v=>{const {error}=await sb.from("espera").update({avisado:new Date().toISOString()}).eq("id",v);if(!error){const e=S.espera.find(x=>x.id===v);if(e)e.avisado=Date.now();}},
  mover:v=>{const t=turnoById(v);ui.mover=t?{id:v,fecha:t.fecha}:null;ui.payFor=null;ui.confirm=null;},
  cliSel:v=>{ui.cliSel=v||null;ui.packForm=false;ui.credForm=false;},
  packForm:()=>{ui.packForm=!ui.packForm;},
  credForm:()=>{ui.credForm=!ui.credForm;},
  exportar:async()=>{await exportar();},
  csvClose:()=>{ui.csv=null;},
  copyCsv:()=>{const el=document.getElementById("csvTxt");const fb=()=>{if(el){el.focus();el.select();}toast("Seleccionado: copialo con Ctrl+C");};try{navigator.clipboard.writeText(ui.csv).then(()=>toast("Copiado. Pegalo en Excel."),fb);}catch(e){fb();}},
  svcAdd:async()=>{const {data,error}=await sb.from("servicios").insert({nombre:"Nuevo tratamiento",duracion:30,precio:10000,sena:30,activo:false,prof_ids:prosActivos().map(p=>p.id),orden:S.servicios.length+1}).select().single();
    if(error){toast(errMsg(error));return;}S.servicios.push(mapSvc(data));ui.svcOpen=data.id;},
  svcOpen:v=>{ui.svcOpen=v||null;ui.confirm=null;},
  svcDel:async v=>{ui.confirm=null;const {error}=await sb.from("servicios").delete().eq("id",v);if(error){toast("No se pudo borrar: tiene turnos asociados. Ocultalo en su lugar.");return;}S.servicios=S.servicios.filter(s=>s.id!==v);toast("Tratamiento borrado");},
  proOpen:v=>{ui.proOpen=v||null;},
  logoDel:async()=>{ui.confirm=null;const viejo=S.config.logoUrl;await upd("config",null,{logo_url:""});S.config.logoUrl="";borrarLogoArchivo(viejo);toast("Logo quitado");},
  proAdd:async()=>{const h={};for(let i=0;i<7;i++)h[i]=i>=1&&i<=5?[{desde:"09:00",hasta:"18:00"}]:[];
    const {data,error}=await sb.from("profesionales").insert({nombre:"Nuevo profesional",color:(S.profesionales.length%4)+1,activo:false,horario:h,orden:S.profesionales.length+1}).select().single();
    if(error){toast(errMsg(error));return;}S.profesionales.push(mapPro(data));ui.proOpen=data.id;},
  rngAdd:async(v,el)=>{const p=proById(el.getAttribute("data-p")),d=el.getAttribute("data-d"),r=p.horario[d],last=r[r.length-1],a=last?Math.min(toMin(last.hasta)+60,22*60):9*60;
    r.push({desde:fromMin(a),hasta:fromMin(Math.min(a+180,23*60))});await guardarHorario(p);},
  rngDel:async(v,el)=>{const p=proById(el.getAttribute("data-p"));p.horario[el.getAttribute("data-d")].splice(+el.getAttribute("data-i"),1);await guardarHorario(p);},
  bloqDel:async v=>{const ids=String(v).split(",").filter(Boolean);const {error}=await sb.from("bloqueos").delete().in("id",ids);if(error){toast(errMsg(error));return;}S.bloqueos=S.bloqueos.filter(b=>!ids.includes(b.id));toast("Bloqueo quitado");},
  proDel:async v=>{
    ui.confirm=null;const p=proById(v);if(!p)return;
    if(S.turnos.some(t=>t.profId===v&&ACTIVOS.includes(t.estado)&&t.fecha>=hoyS())){toast("Tiene turnos próximos: movelos o cancelalos antes.");return;}
    await upd("profesionales",v,{archivado:true,activo:false});
    for(const s of S.servicios.filter(x=>x.profIds.includes(v))){const nv=s.profIds.filter(x=>x!==v);await upd("servicios",s.id,{prof_ids:nv});s.profIds=nv;}
    p.archivado=true;p.activo=false;ui.proOpen=null;toast(p.nombre+" ya no aparece en el panel ni para reservar");
  }
};
function borrarLogoArchivo(url){
  const m=String(url||"").match(/\/marca\/([^?]+)/);
  if(m)sb.storage.from("marca").remove([decodeURIComponent(m[1])]).catch(()=>{});
}
async function subirLogo(file){
  if(!/^image\/(png|jpeg|webp)$/.test(file.type)){toast("Subí una imagen PNG, JPG o WEBP.");return;}
  if(file.size>8*1024*1024){toast("La imagen es muy pesada. Probá con una de menos de 8 MB.");return;}
  ui.busy=true;render();
  try{
    const blob=await new Promise((ok,mal)=>{const fr=new FileReader();fr.onerror=mal;fr.onload=()=>{const img=new Image();img.onerror=mal;img.onload=()=>{
      const k=Math.min(1,512/Math.max(img.width,img.height));const cv=document.createElement("canvas");cv.width=Math.max(1,Math.round(img.width*k));cv.height=Math.max(1,Math.round(img.height*k));
      cv.getContext("2d").drawImage(img,0,0,cv.width,cv.height);cv.toBlob(b=>b?ok(b):mal(new Error("No se pudo procesar la imagen")),file.type==="image/jpeg"?"image/jpeg":"image/png",0.9);};img.src=fr.result;};fr.readAsDataURL(file);});
    const ext=blob.type==="image/jpeg"?"jpg":"png",path=`logo-${Date.now()}.${ext}`;
    const up=await sb.storage.from("marca").upload(path,blob,{contentType:blob.type,upsert:false,cacheControl:"31536000"});
    if(up.error)throw up.error;
    const url=sb.storage.from("marca").getPublicUrl(path).data.publicUrl;
    const viejo=S.config.logoUrl;
    await upd("config",null,{logo_url:url});S.config.logoUrl=url;
    borrarLogoArchivo(viejo);toast("Logo actualizado");
  }catch(e){toast(errMsg(e));}finally{ui.busy=false;}
}
async function bloquear(desde,hasta,profId,motivo,hDesde,hHasta){
  const filas=[];
  for(let d=parseYmd(desde);ymd(d)<=hasta;d=addDays(d,1)){filas.push({fecha:ymd(d),desde:hDesde,hasta:hHasta,profesional_id:profId,motivo});if(filas.length>366)break;}
  if(filas.length>366){toast("El rango es demasiado largo (máximo un año).");return;}
  const {data,error}=await sb.from("bloqueos").insert(filas).select();
  if(error)throw error;
  data.forEach(r=>S.bloqueos.push(mapBloq(r)));
  const choques=S.turnos.filter(t=>ACTIVOS.includes(t.estado)&&t.fecha>=desde&&t.fecha<=hasta&&(!profId||t.profId===profId)&&(!hDesde||(toMin(t.hora)<toMin(hHasta)&&toMin(t.hora)+t.duracion>toMin(hDesde))));
  toast(choques.length?`Bloqueado. Ojo: hay ${choques.length} ${choques.length===1?"turno":"turnos"} en esos días; movelos o cancelalos desde la Agenda.`:`Bloqueado: ${filas.length} ${filas.length===1?"día":"días"}.`);
}
async function guardarHorario(p){try{await upd("profesionales",p.id,{horario:p.horario});toast("Horario guardado");}catch(e){toast(errMsg(e));}}

document.addEventListener("click",e=>{
  const el=e.target.closest("[data-a]");if(!el||el.disabled)return;
  const fn=A[el.getAttribute("data-a")];if(!fn)return;
  const isLink=el.tagName==="A";
  if(!isLink)e.preventDefault();
  Promise.resolve(fn(el.getAttribute("data-v"),el)).catch(err=>toast(errMsg(err))).then(()=>{
    render();
    if(ui.hl&&ui.vista==="dia"&&el.getAttribute("data-a")==="verTurno"){const n=document.getElementById("t_"+ui.hl);if(n)n.scrollIntoView({block:"center"});}
  });
});
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target.matches("tr[data-a]"))e.target.click();});
document.addEventListener("keydown",e=>{if(e.key==="Escape")cerrarHoja();});
document.addEventListener("change",async e=>{
  const el=e.target,c=el.getAttribute("data-c");if(!c)return;
  const v=el.value;
  try{
    if(c==="comp"){leerComprobante(el.files&&el.files[0],r=>{ui.comp=r;render();});return;}
    if(c==="logo"){const f=el.files&&el.files[0];el.value="";if(f)await subirLogo(f);render();return;}
    if(c==="monto")ui.sel.monto=v;
    else if(c==="medio")ui.sel.medio=v;
    else if(c==="agendaFecha"){if(v){ui.agendaFecha=v;ui.hl=null;}}
    else if(c==="agProf")ui.agProf=v;
    else if(c==="ingPer")ui.ingPer=v;
    else if(c==="mv"){if(v&&ui.mover)ui.mover.fecha=v;}
    else if(c==="nt"){
      const k=el.getAttribute("data-k");
      const nn=document.getElementById("ntNombre"),nt=document.getElementById("ntTel");if(nn)ui.nt.nombre=nn.value;if(nt)ui.nt.tel=nt.value;
      ui.nt[k]=el.type==="checkbox"?el.checked:v;
      if(["svcId","fecha","profId","sobre"].includes(k))ui.nt.hora="";
      ui.ntErr="";
    }
    else if(c==="cfg"){
      const k=el.getAttribute("data-k");let val;
      if(el.getAttribute("data-b"))val=el.checked;
      else if(el.getAttribute("data-n"))val=+v;
      else if(k==="whatsapp")val=digits(v);
      else if(k==="mpLink"){val=v.trim();if(val&&!/^https:\/\/[^\s"<>]+$/i.test(val)){toast("El link tiene que empezar con https://");return;}}
      else val=v;
      await upd("config",null,{[CFG_COLS[k]]:val,updated_at:new Date().toISOString()});
      S.config[k]=val;toast("Guardado");
    }
    else if(c==="svc"){
      const s=svcById(el.getAttribute("data-id")),k=el.getAttribute("data-k");if(!s)return;
      let val;
      if(k==="activo"||k==="restringir")val=el.checked;
      else if(["nombre","desc","categoria","equipo"].includes(k)){val=v.trim();if(k==="nombre"&&!val){toast("El nombre no puede quedar vacío");render();return;}}
      else if(k==="desde"||k==="hasta"){if(!v)return;val=v;}
      else{val=Math.max(0,Math.round(+v||0));if(k==="sena")val=Math.min(100,val);if(k==="duracion")val=Math.max(10,val);}
      await upd("servicios",s.id,{[SVC_COLS[k]]:val});s[k]=val;toast("Tratamiento actualizado");
    }
    else if(c==="svcPro"){const s=svcById(el.getAttribute("data-id")),p=el.getAttribute("data-p");const nv=el.checked?[...new Set(s.profIds.concat(p))]:s.profIds.filter(x=>x!==p);await upd("servicios",s.id,{prof_ids:nv});s.profIds=nv;}
    else if(c==="svcDia"){const s=svcById(el.getAttribute("data-id")),d=+el.getAttribute("data-d");const nv=el.checked?[...new Set(s.dias.concat(d))]:s.dias.filter(x=>x!==d);await upd("servicios",s.id,{dias:nv});s.dias=nv;}
    else if(c==="pro"){
      const p=proById(el.getAttribute("data-id")),k=el.getAttribute("data-k");if(!p)return;
      let val=k==="activo"?el.checked:k==="color"?+v:k==="tel"?digits(v):v.trim();
      if(k==="nombre"&&!val){toast("El nombre no puede quedar vacío");render();return;}
      await upd("profesionales",p.id,{[k]:val});p[k]=val;toast("Profesional actualizado");
    }
    else if(c==="cli"){const cl=cliById(el.getAttribute("data-id")),k=el.getAttribute("data-k");if(!cl)return;const val=k==="tel"?waNum(v):v;await upd("clientes",cl.id,{[k]:val});cl[k]=val;toast("Cliente actualizado");}
    else if(c==="dayon"){const p=proById(el.getAttribute("data-p"));p.horario[el.getAttribute("data-d")]=el.checked?[{desde:"09:00",hasta:"13:00"}]:[];await guardarHorario(p);}
    else if(c==="rng"){
      const p=proById(el.getAttribute("data-p")),r=p.horario[el.getAttribute("data-d")][+el.getAttribute("data-i")];
      if(r&&v){r[el.getAttribute("data-k")]=v;if(toMin(r.hasta)<=toMin(r.desde)){toast("La hora de fin tiene que ser posterior al inicio");}else await guardarHorario(p);}
    }
    else return;
  }catch(err){toast(errMsg(err));try{await loadStaff();}catch(_){}}
  render();
});
document.addEventListener("input",e=>{
  if(e.target.id==="cliQ"){ui.cliQ=e.target.value;const pos=e.target.selectionStart;render();const n=document.getElementById("cliQ");if(n){n.focus();try{n.setSelectionRange(pos,pos);}catch(_){}}}
});
document.addEventListener("submit",async e=>{
  const f=e.target,k=f.getAttribute("data-f");if(!k)return;
  e.preventDefault();
  const val=id=>{const n=document.getElementById(id);return n?n.value:"";};
  try{
    if(k==="pegarLink"){
      const m=val("pegaLink").match(/mis-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
      if(!m){toast("Ese link no es válido. Copialo completo desde el mensaje del centro.");return;}
      guardarToken(m[1]);await loadMis();render();
      toast(S.misTurnos.length||S.misEspera.length?"¡Listo! Ya ves tus turnos":"No encontramos turnos con ese link");return;
    }
    if(k==="datos"){
      ui.sel.nombre=val("fNombre");ui.sel.tel=val("fTel");ui.sel.email=val("fEmail");
      if(ui.sel.nombre.trim().length<3)ui.formErr="Escribí tu nombre y apellido.";
      else if(digits(ui.sel.tel).length<10)ui.formErr="Revisá el WhatsApp: tiene que tener código de área y número (al menos 10 dígitos).";
      else if(ui.sel.email&&!/^\S+@\S+\.\S+$/.test(ui.sel.email))ui.formErr="El email no parece válido.";
      else{ui.formErr="";ui.step="pago";}
    }
    else if(k==="login"){
      const email=val("lgEmail").trim(),password=val("lgPass");
      ui.busy=true;ui.loginErr="";render();
      const {data,error}=await sb.auth.signInWithPassword({email,password});
      ui.busy=false;
      if(error){ui.loginErr=errMsg(error);}
      else{ui.sesion=data.session;await cargarYo();if(ui.yo){try{await loadStaff();ui.cargado=true;}catch(err){ui.errorCarga=errMsg(err);}suscribir();}}
    }
    else if(k==="espera"){
      const fe=val("esFecha"),nom=val("esNombre").trim(),tel=val("esTel");
      ui.sel.nombre=nom;ui.sel.tel=tel;
      if(!fe)ui.formErr="Elegí el día.";
      else if(nom.length<3)ui.formErr="Escribí tu nombre y apellido.";
      else if(digits(tel).length<10)ui.formErr="Revisá el WhatsApp: código de área y número.";
      else{
        const c=cliPorTel(tel);
        const r=await rpc("anotar_espera",{p_servicio:ui.sel.servicioId,p_profesional:ui.sel.profId&&ui.sel.profId!=="any"?ui.sel.profId:null,p_fecha:fe,p_franja:val("esFranja"),p_nombre:nom,p_tel:tel,p_token:c&&c.token?c.token:null});
        guardarToken(r.token);await loadMis();
        ui.esperaForm=false;ui.formErr="";toast("Listo, te anotamos. Si se libera un lugar te avisamos por WhatsApp.");
      }
    }
    else if(k==="pay"){
      const monto=Math.round(+val("payMonto")||0);
      await staffDo("staff_pago",{p_turno:f.getAttribute("data-v"),p_monto:monto,p_medio:val("payMedio")},"Pago registrado");ui.payFor=null;
    }
    else if(k==="mv"){
      const h=val("mvHora");if(!/^\d\d:\d\d$/.test(h))return;
      await staffDo("staff_mover",{p_turno:f.getAttribute("data-v"),p_fecha:ui.mover.fecha,p_hora:h},"Turno movido. Avisale al cliente por WhatsApp.");
      ui.agendaFecha=ui.mover.fecha;ui.hl=f.getAttribute("data-v");ui.mover=null;
    }
    else if(k==="nt"){
      const n=ui.nt;
      if(!n.cliId){n.nombre=val("ntNombre");n.tel=val("ntTel");}
      if(n.sobre)n.hora=val("ntHoraL");
      if(!n.svcId){ui.ntErr="Elegí el tratamiento.";}
      else if(!n.profId){ui.ntErr="Ningún profesional activo hace este tratamiento.";}
      else if(!n.fecha||!n.hora){ui.ntErr="Elegí fecha y hora.";}
      else{
        ui.busy=true;render();
        try{await staffDo("staff_crear_turno",{p_cliente:n.cliId||null,p_nombre:n.nombre,p_tel:n.tel,p_servicio:n.svcId,p_profesional:n.profId,p_fecha:n.fecha,p_hora:n.hora,p_pago:n.pago,p_medio:n.medio,p_sobreturno:!!n.sobre},"Turno guardado");
          ui.agendaFecha=n.fecha;ui.nt=null;}
        catch(err){ui.ntErr=errMsg(err);}finally{ui.busy=false;}
      }
    }
    else if(k==="pack"){
      await staffDo("staff_vender_paquete",{p_cliente:f.getAttribute("data-v"),p_servicio:val("pkSvc"),p_sesiones:Math.round(+val("pkN")||0),p_precio:Math.round(+val("pkPrecio")||0),p_medio:val("pkMedio")},"Paquete registrado");
      ui.packForm=false;
    }
    else if(k==="cred"){
      const id=f.getAttribute("data-v"),m=Math.max(0,Math.round(+val("credMonto")||0));
      await upd("clientes",id,{credito:m});const cl=cliById(id);if(cl)cl.credito=m;ui.credForm=false;toast("Saldo a favor actualizado");
    }
    else if(k==="bloq"){
      const fe=val("bqFecha"),fh=val("bqFechaH")||fe,de=val("bqDesde"),ha=val("bqHasta");
      if(!fe)toast("Elegí el día");
      else if(fh<fe)toast("El día final tiene que ser igual o posterior al inicial");
      else if((de&&!ha)||(!de&&ha)||(de&&ha&&toMin(ha)<=toMin(de)))toast("Revisá el horario: completá desde y hasta, o dejá los dos vacíos");
      else if((de||ha)&&fh!==fe)toast("Un bloqueo por horas es para un solo día. Para varios días dejá las horas vacías.");
      else await bloquear(fe,fh,val("bqPro")||null,val("bqMotivo").trim(),de||null,ha||null);
    }
    else if(k==="reinicio"){
      const conf=val("reinicioConf").trim(),todo=(f.querySelector('input[name="alcance"]:checked')||{}).value==="todo";
      if(conf!=="BORRAR"){toast("Escribí BORRAR (en mayúsculas) para confirmar");}
      else{
        ui.busy=true;render();
        try{
          const paths=S.turnos.map(t=>t.comprobante&&t.comprobante.path).filter(Boolean);
          for(let i=0;i<paths.length;i+=100){await sb.storage.from("comprobantes").remove(paths.slice(i,i+100));}
          const r=await rpc("admin_reiniciar",{p_confirmacion:conf,p_catalogo:todo});
          ui.cliSel=null;ui.nt=null;ui.recienConf=null;ui.compUrls={};
          await loadStaff();
          toast(`Listo: se borraron ${r.turnos} turnos y ${r.clientes} clientes${todo?", más profesionales y tratamientos":""}.`);
        }finally{ui.busy=false;}
      }
    }
    else if(k==="vac"){
      const pid=f.getAttribute("data-v"),fe=val("vacDesde_"+pid),fh=val("vacHasta_"+pid)||fe;
      if(!fe)toast("Elegí desde qué día");
      else if(fh<fe)toast("El día final tiene que ser igual o posterior al inicial");
      else await bloquear(fe,fh,pid,val("vacMot_"+pid).trim()||"Ausencia",null,null);
    }
  }catch(err){toast(errMsg(err));ui.busy=false;}
  render();
});

/* ---------- sesión del personal y tiempo real ---------- */
async function cargarYo(){
  ui.yo=null;if(!ui.sesion)return;
  const {data,error}=await sb.from("staff").select("rol,profesional_id,nombre").eq("user_id",ui.sesion.user.id).maybeSingle();
  if(!error&&data)ui.yo={rol:data.rol,profId:data.profesional_id,nombre:data.nombre};
}
let canal=null,recargaTimer=null;
function suscribir(){
  if(canal||!ui.yo)return;
  const onChange=()=>{clearTimeout(recargaTimer);recargaTimer=setTimeout(async function tick(){
    const a=document.activeElement;
    if(a&&a.matches("input,select,textarea")&&a.closest("#app")){recargaTimer=setTimeout(tick,2500);return;}
    try{await loadStaff();if(ui.mode==="pro")render();}catch(e){}
  },700);};
  canal=sb.channel("panel");
  ["turnos","pagos","clientes","espera","notifs"].forEach(t=>canal.on("postgres_changes",{event:"*",schema:"public",table:t},onChange));
  canal.subscribe();
}

/* ---------- inicio ---------- */
async function iniciar(){
  ui=freshUI();
  const h=(location.hash||"").slice(1);
  const mm=h.match(/^mis-([0-9a-f-]{36})$/i);
  if(mm){guardarToken(mm[1]);ui.ctab="mis";history.replaceState(null,"",location.pathname);}
  try{
    const {data}=await sb.auth.getSession();ui.sesion=data.session;
    if(ui.sesion)await cargarYo();
    if(h==="centro"){ui.mode="pro";await loadCatalogo(true).catch(()=>loadCatalogo(false));if(ui.yo){try{await loadStaff();ui.cargado=true;}catch(e){ui.errorCarga=errMsg(e);}suscribir();}}
    else await loadPublico();
  }catch(e){
    document.getElementById("app").innerHTML=`<div class="panel stack" style="max-width:480px;margin:40px auto"><h2>No pudimos cargar los turnos</h2><p class="muted">${esc(errMsg(e))}</p><button class="btn pri" onclick="location.reload()">Reintentar</button></div>`;
    return;
  }
  render();
  window.addEventListener("hashchange",()=>{if(location.hash==="#centro"&&ui.mode!=="pro"){A.mode("pro").then(render);}});
  setInterval(()=>{if(ui.mode==="cliente"&&!document.hidden)loadOcupados().then(()=>{const a=document.activeElement;if(!(a&&a.matches("input,select,textarea")))render();}).catch(()=>{});},60000);
}
iniciar();
window.__qrListo=()=>{if(ui&&ui.mode==="pro"&&ui.ptab==="whatsapp")render();};
})();
