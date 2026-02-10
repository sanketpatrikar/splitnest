create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  from_participant_id uuid not null references public.participants(id) on delete cascade,
  to_participant_id uuid not null references public.participants(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  created_at timestamptz not null default now(),
  check (from_participant_id <> to_participant_id)
);

alter table public.payments enable row level security;

drop policy if exists "public read payments" on public.payments;
drop policy if exists "public write payments" on public.payments;

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
