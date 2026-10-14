-- Turnos Online · comprobantes, vencimiento automático y tiempo real

-- comprobantes de transferencia (privados; 5 MB; imágenes o PDF)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', false, 5242880,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do nothing;

create or replace function public.puede_subir_comprobante(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.turnos t
    where t.id::text = split_part(p_name, '/', 1)
      and t.estado = 'pendiente_pago' and t.hold_hasta > now())
$$;
revoke execute on function public.puede_subir_comprobante(text) from public;
grant execute on function public.puede_subir_comprobante(text) to anon, authenticated;

create policy comprobantes_subir on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'comprobantes' and public.puede_subir_comprobante(name));
create policy comprobantes_ver on storage.objects for select to authenticated
  using (bucket_id = 'comprobantes' and public.puede_ver_comprobante(name));

-- avisos en vivo para el panel del centro
alter publication supabase_realtime add table public.turnos, public.notifs, public.espera, public.pagos, public.clientes;
