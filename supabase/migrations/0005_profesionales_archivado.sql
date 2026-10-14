-- Turnos Online · eliminar profesionales sin perder el historial de turnos
alter table public.profesionales add column if not exists archivado boolean not null default false;
