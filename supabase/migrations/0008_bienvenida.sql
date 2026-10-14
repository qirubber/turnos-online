-- Turnos Online · mensaje de bienvenida editable en la página de reservas
alter table public.config add column if not exists bienvenida_titulo text not null default '';
alter table public.config add column if not exists bienvenida_texto text not null default '';
