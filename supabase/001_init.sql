-- تسليم أصول ورق (paper handover) — additive tables, prefixed ho_. Service role only (edge function).
create table if not exists public.ho_receipts (
  id uuid primary key,
  serial text unique not null,
  container_no text, plate_no text, driver_name text, driver_phone text, ref_no text, destination text,
  pages int not null default 0,
  data jsonb not null default '{}'::jsonb,
  saved_at timestamptz not null default now(),
  saved_by text, device text,
  archived boolean not null default false, archived_at timestamptz, archived_by text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.ho_receipts_test (like public.ho_receipts including all);
create index if not exists ho_receipts_saved_idx on public.ho_receipts (saved_at desc);
create table if not exists public.ho_seq (scope text primary key, n int not null default 0);
create table if not exists public.ho_config (key text primary key, value text, enabled boolean not null default true, updated_at timestamptz default now());
alter table public.ho_receipts enable row level security;
alter table public.ho_receipts_test enable row level security;
alter table public.ho_seq enable row level security;
alter table public.ho_config enable row level security;
revoke all on public.ho_receipts, public.ho_receipts_test, public.ho_seq, public.ho_config from anon, authenticated;

create or replace function public.ho_next_serial(p_scope text) returns int
language sql security definer set search_path = public as $$
  insert into public.ho_seq(scope, n) values (p_scope, 1)
  on conflict (scope) do update set n = public.ho_seq.n + 1
  returning n;
$$;
revoke all on function public.ho_next_serial(text) from public, anon, authenticated;
grant execute on function public.ho_next_serial(text) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ho-files', 'ho-files', false, 4194304, array['image/jpeg','image/png','image/webp','application/pdf'])
on conflict (id) do nothing;
