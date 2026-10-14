-- Turnos Online · reservar, salir de la lista de espera y vencimiento automático (incluye borrados: requiere aprobación)

create or replace function public.reservar(
  p_servicio uuid, p_profesional uuid, p_fecha date, p_hora time,
  p_nombre text, p_tel text, p_email text, p_medio text, p_monto text, p_token uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  c public.config; s public.servicios; cli public.clientes; t public.turnos; pk public.paquetes;
  v_tel text := public._tel(p_tel); v_pro uuid; p uuid; v_sena int; v_monto int; v_amt int; v_extra text := '';
  v_nuevo boolean := false; v_identificado boolean := false;
begin
  if p_medio not in ('transferencia','local','pack','saldo') then raise exception 'Ese medio de pago no está disponible'; end if;
  select * into c from public.config where id = 1;
  select * into s from public.servicios where id = p_servicio and activo;
  if not found then raise exception 'El tratamiento no está disponible'; end if;
  if length(trim(coalesce(p_nombre, ''))) < 3 then raise exception 'Escribí tu nombre y apellido'; end if;
  if length(v_tel) < 10 then raise exception 'Revisá el número de WhatsApp'; end if;
  if p_medio = 'local' and c.exigir_sena then raise exception 'Este centro pide seña para confirmar el turno'; end if;

  perform pg_advisory_xact_lock(hashtext('turnos:' || p_fecha::text));
  if p_profesional is not null then
    if public._slot_ok(s, p_profesional, p_fecha, p_hora, null, true) then v_pro := p_profesional; end if;
  else
    foreach p in array s.prof_ids loop
      if v_pro is null and public._slot_ok(s, p, p_fecha, p_hora, null, true) then v_pro := p; end if;
    end loop;
  end if;
  if v_pro is null then raise exception 'Ese horario se acaba de ocupar. Elegí otro.'; end if;

  select * into cli from public.clientes where tel = v_tel for update;
  if not found then
    insert into public.clientes (nombre, tel, email) values (trim(p_nombre), v_tel, coalesce(trim(p_email), '')) returning * into cli;
    v_nuevo := true;
  else
    v_identificado := p_token is not null and cli.token = p_token;
    if v_identificado and coalesce(trim(p_email), '') <> '' then update public.clientes set email = trim(p_email) where id = cli.id; end if;
  end if;
  if p_medio in ('pack','saldo') and not (v_nuevo or v_identificado) then
    raise exception 'Para usar tu paquete o saldo a favor, entrá desde el link de "Mis turnos" que te dimos al reservar';
  end if;

  v_sena := round(s.precio * s.sena / 100.0);
  v_monto := case when p_monto = 'total' or s.sena >= 100 then s.precio else v_sena end;
  insert into public.turnos (cliente_id, servicio_id, servicio_nombre, profesional_id, equipo, duracion, preparacion, precio, sena_monto,
                             fecha, hora, estado, hold_hasta, medio, origen)
  values (cli.id, s.id, s.nombre, v_pro, s.equipo, s.duracion, s.preparacion, s.precio, v_monto, p_fecha, p_hora,
          case when p_medio = 'transferencia' then 'pendiente_pago' else 'confirmado' end,
          case when p_medio = 'transferencia' then now() + make_interval(hours => c.hold_horas) end, p_medio, 'web')
  returning * into t;

  if p_medio = 'pack' then
    select * into pk from public.paquetes where cliente_id = cli.id and servicio_id = s.id and usadas < total order by created_at limit 1 for update;
    if not found then raise exception 'No tenés sesiones disponibles de un paquete para este tratamiento'; end if;
    update public.paquetes set usadas = usadas + 1 where id = pk.id;
    update public.turnos set paquete_id = pk.id, paquete_sesion = pk.usadas + 1, precio = 0, sena_monto = 0 where id = t.id;
    v_extra := format(' Sesión %s de %s del paquete.', pk.usadas + 1, pk.total);
  elsif p_medio = 'saldo' then
    if cli.credito <= 0 or cli.credito < v_sena then raise exception 'Tu saldo a favor no alcanza para la seña'; end if;
    v_amt := least(cli.credito, s.precio);
    update public.clientes set credito = credito - v_amt where id = cli.id;
    insert into public.pagos (turno_id, monto, medio, tipo) values (t.id, v_amt, 'Saldo a favor', 'Saldo a favor');
    v_extra := format(' Usó %s de saldo a favor.', public._money(v_amt));
  end if;

  delete from public.espera where cliente_id = cli.id and fecha = p_fecha and servicio_id = s.id;
  insert into public.notifs (texto, turno_id) values (
    format('Nueva reserva: %s · %s con %s, %s %s.%s%s', cli.nombre, s.nombre,
      (select nombre from public.profesionales where id = v_pro), to_char(p_fecha, 'DD/MM'), to_char(p_hora, 'HH24:MI'),
      case when p_medio = 'transferencia' then ' Esperando seña.' else ' Confirmada.' end, v_extra), t.id);

  return jsonb_build_object('turno_id', t.id,
    'token', case when v_nuevo or v_identificado then cli.token else t.token end,
    'tipo', case when v_nuevo or v_identificado then 'cliente' else 'turno' end);
end $$;

create or replace function public.quitar_espera(p_token uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.espera e using public.clientes c
  where e.id = p_id and c.id = e.cliente_id and (c.token = p_token or e.token = p_token);
  if not found then raise exception 'No encontramos esa inscripción'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function public.vencer_reservas() returns int
language plpgsql security definer set search_path = '' as $$
declare t record; n int := 0;
begin
  for t in update public.turnos set estado = 'vencido'
           where estado = 'pendiente_pago' and hold_hasta <= now()
           returning id, cliente_id, servicio_id, servicio_nombre, fecha, hora loop
    n := n + 1;
    insert into public.notifs (texto, turno_id) values (format('Se venció la reserva de %s (%s, %s %s). El horario quedó libre.',
      (select nombre from public.clientes where id = t.cliente_id), t.servicio_nombre, to_char(t.fecha, 'DD/MM'), to_char(t.hora, 'HH24:MI')), t.id);
    perform public._aviso_espera(t.fecha, t.servicio_id);
  end loop;
  delete from public.espera where fecha < public._hoy();
  return n;
end $$;

revoke execute on function public.reservar(uuid, uuid, date, time, text, text, text, text, text, uuid), public.quitar_espera(uuid, uuid), public.vencer_reservas() from public, anon, authenticated;
grant execute on function public.reservar(uuid, uuid, date, time, text, text, text, text, text, uuid), public.quitar_espera(uuid, uuid) to anon, authenticated;

create extension if not exists pg_cron with schema pg_catalog;
grant usage on schema cron to postgres;
select cron.schedule('vencer-reservas', '* * * * *', $$select public.vencer_reservas()$$);
