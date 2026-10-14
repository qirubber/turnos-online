// Simulador mínimo de supabase-js para probar la interfaz sin red (solo pruebas locales).
(function(){
  const uid=()=>"xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g,()=>(Math.random()*16|0).toString(16));
  const hoy=new Date();const ymd=d=>d.toISOString().slice(0,10);
  const H=(a)=>{const o={};for(let i=0;i<7;i++)o[i]=a[i]||[];return o;};
  const lv=[{desde:"09:00",hasta:"13:00"},{desde:"15:00",hasta:"19:00"}];
  const P1=uid(),P2=uid(),P3=uid();
  const DB={
    config:[{id:1,negocio:"Centro Estética Palermo",whatsapp:"5491155550000",alias:"ESTETICA.PALERMO.MP",cbu:"0000003100012345678901",titular:"Lucía Ferrer",banco:"Mercado Pago",mp_activo:false,mp_link:"",exigir_sena:true,cancel_min:30,sena_horas:24,politica:"pierde",ventana:30,anticipacion:60,hold_horas:2,intervalo:30,recordatorio_horas:24,mensaje:"Hola {nombre}! Turno {servicio} {fecha} {hora}",mensaje_confirmacion:"Hola {nombre}! Seña recibida."}],
    profesionales:[
      {id:P1,nombre:"Lucía Ferrer",rol:"Cosmetóloga",tel:"5491155550001",color:1,activo:true,orden:1,horario:H({1:lv,2:lv,3:lv,4:lv,5:lv,6:[{desde:"09:00",hasta:"13:00"}]})},
      {id:P2,nombre:"Paula Sosa",rol:"Masoterapeuta",tel:"",color:2,activo:true,orden:2,horario:H({1:[{desde:"12:00",hasta:"21:00"}],2:[{desde:"12:00",hasta:"20:00"}],3:[{desde:"12:00",hasta:"21:00"}],4:[{desde:"12:00",hasta:"20:00"}],5:[{desde:"12:00",hasta:"21:00"}],6:[{desde:"12:00",hasta:"20:00"}]})},
      {id:P3,nombre:"Valeria Paz",rol:"Técnica en láser",tel:"",color:3,activo:true,orden:3,horario:H({2:[{desde:"14:00",hasta:"20:00"}],4:[{desde:"14:00",hasta:"20:00"}],6:[{desde:"09:00",hasta:"13:00"}]})}],
    servicios:[
      {id:uid(),categoria:"Depilación láser",nombre:"Láser axilas",descripcion:"Zona chica.",duracion:20,preparacion:10,precio:15000,sena:30,activo:true,prof_ids:[P1,P3],equipo:"Láser diodo",restringir:true,dias:[2,4,6],desde:"09:00:00",hasta:"20:00:00",orden:1},
      {id:uid(),categoria:"Masajes",nombre:"Masaje descontracturante",descripcion:"Espalda.",duracion:60,preparacion:15,precio:25000,sena:30,activo:true,prof_ids:[P2],equipo:"",restringir:false,dias:[1,2,3,4,5,6],desde:"09:00:00",hasta:"20:00:00",orden:2},
      {id:uid(),categoria:"Faciales",nombre:"Limpieza facial profunda",descripcion:"Extracción.",duracion:60,preparacion:10,precio:28000,sena:30,activo:true,prof_ids:[P1],equipo:"",restringir:false,dias:[1,2,3,4,5,6],desde:"09:00:00",hasta:"20:00:00",orden:3}],
    bloqueos:[],clientes:[],turnos:[],pagos:[],paquetes:[],ventas:[],espera:[],notifs:[],staff:[]
  };
  if(window.__MP)DB.config[0].mp_link=window.__MP;
  if(window.__MSG)DB.config[0].mensaje=window.__MSG;
  if(window.__UNA)DB.profesionales.slice(1).forEach(x=>x.activo=false);
  window.__DB=DB;
  let session=null;
  function Q(table){
    let rows=null,op="select",payload=null,filters=[],single=false,maybe=false,sel=false;
    const api={
      select(){sel=true;return api;},eq(k,v){filters.push(r=>r[k]===v);return api;},gte(k,v){filters.push(r=>r[k]>=v);return api;},
      in(k,v){filters.push(r=>v.includes(r[k]));return api;},order(){return api;},limit(){return api;},range(){return api;},
      single(){single=true;return api;},maybeSingle(){maybe=true;return api;},
      update(p){op="update";payload=p;return api;},insert(p){op="insert";payload=p;return api;},delete(){op="delete";return api;},
      then(res,rej){
        return new Promise(done=>{
        try{
          const T=DB[table];let data;
          if(op==="insert"){const arr=(Array.isArray(payload)?payload:[payload]).map(x=>Object.assign({id:uid(),created_at:new Date().toISOString()},x));arr.forEach(r=>T.push(r));data=Array.isArray(payload)?arr:(sel||single?arr[0]:null);}
          else{
            let m=T.filter(r=>filters.every(f=>f(r)));
            if(op==="update"){m.forEach(r=>Object.assign(r,payload));data=null;}
            else if(op==="delete"){DB[table]=T.filter(r=>!m.includes(r));data=null;}
            else data=single||maybe?(m[0]||null):JSON.parse(JSON.stringify(m));
          }
          done({data,error:null});
        }catch(e){done({data:null,error:{message:e.message}});}
        }).then(res,rej);
      }
    };
    return api;
  }
  const ocupa=t=>["por_validar","confirmado","completado","ausente"].includes(t.estado)||(t.estado==="pendiente_pago"&&Date.parse(t.hold_hasta)>Date.now());
  const pag=id=>DB.pagos.filter(p=>p.turno_id===id).reduce((a,p)=>a+p.monto,0);
  const tj=t=>({id:t.id,servicio_id:t.servicio_id,servicio_nombre:t.servicio_nombre,profesional_id:t.profesional_id,duracion:t.duracion,precio:t.precio,sena_monto:t.sena_monto,fecha:t.fecha,hora:t.hora.slice(0,5),estado:t.estado,hold_hasta:t.hold_hasta,pagado:pag(t.id),a_favor:t.a_favor||0,paquete_id:t.paquete_id||null,paquete_sesion:null,comprobante:!!t.comprobante_path,medio:t.medio});
  const err=m=>({data:null,error:{message:m}});
  const R={
    ocupados:a=>({data:DB.turnos.filter(t=>ocupa(t)&&t.fecha>=a.p_desde&&t.fecha<=a.p_hasta).map(t=>({fecha:t.fecha,hora:t.hora.slice(0,5),fin:(+t.hora.slice(0,2))*60+(+t.hora.slice(3,5))+t.duracion+t.preparacion,profesional_id:t.profesional_id,equipo:t.equipo})),error:null}),
    reservar:a=>{
      const s=DB.servicios.find(x=>x.id===a.p_servicio);if(!s)return err("El tratamiento no está disponible");
      const tel=a.p_tel.replace(/\D/g,"");const t10=tel.length===10?"549"+tel:tel;
      let c=DB.clientes.find(x=>x.tel===t10),nuevo=false;
      if(!c){c={id:uid(),nombre:a.p_nombre,tel:t10,email:a.p_email||"",notas:"",credito:0,token:uid(),created_at:new Date().toISOString()};DB.clientes.push(c);nuevo=true;}
      if(DB.turnos.some(t=>t.fecha===a.p_fecha&&t.hora.slice(0,5)===a.p_hora&&ocupa(t)&&t.profesional_id===(a.p_profesional||s.prof_ids[0])))return err("Ese horario se acaba de ocupar. Elegí otro.");
      const sena=Math.round(s.precio*s.sena/100);
      const t={id:uid(),cliente_id:c.id,servicio_id:s.id,servicio_nombre:s.nombre,profesional_id:a.p_profesional||s.prof_ids[0],equipo:s.equipo,duracion:s.duracion,preparacion:s.preparacion,precio:s.precio,sena_monto:a.p_monto==="total"?s.precio:sena,fecha:a.p_fecha,hora:a.p_hora+":00",estado:a.p_medio==="transferencia"?"pendiente_pago":"confirmado",hold_hasta:a.p_medio==="transferencia"?new Date(Date.now()+7200000).toISOString():null,medio:a.p_medio,origen:"web",recordado:false,a_favor:0,token:uid(),created_at:new Date().toISOString()};
      DB.turnos.push(t);DB.notifs.push({id:uid(),texto:"Nueva reserva: "+c.nombre,leida:false,created_at:new Date().toISOString()});
      return {data:{turno_id:t.id,token:nuevo||a.p_token===c.token?c.token:t.token,tipo:nuevo?"cliente":"turno"},error:null};
    },
    mis_datos:a=>{
      const c=DB.clientes.find(x=>x.token===a.p_token);
      if(c)return {data:{tipo:"cliente",cliente:{nombre:c.nombre,tel:c.tel,credito:c.credito},turnos:DB.turnos.filter(t=>t.cliente_id===c.id).map(tj),paquetes:[],espera:DB.espera.filter(e=>e.cliente_id===c.id).map(e=>({id:e.id,servicio_id:e.servicio_id,profesional_id:e.profesional_id,fecha:e.fecha,franja:e.franja}))},error:null};
      const t=DB.turnos.find(x=>x.token===a.p_token);if(!t)return {data:null,error:null};
      const c2=DB.clientes.find(x=>x.id===t.cliente_id);
      return {data:{tipo:"turno",cliente:{nombre:c2.nombre,tel:c2.tel,credito:0},turnos:[tj(t)],paquetes:[],espera:[]},error:null};
    },
    cancelar_turno:a=>{const t=DB.turnos.find(x=>x.id===a.p_turno);t.estado="cancelado";return {data:{a_favor:0},error:null};},
    reprogramar_turno:a=>{const t=DB.turnos.find(x=>x.id===a.p_turno);t.fecha=a.p_fecha;t.hora=a.p_hora+":00";return {data:{ok:true},error:null};},
    registrar_comprobante:a=>{const t=DB.turnos.find(x=>x.id===a.p_turno);t.estado="por_validar";t.hold_hasta=null;t.comprobante_path=a.p_path;t.comprobante_nombre=a.p_nombre;t.comprobante_subido=new Date().toISOString();return {data:{ok:true},error:null};},
    anotar_espera:a=>{const tel=a.p_tel.replace(/\D/g,"");const t10=tel.length===10?"549"+tel:tel;let c=DB.clientes.find(x=>x.tel===t10);if(!c){c={id:uid(),nombre:a.p_nombre,tel:t10,email:"",notas:"",credito:0,token:uid(),created_at:new Date().toISOString()};DB.clientes.push(c);}const e={id:uid(),cliente_id:c.id,servicio_id:a.p_servicio,profesional_id:a.p_profesional,fecha:a.p_fecha,franja:a.p_franja,token:uid(),created_at:new Date().toISOString()};DB.espera.push(e);return {data:{espera_id:e.id,token:c.token},error:null};},
    quitar_espera:a=>{DB.espera=DB.espera.filter(e=>e.id!==a.p_id);return {data:{ok:true},error:null};},
    staff_confirmar_sena:a=>{const t=DB.turnos.find(x=>x.id===a.p_turno);DB.pagos.push({id:uid(),turno_id:t.id,monto:t.sena_monto,medio:"Transferencia",tipo:"Seña",fecha:ymd(new Date()),created_at:new Date().toISOString()});t.estado="confirmado";return {data:null,error:null};},
    staff_estado:a=>{DB.turnos.find(x=>x.id===a.p_turno).estado=a.p_estado;return {data:null,error:null};},
    staff_cancelar:a=>{DB.turnos.find(x=>x.id===a.p_turno).estado="cancelado";return {data:{a_favor:0},error:null};},
    staff_pago:a=>{DB.pagos.push({id:uid(),turno_id:a.p_turno,monto:a.p_monto,medio:a.p_medio,tipo:"Saldo",fecha:ymd(new Date()),created_at:new Date().toISOString()});return {data:null,error:null};},
    staff_recordado:a=>{DB.turnos.find(x=>x.id===a.p_turno).recordado=true;return {data:null,error:null};},
    staff_mover:a=>{const t=DB.turnos.find(x=>x.id===a.p_turno);t.fecha=a.p_fecha;t.hora=a.p_hora+":00";return {data:null,error:null};},
    staff_extender:()=>({data:null,error:null}),staff_reintento:()=>({data:null,error:null}),
    staff_crear_turno:a=>{const s=DB.servicios.find(x=>x.id===a.p_servicio);let c=a.p_cliente?DB.clientes.find(x=>x.id===a.p_cliente):null;if(!c){c={id:uid(),nombre:a.p_nombre,tel:"549"+a.p_tel.replace(/\D/g,"").slice(-10),email:"",notas:"",credito:0,token:uid(),created_at:new Date().toISOString()};DB.clientes.push(c);}
      const t={id:uid(),cliente_id:c.id,servicio_id:s.id,servicio_nombre:s.nombre,profesional_id:a.p_profesional,equipo:s.equipo,duracion:s.duracion,preparacion:s.preparacion,precio:s.precio,sena_monto:0,fecha:a.p_fecha,hora:a.p_hora+":00",estado:"confirmado",medio:"panel",origen:"panel",recordado:false,a_favor:0,token:uid(),created_at:new Date().toISOString()};DB.turnos.push(t);return {data:t.id,error:null};},
    admin_reiniciar:a=>{if(a.p_confirmacion!=="BORRAR")return err("Escribí BORRAR para confirmar");const r={turnos:DB.turnos.length,clientes:DB.clientes.length,catalogo:a.p_catalogo};["notifs","espera","pagos","ventas","turnos","paquetes","clientes"].forEach(k=>DB[k]=[]);if(a.p_catalogo){DB.bloqueos=[];DB.servicios=[];DB.profesionales=[];}return {data:r,error:null};},
    staff_vender_paquete:a=>{const s=DB.servicios.find(x=>x.id===a.p_servicio);const k={id:uid(),cliente_id:a.p_cliente,servicio_id:s.id,nombre:s.nombre,total:a.p_sesiones,usadas:0,created_at:new Date().toISOString()};DB.paquetes.push(k);DB.ventas.push({id:uid(),cliente_id:a.p_cliente,concepto:"Paquete",monto:a.p_precio,medio:a.p_medio,fecha:ymd(new Date())});return {data:k.id,error:null};}
  };
  window.supabase={createClient(){return {
    from:Q,
    rpc(fn,args){return Promise.resolve(R[fn]?R[fn](args||{}):err("rpc desconocida "+fn));},
    auth:{getSession:async()=>({data:{session}}),signInWithPassword:async({email,password})=>{if(password!=="clave123")return {data:null,error:{message:"Invalid login credentials"}};const u={id:"admin-1",email};session={user:u};DB.staff=[{user_id:"admin-1",rol:"admin",profesional_id:null,nombre:"Admin"}];return {data:{session},error:null};},signOut:async()=>{session=null;}},
    storage:{from(){return {upload:async()=>({data:{},error:null}),remove:async()=>({data:[],error:null}),getPublicUrl:(p)=>({data:{publicUrl:"data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"}}),createSignedUrl:async()=>({data:{signedUrl:"data:image/gif;base64,R0lGODlhAQABAAAAACw="},error:null})};}},
    channel(){const c={on(){return c;},subscribe(){return c;}};return c;}
  };}};
})();
