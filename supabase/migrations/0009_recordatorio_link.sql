-- Turnos Online · el recordatorio incluye el link privado del cliente ({link})
alter table public.config alter column mensaje set default
  'Hola {nombre}! Te recordamos tu turno de {servicio} con {profesional} el {fecha} a las {hora} hs en {negocio}. Si no podés venir, reprogramá o cancelá hasta {cancelacion} minutos antes desde acá: {link} ¡Te esperamos!';
update public.config
   set mensaje = 'Hola {nombre}! Te recordamos tu turno de {servicio} con {profesional} el {fecha} a las {hora} hs en {negocio}. Si no podés venir, reprogramá o cancelá hasta {cancelacion} minutos antes desde acá: {link} ¡Te esperamos!'
 where id = 1 and position('{link}' in mensaje) = 0;
