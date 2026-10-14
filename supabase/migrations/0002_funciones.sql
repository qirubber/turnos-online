-- Turnos Online · lógica de negocio en el servidor

-- ---------- utilidades ----------
create or replace function public._ahora() returns timestamp
language sql stable set search_path = '' as $$ select (now() at time zone 'America/Argentina/Buenos_Aires')::timestamp $$;
create or replace function public._hoy() returns date
language sql stable set search_path = '' as $$ select (now() at time zone 'America/Argentina/Buenos_Aires')::date $$;
create or replace function public._min(p text) returns int
language sql immutable set search_path = '' as $$ select split_part(p, ':', 1)::int * 60 + split_part(p, ':', 2)::int $$;
create or replace function public._mint(p time) returns int
language sql immutable set search_path = '' as $$ select extract(hour from p)::int * 60 + extract(minute from p)::int $$;
create or replace function public._tel(p text) returns text
language sql immutable set search_path = '' as $$
  select case when length(d) = 10 then '549' || d else d end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x
$$;
create or replace function public._money(p int) returns text
language sql immutable set search_path = '' as $$ select '$ ' || replace(to_char(coalesce(p, 0), 'FM999,999,999'), ',', '.') $$;
create or replace function public._ocupa(t public.turnos) returns boolean
language sql stable set search_path = '' as $$
  select t.estado in ('por_validar','confirmado','completado','ausente')
      or (t.estado = 'pendiente_pago' and t.hold_hasta > now())
$$;
create or replace function public._pagado(p_turno uuid) returns int
language sql stable security definer set search_path = '' as $$
  select coalesce(sum(monto), 0)::int from public.pagos where turno_id = p_turno
$$;

-- ¿El horario está libre para ese profesional? (horario, restricción del tratamiento, bloqueos, superposición y equipo)
create or replace function public._slot_ok(s public.servicios, p_prof uuid, p_fecha date, p_hora time, p_ignorar uuid, p_publico boolean)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  c public.config; pr public.profesionales; v_dow int := extract(dow from p_fecha)::int;
  v_ini int := public._mint(p_hora); v_fin int; v_finp int; v_ok boolean := false; r jsonb;
begin
  select * into c from public.config where id = 1;
  select * into pr from public.profesionales where id = p_prof;
  if not found or not pr.activo or not (p_prof = any (s.prof_ids)) then return false; end if;
  v_fin := v_ini + s.duracion;
  v_finp := v_fin + s.preparacion;
  if p_publico then
    if p_fecha < public._hoy() or p_fecha > public._hoy() + c.ventana then return false; end if;
    if (p_fecha + p_hora) < public._ahora() + make_interval(mins => c.anticipacion) then return false; end if;
  end if;
  if s.restringir then
    if not (v_dow = any (s.dias)) then return false; end if;
    if v_ini < public._mint(s.desde) or v_fin > public._mint(s.hasta) then return false; end if;
  end if;
  for r in select * from jsonb_array_elements(coalesce(pr.horario -> v_dow::text, '[]'::jsonb)) loop
    if v_ini >= public._min(r ->> 'desde') and v_fin <= public._min(r ->> 'hasta') then v_ok := true; end if;
  end loop;
  if not v_ok then return false; end if;
  if exists (select 1 from public.bloqueos b where b.fecha = p_fecha and (b.profesional_id is null or b.profesional_id = p_prof)
             and (b.desde is null or (v_ini < public._mint(b.hasta) and v_finp > public._mint(b.desde)))) then
    return false;
  end if;
  if exists (select 1 from public.turnos t where t.fecha = p_fecha and t.id is distinct from p_ignorar and public._ocupa(t)
             and (t.profesional_id = p_prof or (s.equipo <> '' and t.equipo = s.equipo))
             and v_ini < public._mint(t.hora) + t.duracion + t.preparacion and v_finp > public._mint(t.hora)) then
    return false;
  end if;
  return true;
