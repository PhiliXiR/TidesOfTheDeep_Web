-- Runs
create table if not exists public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text default 'Untitled Run',
  status text not null default 'active', -- active | won | lost | abandoned
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One "current snapshot" per run (simple MVP)
create table if not exists public.run_state (
  run_id uuid primary key references public.runs(id) on delete cascade,
  state_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Content blobs keyed by string
create table if not exists public.content (
  key text primary key,
  json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Keep updated_at fresh
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end; $$ language plpgsql;

drop trigger if exists runs_set_updated_at on public.runs;
create trigger runs_set_updated_at
before update on public.runs
for each row execute function public.set_updated_at();

drop trigger if exists run_state_set_updated_at on public.run_state;
create trigger run_state_set_updated_at
before update on public.run_state
for each row execute function public.set_updated_at();

drop trigger if exists content_set_updated_at on public.content;
create trigger content_set_updated_at
before update on public.content
for each row execute function public.set_updated_at();

-- RLS
alter table public.runs enable row level security;
alter table public.run_state enable row level security;
alter table public.content enable row level security;

-- Runs policies (owner-only)
drop policy if exists "runs_select_own" on public.runs;
create policy "runs_select_own" on public.runs
for select using (auth.uid() = user_id);

drop policy if exists "runs_insert_own" on public.runs;
create policy "runs_insert_own" on public.runs
for insert with check (auth.uid() = user_id);

drop policy if exists "runs_update_own" on public.runs;
create policy "runs_update_own" on public.runs
for update using (auth.uid() = user_id);

drop policy if exists "runs_delete_own" on public.runs;
create policy "runs_delete_own" on public.runs
for delete using (auth.uid() = user_id);

-- run_state policies (owner-only via runs join)
drop policy if exists "run_state_select_own" on public.run_state;
create policy "run_state_select_own" on public.run_state
for select using (
  exists (select 1 from public.runs r where r.id = run_id and r.user_id = auth.uid())
);

drop policy if exists "run_state_insert_own" on public.run_state;
create policy "run_state_insert_own" on public.run_state
for insert with check (
  exists (select 1 from public.runs r where r.id = run_id and r.user_id = auth.uid())
);

drop policy if exists "run_state_update_own" on public.run_state;
create policy "run_state_update_own" on public.run_state
for update using (
  exists (select 1 from public.runs r where r.id = run_id and r.user_id = auth.uid())
);

drop policy if exists "run_state_delete_own" on public.run_state;
create policy "run_state_delete_own" on public.run_state
for delete using (
  exists (select 1 from public.runs r where r.id = run_id and r.user_id = auth.uid())
);

-- content policies (simple / messy on purpose)
drop policy if exists "content_read_authed" on public.content;
create policy "content_read_authed" on public.content
for select using (auth.role() = 'authenticated');

drop policy if exists "content_write_authed" on public.content;
create policy "content_write_authed" on public.content
for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
