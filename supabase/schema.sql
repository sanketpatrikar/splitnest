create extension if not exists pgcrypto;

create table if not exists public.participants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) > 0),
  created_at timestamptz not null default now()
);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) > 0),
  amount numeric(12, 2) not null check (amount > 0),
  paid_by uuid not null references public.participants(id) on delete cascade,
  note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists public.expense_participants (
  expense_id uuid not null references public.expenses(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  primary key (expense_id, participant_id)
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  from_participant_id uuid not null references public.participants(id) on delete cascade,
  to_participant_id uuid not null references public.participants(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  check (from_participant_id <> to_participant_id)
);

alter table public.participants enable row level security;
alter table public.expenses enable row level security;
alter table public.expense_participants enable row level security;
alter table public.payments enable row level security;

drop policy if exists "public read participants" on public.participants;
drop policy if exists "public write participants" on public.participants;
drop policy if exists "public read expenses" on public.expenses;
drop policy if exists "public write expenses" on public.expenses;
drop policy if exists "public read expense_participants" on public.expense_participants;
drop policy if exists "public write expense_participants" on public.expense_participants;
drop policy if exists "public read payments" on public.payments;
drop policy if exists "public write payments" on public.payments;

create policy "public read participants"
  on public.participants
  for select
  to anon, authenticated
  using (true);

create policy "public write participants"
  on public.participants
  for all
  to anon, authenticated
  using (true)
  with check (true);

create policy "public read expenses"
  on public.expenses
  for select
  to anon, authenticated
  using (true);

create policy "public write expenses"
  on public.expenses
  for all
  to anon, authenticated
  using (true)
  with check (true);

create policy "public read expense_participants"
  on public.expense_participants
  for select
  to anon, authenticated
  using (true);

create policy "public write expense_participants"
  on public.expense_participants
  for all
  to anon, authenticated
  using (true)
  with check (true);

create policy "public read payments"
  on public.payments
  for select
  to anon, authenticated
  using (true);

create policy "public write payments"
  on public.payments
  for all
  to anon, authenticated
  using (true)
  with check (true);