end $$;

-- pasa lo pagado a saldo a favor y devuelve la sesión del paquete
create or replace function public._liberar(p_turno uuid, p_favor boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.turnos; v_p int;
begin
  if not p_favor then return; end if;
  select * into t from public.turnos where id = p_turno for update;
  v_p := public._pagado(t.id) - t.a_favor;
  if v_p > 0 then
    update public.clientes set credito = credito + v_p where id = t.cliente_id;
    update public.turnos set a_favor = a_favor + v_p where id = t.id;
  end if;
  if t.paquete_id is not null and not t.paquete_devuelto then
    update public.paquetes set usadas = greatest(0, usadas - 1) where id = t.paquete_id;
    update public.turnos set paquete_devuelto = true where id = t.id;
  end if;
end $$;

create or replace function public._revertir(p_turno uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.turnos;
begin
  select * into t from public.turnos where id = p_turno for update;
  if t.a_favor > 0 then
    update public.clientes set credito = greatest(0, credito - t.a_favor) where id = t.cliente_id;
    update public.turnos set a_favor = 0 where id = t.id;
  end if;
  if t.paquete_devuelto then
    update public.paquetes set usadas = usadas + 1 where id = t.paquete_id;
    update public.turnos set paquete_devuelto = false where id = t.id;
  end if;
end $$;

create or replace function public._aviso_espera(p_fecha date, p_servicio uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  select count(*) into n from public.espera where fecha = p_fecha and servicio_id = p_servicio;
  if n > 0 then
    insert into public.notifs (texto) values (format('Se liberó un horario el %s: hay %s %s en lista de espera para ese tratamiento.',
      to_char(p_fecha, 'DD/MM'), n, case when n = 1 then 'persona' else 'personas' end));
  end if;
end $$;

create or replace function public._turno_json(t public.turnos) returns jsonb
language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'id', t.id, 'servicio_id', t.servicio_id, 'servicio_nombre', t.servicio_nombre, 'profesional_id', t.profesional_id,
    'duracion', t.duracion, 'precio', t.precio, 'sena_monto', t.sena_monto, 'fecha', t.fecha, 'hora', to_char(t.hora, 'HH24:MI'),
    'estado', case when t.estado = 'pendiente_pago' and t.hold_hasta <= now() then 'vencido' else t.estado end,
    'hold_hasta', t.hold_hasta, 'pagado', public._pagado(t.id), 'a_favor', t.a_favor,
    'paquete_id', t.paquete_id, 'paquete_sesion', t.paquete_sesion, 'comprobante', t.comprobante_path is not null, 'medio', t.medio)
$$;

-- turno al que tiene acceso un token (del cliente o del propio turno)
create or replace function public._turno_de(p_token uuid, p_turno uuid) returns public.turnos
language plpgsql security definer set search_path = '' as $$
declare t public.turnos;
begin
  select tu.* into t from public.turnos tu join public.clientes c on c.id = tu.cliente_id
  where tu.id = p_turno and (c.token = p_token or tu.token = p_token) for update of tu;
  if not found then raise exception 'No encontramos ese turno' using errcode = 'P0002'; end if;
  return t;
end $$;

-- ---------- público: disponibilidad ----------
create or replace function public.ocupados(p_desde date, p_hasta date)
returns table (fecha date, hora text, fin int, profesional_id uuid, equipo text)
language sql stable security definer set search_path = '' as $$
  select t.fecha, to_char(t.hora, 'HH24:MI'), public._mint(t.hora) + t.duracion + t.preparacion, t.profesional_id, t.equipo
  from public.turnos t
  where t.fecha between p_desde and least(p_hasta, p_desde + 120) and public._ocupa(t)
$$;

-- ---------- público: reservar ----------


-- ---------- público: mis turnos ----------
create or replace function public.mis_datos(p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare cli public.clientes; t public.turnos;
begin
  select * into cli from public.clientes where token = p_token;
  if found then
    return jsonb_build_object('tipo', 'cliente',
      'cliente', jsonb_build_object('nombre', cli.nombre, 'tel', cli.tel, 'credito', cli.credito),
      'turnos', coalesce((select jsonb_agg(public._turno_json(x) order by x.fecha desc, x.hora desc) from public.turnos x where x.cliente_id = cli.id), '[]'::jsonb),
      'paquetes', coalesce((select jsonb_agg(jsonb_build_object('id', k.id, 'servicio_id', k.servicio_id, 'nombre', k.nombre, 'total', k.total, 'usadas', k.usadas, 'fecha', (k.created_at at time zone 'America/Argentina/Buenos_Aires')::date)) from public.paquetes k where k.cliente_id = cli.id), '[]'::jsonb),
      'espera', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'servicio_id', e.servicio_id, 'profesional_id', e.profesional_id, 'fecha', e.fecha, 'franja', e.franja)) from public.espera e where e.cliente_id = cli.id and e.fecha >= public._hoy()), '[]'::jsonb));
  end if;
  select * into t from public.turnos where token = p_token;
  if found then
    select * into cli from public.clientes where id = t.cliente_id;
    return jsonb_build_object('tipo', 'turno', 'cliente', jsonb_build_object('nombre', cli.nombre, 'tel', cli.tel, 'credito', 0),
      'turnos', jsonb_build_array(public._turno_json(t)), 'paquetes', '[]'::jsonb, 'espera', '[]'::jsonb);
  end if;
  return null;
