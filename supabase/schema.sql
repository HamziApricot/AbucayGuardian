-- ============================================================
-- Abucay Guardian — Supabase Database Schema
-- Run this in your Supabase SQL Editor
-- ============================================================

-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- ==================== USERS ====================
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  phone text not null,
  avatar_url text,
  pairing_code text unique,
  lat double precision,
  lng double precision,
  updated_at timestamptz default now()
);
alter table public.users enable row level security;
drop policy if exists "Users can view own profile" on public.users;
create policy "Users can view own profile" on public.users for select using (auth.uid() = id);
drop policy if exists "Users can update own profile" on public.users;
create policy "Users can update own profile" on public.users for update using (auth.uid() = id);
drop policy if exists "Users can insert own profile" on public.users;
create policy "Users can insert own profile" on public.users for insert with check (auth.uid() = id);

-- ==================== FAMILY MEMBERS ====================
create table if not exists public.family_members (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  member_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  phone text not null,
  relationship text not null default 'Family',
  avatar_url text,
  created_at timestamptz default now()
);
alter table public.family_members enable row level security;
drop policy if exists "Users can view own family members" on public.family_members;
create policy "Users can view own family members" on public.family_members for select using (auth.uid() = user_id);
drop policy if exists "Users can insert family members" on public.family_members;
create policy "Users can insert family members" on public.family_members for insert with check (auth.uid() = user_id);
drop policy if exists "Users can update family members" on public.family_members;
create policy "Users can update family members" on public.family_members for update using (auth.uid() = user_id);
drop policy if exists "Users can delete family members" on public.family_members;
create policy "Users can delete family members" on public.family_members for delete using (auth.uid() = user_id);

-- ==================== EMERGENCY PLANS ====================
create table if not exists public.emergency_plans (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  steps jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table public.emergency_plans enable row level security;
drop policy if exists "Users can manage own emergency plans" on public.emergency_plans;
create policy "Users can manage own emergency plans" on public.emergency_plans for all using (auth.uid() = user_id);

-- ==================== HOTLINES (Optional — app uses local fallback) ====================
create table if not exists public.hotlines (
  id uuid primary key default uuid_generate_v4(),
  name text not null,
  number text not null,
  category text not null,
  icon text default 'call',
  color text default '#F4720B',
  created_at timestamptz default now()
);
alter table public.hotlines enable row level security;
drop policy if exists "Hotlines are publicly readable" on public.hotlines;
create policy "Hotlines are publicly readable" on public.hotlines for select using (true);

-- ==================== PROCEDURES (Optional — app uses local fallback) ====================
create table if not exists public.procedures (
  id uuid primary key default uuid_generate_v4(),
  title text not null,
  category text not null,
  icon text default 'document-text',
  color text default '#2176AE',
  steps jsonb not null default '[]',
  created_at timestamptz default now()
);
alter table public.procedures enable row level security;
drop policy if exists "Procedures are publicly readable" on public.procedures;
create policy "Procedures are publicly readable" on public.procedures for select using (true);

-- ==================== SOS EVENTS ====================
create table if not exists public.sos_events (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lat double precision,
  lng double precision,
  triggered_at timestamptz default now(),
  status text not null default 'active' check (status in ('active', 'cancelled', 'resolved'))
);
alter table public.sos_events enable row level security;
drop policy if exists "Users can insert own SOS events" on public.sos_events;
create policy "Users can insert own SOS events" on public.sos_events for insert with check (auth.uid() = user_id);
drop policy if exists "Users can view own SOS events" on public.sos_events;
create policy "Users can view own SOS events" on public.sos_events for select using (auth.uid() = user_id);
drop policy if exists "Family can view SOS events" on public.sos_events;
create policy "Family can view SOS events" on public.sos_events for select using (true);

-- ==================== TRACKER ====================
create table if not exists public.tracker (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  speed double precision,
  accuracy double precision,
  battery double precision,
  heading double precision,
  updated_at timestamptz default now()
);
alter table public.tracker add column if not exists speed double precision;
alter table public.tracker add column if not exists accuracy double precision;
alter table public.tracker add column if not exists battery double precision;
alter table public.tracker add column if not exists heading double precision;
alter table public.tracker enable row level security;
drop policy if exists "Users can upsert own tracker" on public.tracker;
create policy "Users can upsert own tracker" on public.tracker for all using (auth.uid() = user_id);
drop policy if exists "Family can view tracker" on public.tracker;
create policy "Family can view tracker" on public.tracker for select using (true);

-- ==================== LOCATION HISTORY (Offline Buffer Sync) ====================
create table if not exists public.location_history (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references auth.users(id) on delete cascade,
  lat double precision not null,
  lng double precision not null,
  speed double precision,
  accuracy double precision,
  battery double precision,
  heading double precision,
  captured_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
alter table public.location_history add column if not exists heading double precision;
alter table public.location_history enable row level security;
drop policy if exists "Users can insert own location history" on public.location_history;
create policy "Users can insert own location history" on public.location_history for insert with check (auth.uid() = user_id);
drop policy if exists "Family can view location history" on public.location_history;
create policy "Family can view location history" on public.location_history for select using (true);

-- ==================== REALTIME ====================
-- Enable realtime for SOS and Tracker (safe idempotency check)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tracker'
  ) then
    alter publication supabase_realtime add table public.tracker;
  end if;

  if not exists (
    select 1 from pg_publication_tables 
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sos_events'
  ) then
    alter publication supabase_realtime add table public.sos_events;
  end if;
end $$;

-- ==================== SAMPLE HOTLINES DATA ====================
insert into public.hotlines (name, number, category, icon, color) values
  ('911 Emergency', '911', 'Emergency', 'alert-circle', '#E63946'),
  ('Abucay MDRRMO', '(047) 123-4567', 'Disaster', 'shield', '#F4720B'),
  ('Abucay PNP Station', '(047) 234-5678', 'Police', 'shield-checkmark', '#2176AE'),
  ('Bureau of Fire Protection', '(047) 345-6789', 'Fire', 'flame', '#E63946'),
  ('Bataan General Hospital', '(047) 456-7890', 'Medical', 'medkit', '#2D9B5A'),
  ('Philippine Red Cross Bataan', '(047) 567-8901', 'Medical', 'heart', '#E63946'),
  ('DSWD Bataan', '(047) 678-9012', 'Social Services', 'people', '#2176AE'),
  ('Abucay Municipal Hall', '(047) 789-0123', 'Government', 'business', '#F4C430'),
  ('Coast Guard Bataan', '(047) 890-1234', 'Emergency', 'boat', '#2176AE'),
  ('NBI Bataan', '(047) 901-2345', 'Government', 'finger-print', '#0D1F4E')
on conflict do nothing;
