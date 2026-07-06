-- Summit Bechtel Course Guide — Supabase schema for shared/collaborative editing.
-- Run this once in your Supabase project's SQL Editor (SQL → New query → Run).

-- 1. Table that holds every point of interest, keyed by course.
create table if not exists public.pois (
  id          text primary key,
  course_id   text not null default 'jamboree',
  name        text default '',
  description text default '',
  notes       text default '',
  lat         double precision not null,
  lng         double precision not null,
  category    text default 'other',
  radius      integer default 90,
  ord         integer default 0,          -- "order" is a reserved word
  created_at  bigint default 0,
  updated_at  timestamptz default now()
);

create index if not exists pois_course_idx on public.pois (course_id);

-- 2. Row-level security. This is a shared team tool, so anyone with the app
--    (the public anon key) can read and edit the shared course. Tighten later
--    if you want (e.g. require a hard-to-guess course_id or add auth).
alter table public.pois enable row level security;

drop policy if exists pois_read   on public.pois;
drop policy if exists pois_insert on public.pois;
drop policy if exists pois_update on public.pois;
drop policy if exists pois_delete on public.pois;

create policy pois_read   on public.pois for select using (true);
create policy pois_insert on public.pois for insert with check (true);
create policy pois_update on public.pois for update using (true) with check (true);
create policy pois_delete on public.pois for delete using (true);

-- 3. Enable realtime so edits stream to every connected device.
--    (If it errors with "already member of publication", ignore it.)
alter publication supabase_realtime add table public.pois;
