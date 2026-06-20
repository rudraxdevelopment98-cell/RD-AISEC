-- ============================================================
-- Shiva Portal — Supabase schema + RLS  (MULTI-PROJECT)
-- Run in your Supabase project: SQL Editor → New query → paste → Run.
-- See docs/supabase-setup.md for the walkthrough.
-- ============================================================

-- ---------- core tables ----------
create table if not exists profiles (
  id             uuid primary key references auth.users(id) on delete cascade,
  name           text not null,
  username       text unique not null,
  status         text not null default 'Active',
  platform_admin boolean not null default false,
  created_at     timestamptz not null default now()
);

create table if not exists projects (
  id         text primary key,           -- short slug, e.g. 'shiva'
  name       text not null,
  key        text,
  color      text,
  descr      text,
  created_at timestamptz not null default now()
);

create table if not exists members (
  id         uuid primary key default gen_random_uuid(),
  username   text not null,
  project_id text not null references projects(id) on delete cascade,
  role       text not null default 'Member',
  access     text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (username, project_id)
);

create table if not exists tasks (
  id         uuid primary key default gen_random_uuid(),
  project_id text references projects(id) on delete cascade,
  title      text not null, descr text, assignee text, due date,
  priority   text default 'Medium', status text default 'To do', phase text default 'P0',
  created_at timestamptz not null default now()
);
create table if not exists documents (
  id uuid primary key default gen_random_uuid(), project_id text references projects(id) on delete cascade,
  name text not null, category text, size text, url text, uploaded_by text, created_at timestamptz not null default now());
create table if not exists research (
  id uuid primary key default gen_random_uuid(), project_id text references projects(id) on delete cascade,
  title text not null, url text, category text, note text, created_by text, created_at timestamptz not null default now());
create table if not exists activity (
  id uuid primary key default gen_random_uuid(), project_id text references projects(id) on delete cascade,
  actor text, action text not null, created_at timestamptz not null default now());

-- ---------- helpers ----------
create or replace function is_platform_admin() returns boolean language sql security definer stable as $$
  select exists(select 1 from profiles where id = auth.uid() and platform_admin and status='Active'); $$;
create or replace function my_username() returns text language sql security definer stable as $$
  select username from profiles where id = auth.uid(); $$;
-- am I owner/admin on a given project?
create or replace function proj_admin(pid text) returns boolean language sql security definer stable as $$
  select exists(select 1 from members where project_id = pid and username = my_username() and role in ('Owner','Admin')); $$;
create or replace function proj_member(pid text) returns boolean language sql security definer stable as $$
  select exists(select 1 from members where project_id = pid and username = my_username()); $$;

-- ---------- RLS ----------
alter table profiles enable row level security;
alter table projects enable row level security;
alter table members  enable row level security;
alter table tasks    enable row level security;
alter table documents enable row level security;
alter table research enable row level security;
alter table activity enable row level security;

drop policy if exists p_sel on profiles; create policy p_sel on profiles for select to authenticated using (true);
drop policy if exists p_upd on profiles; create policy p_upd on profiles for update to authenticated using (id = auth.uid());

drop policy if exists pr_sel on projects; create policy pr_sel on projects for select to authenticated using (proj_member(id) or is_platform_admin());
drop policy if exists pr_ins on projects; create policy pr_ins on projects for insert to authenticated with check (is_platform_admin());
drop policy if exists pr_upd on projects; create policy pr_upd on projects for update to authenticated using (proj_admin(id) or is_platform_admin());
drop policy if exists pr_del on projects; create policy pr_del on projects for delete to authenticated using (is_platform_admin());

drop policy if exists m_sel on members; create policy m_sel on members for select to authenticated using (true);
drop policy if exists m_ins on members; create policy m_ins on members for insert to authenticated with check (proj_admin(project_id) or is_platform_admin());
drop policy if exists m_upd on members; create policy m_upd on members for update to authenticated using (proj_admin(project_id) or is_platform_admin());
drop policy if exists m_del on members; create policy m_del on members for delete to authenticated using (proj_admin(project_id) or is_platform_admin());

-- project-scoped content: visible to members; writable per role
drop policy if exists t_sel on tasks; create policy t_sel on tasks for select to authenticated using (proj_member(project_id));
drop policy if exists t_ins on tasks; create policy t_ins on tasks for insert to authenticated with check (proj_member(project_id));
drop policy if exists t_upd on tasks; create policy t_upd on tasks for update to authenticated using (proj_member(project_id));
drop policy if exists t_del on tasks; create policy t_del on tasks for delete to authenticated using (proj_admin(project_id));

drop policy if exists d_all on documents; create policy d_all on documents for all to authenticated using (proj_member(project_id)) with check (proj_member(project_id));
drop policy if exists r_all on research;  create policy r_all on research  for all to authenticated using (proj_member(project_id)) with check (proj_member(project_id));
drop policy if exists a_sel on activity;  create policy a_sel on activity  for select to authenticated using (proj_member(project_id));
drop policy if exists a_ins on activity;  create policy a_ins on activity  for insert to authenticated with check (proj_member(project_id));

-- ---------- storage ----------
insert into storage.buckets (id, name, public) values ('documents','documents', true) on conflict (id) do nothing;
drop policy if exists s_read on storage.objects;  create policy s_read on storage.objects for select using (bucket_id='documents');
drop policy if exists s_write on storage.objects; create policy s_write on storage.objects for insert to authenticated with check (bucket_id='documents');

-- ============================================================
-- First Owner + first project: see docs/supabase-setup.md.
-- After creating auth user kuldeep@shiva.local:
--   insert into profiles (id,name,username,platform_admin,status)
--   select id,'Kuldeep','kuldeep',true,'Active' from auth.users where email='kuldeep@shiva.local';
--   insert into projects (id,name,key,color,descr) values ('shiva','Shiva','SHV','#6d5efc','MCP security');
--   insert into members (username,project_id,role,access)
--   values ('kuldeep','shiva','Owner', array['dashboard','project','canvas','tasks','documents','research','activity','members','profile']);
-- ============================================================