end $$;

create or replace function public.cancelar_turno(p_token uuid, p_turno uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.turnos; c public.config; v_min numeric; v_fav boolean; cli public.clientes;
begin
  t := public._turno_de(p_token, p_turno);
  select * into c from public.config where id = 1;
  if not public._ocupa(t) or t.estado not in ('confirmado','pendiente_pago','por_validar') then raise exception 'Este turno ya no está activo'; end if;
  v_min := extract(epoch from ((t.fecha + t.hora) - public._ahora())) / 60;
  if v_min < c.cancel_min then raise exception 'Faltan menos de % minutos para el turno: escribile al centro para cancelarlo', c.cancel_min; end if;
  v_fav := v_min >= c.sena_horas * 60 or c.politica = 'favor';
  update public.turnos set estado = 'cancelado' where id = t.id;
  perform public._liberar(t.id, v_fav);
  select * into t from public.turnos where id = t.id;
  select * into cli from public.clientes where id = t.cliente_id;
  insert into public.notifs (texto, turno_id) values (format('%s canceló su turno de %s (%s %s).%s', cli.nombre, t.servicio_nombre,
    to_char(t.fecha, 'DD/MM'), to_char(t.hora, 'HH24:MI'),
    case when t.a_favor > 0 then ' Quedó ' || public._money(t.a_favor) || ' a favor.'
         when public._pagado(t.id) > 0 then ' La seña se retuvo.' else '' end), t.id);
  perform public._aviso_espera(t.fecha, t.servicio_id);
  return jsonb_build_object('a_favor', t.a_favor, 'retenido', public._pagado(t.id) - t.a_favor);
end $$;

create or replace function public.reprogramar_turno(p_token uuid, p_turno uuid, p_fecha date, p_hora time, p_profesional uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.turnos; c public.config; s public.servicios; v_pro uuid; p uuid; v_antes text; cli public.clientes;
begin
  t := public._turno_de(p_token, p_turno);
  select * into c from public.config where id = 1;
  if not public._ocupa(t) or t.estado not in ('confirmado','pendiente_pago','por_validar') then raise exception 'Este turno ya no está activo'; end if;
  if extract(epoch from ((t.fecha + t.hora) - public._ahora())) / 60 < c.cancel_min then
    raise exception 'Faltan menos de % minutos para el turno: escribile al centro para cambiarlo', c.cancel_min;
  end if;
  select * into s from public.servicios where id = t.servicio_id;
  if not found then raise exception 'Este tratamiento ya no se ofrece; escribile al centro'; end if;
  perform pg_advisory_xact_lock(hashtext('turnos:' || p_fecha::text));
  if p_profesional is not null then
    if public._slot_ok(s, p_profesional, p_fecha, p_hora, t.id, true) then v_pro := p_profesional; end if;
  else
    if t.profesional_id is not null and public._slot_ok(s, t.profesional_id, p_fecha, p_hora, t.id, true) then v_pro := t.profesional_id; end if;
    if v_pro is null then
      foreach p in array s.prof_ids loop
        if v_pro is null and public._slot_ok(s, p, p_fecha, p_hora, t.id, true) then v_pro := p; end if;
      end loop;
    end if;
  end if;
  if v_pro is null then raise exception 'Ese horario se acaba de ocupar. Elegí otro.'; end if;
  v_antes := to_char(t.fecha, 'DD/MM') || ' ' || to_char(t.hora, 'HH24:MI');
  update public.turnos set fecha = p_fecha, hora = p_hora, profesional_id = v_pro, recordado = false where id = t.id;
  select * into cli from public.clientes where id = t.cliente_id;
  insert into public.notifs (texto, turno_id) values (format('%s reprogramó %s: de %s a %s %s con %s.', cli.nombre, t.servicio_nombre, v_antes,
    to_char(p_fecha, 'DD/MM'), to_char(p_hora, 'HH24:MI'), (select nombre from public.profesionales where id = v_pro)), t.id);
  perform public._aviso_espera(t.fecha, t.servicio_id);
  return jsonb_build_object('ok', true, 'profesional_id', v_pro);
end $$;

create or replace function public.registrar_comprobante(p_token uuid, p_turno uuid, p_path text, p_nombre text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare t public.turnos; cli public.clientes;
begin
  t := public._turno_de(p_token, p_turno);
  if t.estado <> 'pendiente_pago' or t.hold_hasta <= now() then raise exception 'La reserva ya no está esperando la seña'; end if;
  if split_part(coalesce(p_path, ''), '/', 1) <> t.id::text then raise exception 'Archivo inválido'; end if;
  if not exists (select 1 from storage.objects o where o.bucket_id = 'comprobantes' and o.name = p_path) then
    raise exception 'No encontramos el archivo. Volvé a adjuntarlo.';
  end if;
  update public.turnos set estado = 'por_validar', hold_hasta = null, comprobante_path = p_path,
    comprobante_nombre = left(coalesce(p_nombre, 'comprobante'), 120), comprobante_subido = now() where id = t.id;
  select * into cli from public.clientes where id = t.cliente_id;
  insert into public.notifs (texto, turno_id) values (format('%s envió el comprobante de la seña (%s, %s %s).', cli.nombre, t.servicio_nombre,
    to_char(t.fecha, 'DD/MM'), to_char(t.hora, 'HH24:MI')), t.id);
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.anotar_espera(p_servicio uuid, p_profesional uuid, p_fecha date, p_franja text, p_nombre text, p_tel text, p_token uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.config; s public.servicios; cli public.clientes; e public.espera; v_tel text := public._tel(p_tel); v_nuevo boolean := false;
begin
  select * into c from public.config where id = 1;
  select * into s from public.servicios where id = p_servicio and activo;
  if not found then raise exception 'El tratamiento no está disponible'; end if;
  if length(trim(coalesce(p_nombre, ''))) < 3 then raise exception 'Escribí tu nombre y apellido'; end if;
  if length(v_tel) < 10 then raise exception 'Revisá el número de WhatsApp'; end if;
  if p_fecha < public._hoy() or p_fecha > public._hoy() + c.ventana then raise exception 'Elegí un día dentro de los próximos % días', c.ventana; end if;
  if coalesce(p_franja, '') not in ('', 'manana', 'siesta', 'tarde', 'noche') then raise exception 'Franja inválida'; end if;
  select * into cli from public.clientes where tel = v_tel;
  if not found then
    insert into public.clientes (nombre, tel) values (trim(p_nombre), v_tel) returning * into cli;
    v_nuevo := true;
  end if;
  if (select count(*) from public.espera where cliente_id = cli.id and fecha >= public._hoy()) >= 5 then
    raise exception 'Ya estás anotado en varias listas de espera';
  end if;
  insert into public.espera (cliente_id, servicio_id, profesional_id, fecha, franja)
  values (cli.id, s.id, p_profesional, p_fecha, coalesce(p_franja, '')) returning * into e;
  insert into public.notifs (texto) values (format('%s se anotó en lista de espera: %s, %s.', cli.nombre, s.nombre, to_char(p_fecha, 'DD/MM')));
  return jsonb_build_object('espera_id', e.id, 'token', case when v_nuevo or cli.token = p_token then cli.token else e.token end);
end $$;



-- ---------- vencimiento automático de reservas sin seña ----------


-- ---------- personal del centro ----------
create or replace function public._staff_turno(p_turno uuid) returns public.turnos
language plpgsql security definer set search_path = '' as $$
declare t public.turnos;
begin
  if not public.es_staff() then raise exception 'Necesitás ingresar como personal del centro' using errcode = '42501'; end if;
  select * into t from public.turnos where id = p_turno for update;
  if not found then raise exception 'No encontramos ese turno'; end if;
  if not public.es_admin() and t.profesional_id is distinct from public.mi_prof() then
    raise exception 'Ese turno es de otro profesional' using errcode = '42501';
  end if;
  return t;
end $$;

create or replace function public.staff_estado(p_turno uuid, p_estado text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.turnos; c public.config;
begin
  t := public._staff_turno(p_turno);
  if p_estado not in ('confirmado','completado','ausente') then raise exception 'Estado inválido'; end if;
  select * into c from public.config where id = 1;
  if t.estado = 'ausente' and p_estado <> 'ausente' then perform public._revertir(t.id); end if;
  update public.turnos set estado = p_estado where id = t.id;
  if p_estado = 'ausente' and t.estado <> 'ausente' and c.politica = 'favor' then perform public._liberar(t.id, true); end if;
end $$;

create or replace function public.staff_cancelar(p_turno uuid, p_favor boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare t public.turnos;
begin
  t := public._staff_turno(p_turno);
  if t.estado not in ('confirmado','pendiente_pago','por_validar') then raise exception 'Este turno ya no está activo'; end if;
  update public.turnos set estado = 'cancelado', hold_hasta = null where id = t.id;
  perform public._liberar(t.id, p_favor);
  perform public._aviso_espera(t.fecha, t.servicio_id);
  return jsonb_build_object('a_favor', (select a_favor from public.turnos where id = t.id));
end $$;

create or replace function public.staff_confirmar_sena(p_turno uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.turnos;
begin
  t := public._staff_turno(p_turno);
  if t.estado not in ('pendiente_pago','por_validar','vencido') then raise exception 'Este turno no está esperando seña'; end if;
  if t.estado = 'vencido' and exists (select 1 from public.turnos x where x.id <> t.id and x.fecha = t.fecha and public._ocupa(x)
      and (x.profesional_id = t.profesional_id or (t.equipo <> '' and x.equipo = t.equipo))
      and public._mint(t.hora) < public._mint(x.hora) + x.duracion + x.preparacion and public._mint(t.hora) + t.duracion + t.preparacion > public._mint(x.hora)) then
    raise exception 'La reserva venció y ese horario ya lo tomó otra persona';
  end if;
  if t.sena_monto > 0 then
    insert into public.pagos (turno_id, monto, medio, tipo)
    values (t.id, t.sena_monto, 'Transferencia', case when t.sena_monto >= t.precio then 'Pago total' else 'Seña' end);
  end if;
  update public.turnos set estado = 'confirmado', hold_hasta = null where id = t.id;
end $$;

create or replace function public.staff_reintento(p_turno uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.turnos; c public.config;
begin
  t := public._staff_turno(p_turno);
  select * into c from public.config where id = 1;
  if t.estado <> 'por_validar' then raise exception 'Este turno no tiene un comprobante para revisar'; end if;
  update public.turnos set estado = 'pendiente_pago', comprobante_path = null, comprobante_nombre = null, comprobante_subido = null,
    hold_hasta = now() + make_interval(hours => c.hold_horas) where id = t.id;
end $$;

create or replace function public.staff_extender(p_turno uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.turnos; c public.config;
begin
  t := public._staff_turno(p_turno);
  select * into c from public.config where id = 1;
  if t.estado <> 'pendiente_pago' then raise exception 'Este turno no está esperando seña'; end if;
  update public.turnos set hold_hasta = greatest(hold_hasta, now()) + make_interval(hours => c.hold_horas) where id = t.id;
end $$;

create or replace function public.staff_mover(p_turno uuid, p_fecha date, p_hora time) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.turnos; s public.servicios;
begin
  t := public._staff_turno(p_turno);
  if t.estado not in ('confirmado','pendiente_pago','por_validar') then raise exception 'Este turno ya no está activo'; end if;
  select * into s from public.servicios where id = t.servicio_id;
  if not found then raise exception 'El tratamiento ya no existe'; end if;
  perform pg_advisory_xact_lock(hashtext('turnos:' || p_fecha::text));
  if not public._slot_ok(s, t.profesional_id, p_fecha, p_hora, t.id, false) then raise exception 'Ese horario no está libre'; end if;
  update public.turnos set fecha = p_fecha, hora = p_hora, recordado = false where id = t.id;
  insert into public.notifs (texto, turno_id) values (format('Turno de %s movido de %s %s a %s %s.',
    (select nombre from public.clientes where id = t.cliente_id), to_char(t.fecha, 'DD/MM'), to_char(t.hora, 'HH24:MI'),
    to_char(p_fecha, 'DD/MM'), to_char(p_hora, 'HH24:MI')), t.id);
  perform public._aviso_espera(t.fecha, t.servicio_id);
end $$;

create or replace function public.staff_pago(p_turno uuid, p_monto int, p_medio text) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.turnos; v int := p_monto; cli public.clientes;
begin
  t := public._staff_turno(p_turno);
  if v is null or v <= 0 then raise exception 'Ingresá un monto mayor a cero'; end if;
  if p_medio not in ('Efectivo','Transferencia','Mercado Pago','Débito','Crédito','Saldo a favor') then raise exception 'Medio inválido'; end if;
  if p_medio = 'Saldo a favor' then
    select * into cli from public.clientes where id = t.cliente_id for update;
    v := least(v, cli.credito);
    if v <= 0 then raise exception 'El cliente no tiene saldo a favor'; end if;
    update public.clientes set credito = credito - v where id = cli.id;
  end if;
  insert into public.pagos (turno_id, monto, medio, tipo) values (t.id, v, p_medio,
    case when p_medio = 'Saldo a favor' then 'Saldo a favor' when v >= t.precio - public._pagado(t.id) then 'Saldo' else 'Pago parcial' end);
end $$;

create or replace function public.staff_recordado(p_turno uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.turnos;
begin
  t := public._staff_turno(p_turno);
  update public.turnos set recordado = true where id = t.id;
end $$;

create or replace function public.staff_crear_turno(
  p_cliente uuid, p_nombre text, p_tel text, p_servicio uuid, p_profesional uuid, p_fecha date, p_hora time,
  p_pago text, p_medio text, p_sobreturno boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.servicios; cli public.clientes; t public.turnos; pk public.paquetes; v_sena int; v_tel text;
begin
  if not public.es_staff() then raise exception 'Necesitás ingresar como personal del centro' using errcode = '42501'; end if;
  if not public.es_admin() and p_profesional is distinct from public.mi_prof() then raise exception 'Solo podés cargar turnos en tu agenda'; end if;
  select * into s from public.servicios where id = p_servicio;
  if not found then raise exception 'Elegí el tratamiento'; end if;
  if p_cliente is not null then
    select * into cli from public.clientes where id = p_cliente;
    if not found then raise exception 'No encontramos el cliente'; end if;
  else
    v_tel := public._tel(p_tel);
    if length(trim(coalesce(p_nombre, ''))) < 3 or length(v_tel) < 10 then raise exception 'Completá nombre y WhatsApp del cliente'; end if;
    select * into cli from public.clientes where tel = v_tel;
    if not found then insert into public.clientes (nombre, tel) values (trim(p_nombre), v_tel) returning * into cli; end if;
  end if;
  perform pg_advisory_xact_lock(hashtext('turnos:' || p_fecha::text));
  if not coalesce(p_sobreturno, false) and not public._slot_ok(s, p_profesional, p_fecha, p_hora, null, false) then
    raise exception 'Ese horario ya no está libre';
  end if;
  v_sena := round(s.precio * s.sena / 100.0);
  insert into public.turnos (cliente_id, servicio_id, servicio_nombre, profesional_id, equipo, duracion, preparacion, precio, sena_monto,
                             fecha, hora, estado, medio, origen)
  values (cli.id, s.id, s.nombre, p_profesional, s.equipo, s.duracion, s.preparacion, s.precio, v_sena, p_fecha, p_hora, 'confirmado', 'panel', 'panel')
  returning * into t;
  if p_pago = 'sena' and v_sena > 0 then insert into public.pagos (turno_id, monto, medio, tipo) values (t.id, v_sena, p_medio, 'Seña'); end if;
  if p_pago = 'total' and s.precio > 0 then insert into public.pagos (turno_id, monto, medio, tipo) values (t.id, s.precio, p_medio, 'Pago total'); end if;
  if p_pago = 'pack' then
    select * into pk from public.paquetes where cliente_id = cli.id and servicio_id = s.id and usadas < total order by created_at limit 1 for update;
    if not found then raise exception 'El cliente no tiene sesiones disponibles de un paquete'; end if;
    update public.paquetes set usadas = usadas + 1 where id = pk.id;
    update public.turnos set paquete_id = pk.id, paquete_sesion = pk.usadas + 1, precio = 0, sena_monto = 0 where id = t.id;
  end if;
  return t.id;
end $$;

create or replace function public.staff_vender_paquete(p_cliente uuid, p_servicio uuid, p_sesiones int, p_precio int, p_medio text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare s public.servicios; k public.paquetes;
begin
  if not public.es_admin() then raise exception 'Solo la administración puede vender paquetes' using errcode = '42501'; end if;
  select * into s from public.servicios where id = p_servicio;
  if not found then raise exception 'Elegí el tratamiento'; end if;
  if coalesce(p_sesiones, 0) < 2 then raise exception 'El paquete tiene que tener al menos 2 sesiones'; end if;
  if coalesce(p_precio, 0) <= 0 then raise exception 'Ingresá el precio total del paquete'; end if;
  insert into public.paquetes (cliente_id, servicio_id, nombre, total) values (p_cliente, s.id, s.nombre, p_sesiones) returning * into k;
  insert into public.ventas (cliente_id, paquete_id, concepto, monto, medio)
  values (p_cliente, k.id, format('Paquete %s sesiones · %s', p_sesiones, s.nombre), p_precio, p_medio);
  return k.id;
end $$;

-- link firmado para ver un comprobante (solo personal)
create or replace function public.puede_ver_comprobante(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.es_admin() or exists (select 1 from public.turnos t where t.comprobante_path = p_path and t.profesional_id = public.mi_prof())
$$;

