-- Turnos Online · empezar de cero (solo administración)
-- p_catalogo = false: borra turnos, clientes, pagos, paquetes, ventas, lista de espera y novedades.
-- p_catalogo = true:  además borra profesionales, tratamientos y bloqueos. Los ajustes y los usuarios del centro se conservan.
create or replace function public.admin_reiniciar(p_confirmacion text, p_catalogo boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare n_turnos int; n_clientes int;
begin
  if not public.es_admin() then raise exception 'Solo la administración puede hacer esto' using errcode = '42501'; end if;
  if coalesce(p_confirmacion, '') <> 'BORRAR' then raise exception 'Escribí BORRAR para confirmar'; end if;
  select count(*) into n_turnos from public.turnos;
  select count(*) into n_clientes from public.clientes;
  delete from public.notifs where true;
  delete from public.espera where true;
  delete from public.pagos where true;
  delete from public.ventas where true;
  delete from public.turnos where true;
  delete from public.paquetes where true;
  delete from public.clientes where true;
  if p_catalogo then
    delete from public.bloqueos where true;
    delete from public.servicios where true;
    update public.staff set profesional_id = null where profesional_id is not null;
    delete from public.profesionales where true;
  end if;
  return jsonb_build_object('turnos', n_turnos, 'clientes', n_clientes, 'catalogo', p_catalogo);
end $$;

revoke execute on function public.admin_reiniciar(text, boolean) from public, anon, authenticated;
grant execute on function public.admin_reiniciar(text, boolean) to authenticated;
