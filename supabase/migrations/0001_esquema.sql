-- Turnos Online · esquema base
-- Fechas y horas se guardan en hora local de Argentina (America/Argentina/Buenos_Aires).

create table public.config (
  id int primary key default 1 check (id = 1),
  negocio text not null default 'Mi centro',
  whatsapp text not null default '',
  alias text not null default '',
  cbu text not null default '',
  titular text not null default '',
  banco text not null default '',
  mp_activo boolean not null default false,
  mp_link text not null default '',
  exigir_sena boolean not null default true,
  cancel_min int not null default 30 check (cancel_min >= 0),
  sena_horas int not null default 24 check (sena_horas >= 0),
  politica text not null default 'pierde' check (politica in ('pierde','favor')),
  ventana int not null default 30 check (ventana between 1 and 365),
  anticipacion int not null default 60 check (anticipacion >= 0),
  hold_horas int not null default 2 check (hold_horas between 1 and 72),
  intervalo int not null default 30 check (intervalo between 5 and 240),
  recordatorio_horas int not null default 24,
  mensaje text not null default 'Hola {nombre}! Te recordamos tu turno de {servicio} con {profesional} el {fecha} a las {hora} hs en {negocio}.',
  mensaje_confirmacion text not null default 'Hola {nombre}! Recibimos tu seña. Tu turno de {servicio} con {profesional} quedó confirmado para el {fecha} a las {hora} hs.',
  updated_at timestamptz not null default now()
);
insert into public.config (id) values (1);

create table public.profesionales (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  rol text not null default '',
  tel text not null default '',
  color int not null default 1 check (color between 1 and 4),
  activo boolean not null default true,
  -- {"0":[], "1":[{"desde":"09:00","hasta":"13:00"}], ...} clave = día de la semana (0 domingo)
  horario jsonb not null default '{}'::jsonb,
  orden int not null default 0,
  created_at timestamptz not null default now()
);

create table public.servicios (
  id uuid primary key default gen_random_uuid(),
  categoria text not null default '',
  nombre text not null,
  descripcion text not null default '',
  duracion int not null check (duracion >= 5),
  preparacion int not null default 0 check (preparacion >= 0),
  precio int not null default 0 check (precio >= 0),
  sena int not null default 30 check (sena between 0 and 100),
  activo boolean not null default true,
  prof_ids uuid[] not null default '{}',
  equipo text not null default '',
  restringir boolean not null default false,
  dias int[] not null default '{1,2,3,4,5,6}',
  desde time not null default '09:00',
  hasta time not null default '20:00',
  orden int not null default 0,
  created_at timestamptz not null default now()
);

