-- Turnos Online · permisos de ejecución de funciones
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.es_staff(), public.es_admin(), public.mi_prof() to anon, authenticated;
grant execute on function public.ocupados(date, date), public.mis_datos(uuid), public.cancelar_turno(uuid, uuid), public.reprogramar_turno(uuid, uuid, date, time, uuid),
  public.registrar_comprobante(uuid, uuid, text, text), public.anotar_espera(uuid, uuid, date, text, text, text, uuid), public.puede_subir_comprobante(text) to anon, authenticated;
grant execute on function public.staff_estado(uuid, text), public.staff_cancelar(uuid, boolean), public.staff_confirmar_sena(uuid),
  public.staff_reintento(uuid), public.staff_extender(uuid), public.staff_mover(uuid, date, time), public.staff_pago(uuid, int, text),
  public.staff_recordado(uuid), public.staff_crear_turno(uuid, text, text, uuid, uuid, date, time, text, text, boolean),
  public.staff_vender_paquete(uuid, uuid, int, int, text), public.puede_ver_comprobante(text) to authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;
