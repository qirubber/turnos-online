-- Turnos Online · logo de la marca y permisos para borrar archivos (solo administración)
alter table public.config add column if not exists logo_url text not null default '';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('marca', 'marca', true, 2097152, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

create policy marca_subir on storage.objects for insert to authenticated
  with check (bucket_id = 'marca' and public.es_admin());
create policy marca_editar on storage.objects for update to authenticated
  using (bucket_id = 'marca' and public.es_admin()) with check (bucket_id = 'marca' and public.es_admin());
create policy marca_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'marca' and public.es_admin());
create policy comprobantes_borrar on storage.objects for delete to authenticated
  using (bucket_id = 'comprobantes' and public.es_admin());