create table public.clientes (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  tel text not null unique,
  email text not null default '',
  notas text not null default '',
  credito int not null default 0 check (credito >= 0),
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table public.paquetes (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  servicio_id uuid references public.servicios(id) on delete set null,
  nombre text not null,
  total int not null check (total > 0),
  usadas int not null default 0 check (usadas >= 0),
  created_at timestamptz not null default now()
);
create index on public.paquetes (cliente_id);

create table public.turnos (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  servicio_id uuid references public.servicios(id) on delete set null,
  servicio_nombre text not null,
  profesional_id uuid references public.profesionales(id) on delete set null,
  equipo text not null default '',
  duracion int not null,
  preparacion int not null default 0,
  precio int not null default 0,
  sena_monto int not null default 0,
  fecha date not null,
  hora time not null,
  estado text not null check (estado in ('pendiente_pago','por_validar','confirmado','completado','ausente','cancelado','vencido')),
  hold_hasta timestamptz,
  medio text not null default '',
  origen text not null default 'web',
  recordado boolean not null default false,
  a_favor int not null default 0,
  paquete_id uuid references public.paquetes(id) on delete set null,
  paquete_sesion int,
  paquete_devuelto boolean not null default false,
  comprobante_path text,
  comprobante_nombre text,
  comprobante_subido timestamptz,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);
create index on public.turnos (fecha);
create index on public.turnos (cliente_id);
create index on public.turnos (profesional_id);

create table public.pagos (
  id uuid primary key default gen_random_uuid(),
  turno_id uuid not null references public.turnos(id) on delete cascade,
  monto int not null check (monto > 0),
  medio text not null,
  tipo text not null,
  fecha date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  created_at timestamptz not null default now()
);
create index on public.pagos (turno_id);

create table public.ventas (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid references public.clientes(id) on delete set null,
  paquete_id uuid references public.paquetes(id) on delete set null,
  concepto text not null,
  monto int not null check (monto >= 0),
  medio text not null,
  fecha date not null default ((now() at time zone 'America/Argentina/Buenos_Aires')::date),
  created_at timestamptz not null default now()
);

create table public.bloqueos (
  id uuid primary key default gen_random_uuid(),
  fecha date not null,
  desde time,
  hasta time,
  profesional_id uuid references public.profesionales(id) on delete cascade,
  motivo text not null default '',
  created_at timestamptz not null default now(),
  check ((desde is null and hasta is null) or (desde is not null and hasta is not null and hasta > desde))
);
create index on public.bloqueos (fecha);

create table public.espera (
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.clientes(id) on delete cascade,
  servicio_id uuid not null references public.servicios(id) on delete cascade,
  profesional_id uuid references public.profesionales(id) on delete set null,
  fecha date not null,
  franja text not null default '',
  avisado timestamptz,
  token uuid not null unique default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table public.notifs (
  id uuid primary key default gen_random_uuid(),
  texto text not null,
  turno_id uuid references public.turnos(id) on delete set null,
  leida boolean not null default false,
  created_at timestamptz not null default now()
);

-- personal del centro (usuarios de Supabase Auth)
create table public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null default '',
  rol text not null check (rol in ('admin','profesional')),
  profesional_id uuid references public.profesionales(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------- helpers de identidad ----------
create or replace function public.es_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff where user_id = (select auth.uid()));
$$;
create or replace function public.es_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.staff where user_id = (select auth.uid()) and rol = 'admin');
$$;
create or replace function public.mi_prof() returns uuid
language sql stable security definer set search_path = '' as $$
  select profesional_id from public.staff where user_id = (select auth.uid());
$$;

-- ---------- seguridad por fila ----------
alter table public.config enable row level security;
alter table public.profesionales enable row level security;
alter table public.servicios enable row level security;
alter table public.clientes enable row level security;
alter table public.paquetes enable row level security;
alter table public.turnos enable row level security;
alter table public.pagos enable row level security;
alter table public.ventas enable row level security;
alter table public.bloqueos enable row level security;
alter table public.espera enable row level security;
alter table public.notifs enable row level security;
alter table public.staff enable row level security;

-- públicas (lectura para la página de reservas)
create policy config_leer on public.config for select to anon, authenticated using (true);
create policy config_editar on public.config for update to authenticated using ((select public.es_admin())) with check ((select public.es_admin()));

create policy prof_leer_publico on public.profesionales for select to anon using (activo);
create policy prof_leer_staff on public.profesionales for select to authenticated using ((select public.es_staff()));
create policy prof_alta on public.profesionales for insert to authenticated with check ((select public.es_admin()));
create policy prof_editar on public.profesionales for update to authenticated using ((select public.es_admin())) with check ((select public.es_admin()));
create policy prof_borrar on public.profesionales for delete to authenticated using ((select public.es_admin()));

create policy svc_leer_publico on public.servicios for select to anon using (activo);
create policy svc_leer_staff on public.servicios for select to authenticated using ((select public.es_staff()));
create policy svc_alta on public.servicios for insert to authenticated with check ((select public.es_admin()));
create policy svc_editar on public.servicios for update to authenticated using ((select public.es_admin())) with check ((select public.es_admin()));
create policy svc_borrar on public.servicios for delete to authenticated using ((select public.es_admin()));

create policy bloq_leer_publico on public.bloqueos for select to anon using (true);
create policy bloq_leer_staff on public.bloqueos for select to authenticated using ((select public.es_staff()));
create policy bloq_alta on public.bloqueos for insert to authenticated with check ((select public.es_admin()));
create policy bloq_editar on public.bloqueos for update to authenticated using ((select public.es_admin())) with check ((select public.es_admin()));
create policy bloq_borrar on public.bloqueos for delete to authenticated using ((select public.es_admin()));

-- privadas: solo el personal
create policy cli_leer on public.clientes for select to authenticated using (
  (select public.es_admin()) or exists (select 1 from public.turnos t where t.cliente_id = clientes.id and t.profesional_id = (select public.mi_prof())));
create policy cli_alta on public.clientes for insert to authenticated with check ((select public.es_admin()));
create policy cli_editar on public.clientes for update to authenticated using ((select public.es_admin())) with check ((select public.es_admin()));
create policy cli_borrar on public.clientes for delete to authenticated using ((select public.es_admin()));

create policy tur_leer on public.turnos for select to authenticated using ((select public.es_admin()) or profesional_id = (select public.mi_prof()));
create policy tur_editar on public.turnos for update to authenticated using ((select public.es_admin())) with check ((select public.es_admin()));
create policy tur_borrar on public.turnos for delete to authenticated using ((select public.es_admin()));

create policy pag_leer on public.pagos for select to authenticated using (
  (select public.es_admin()) or exists (select 1 from public.turnos t where t.id = pagos.turno_id and t.profesional_id = (select public.mi_prof())));
create policy pag_borrar on public.pagos for delete to authenticated using ((select public.es_admin()));

create policy paq_leer on public.paquetes for select to authenticated using (
  (select public.es_admin()) or exists (select 1 from public.turnos t where t.cliente_id = paquetes.cliente_id and t.profesional_id = (select public.mi_prof())));
create policy paq_editar on public.paquetes for update to authenticated using ((select public.es_admin())) with check ((select public.es_admin()));
create policy paq_borrar on public.paquetes for delete to authenticated using ((select public.es_admin()));

create policy ven_leer on public.ventas for select to authenticated using ((select public.es_admin()));
create policy ven_borrar on public.ventas for delete to authenticated using ((select public.es_admin()));

create policy esp_leer on public.espera for select to authenticated using ((select public.es_staff()));
create policy esp_editar on public.espera for update to authenticated using ((select public.es_staff())) with check ((select public.es_staff()));
create policy esp_borrar on public.espera for delete to authenticated using ((select public.es_staff()));

create policy not_leer on public.notifs for select to authenticated using ((select public.es_admin()));
create policy not_editar on public.notifs for update to authenticated using ((select public.es_admin())) with check ((select public.es_admin()));
create policy not_borrar on public.notifs for delete to authenticated using ((select public.es_admin()));

create policy staff_leer on public.staff for select to authenticated using (user_id = (select auth.uid()) or (select public.es_admin()));
create policy staff_alta on public.staff for insert to authenticated with check ((select public.es_admin()));
create policy staff_editar on public.staff for update to authenticated using ((select public.es_admin())) with check ((select public.es_admin()));
create policy staff_borrar on public.staff for delete to authenticated using ((select public.es_admin()));

-- columnas visibles para el público: sin teléfonos ni motivos de bloqueo
revoke all on public.profesionales, public.bloqueos, public.clientes, public.paquetes, public.turnos,
  public.pagos, public.ventas, public.espera, public.notifs, public.staff from anon;
revoke insert, update, delete on public.config, public.servicios from anon;
grant select (id, nombre, rol, color, activo, horario, orden) on public.profesionales to anon;
grant select (id, fecha, desde, hasta, profesional_id) on public.bloqueos to anon;
