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

create table if not exists public.expense_shares (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references public.expenses(id) on delete cascade,
  debtor_id uuid not null references public.participants(id) on delete cascade,
  creditor_id uuid not null references public.participants(id) on delete cascade,
  share_amount numeric(12, 2) not null check (share_amount > 0),
  kind text not null default 'expense_split' check (kind in ('expense_split', 'overpayment_return')),
  origin_share_id uuid references public.expense_shares(id) on delete set null,
  note text not null default '',
  created_at timestamptz not null default now(),
  check (debtor_id <> creditor_id)
);

create index if not exists expense_shares_expense_idx on public.expense_shares(expense_id);
create index if not exists expense_shares_pair_idx on public.expense_shares(debtor_id, creditor_id);

create table if not exists public.share_payments (
  id uuid primary key default gen_random_uuid(),
  expense_share_id uuid not null references public.expense_shares(id) on delete cascade,
  from_participant_id uuid not null references public.participants(id) on delete cascade,
  to_participant_id uuid not null references public.participants(id) on delete cascade,
  amount numeric(12, 2) not null check (amount > 0),
  note text not null default '',
  created_at timestamptz not null default now(),
  check (from_participant_id <> to_participant_id)
);

create index if not exists share_payments_share_idx on public.share_payments(expense_share_id);

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
alter table public.expense_shares enable row level security;
alter table public.share_payments enable row level security;
alter table public.payments enable row level security;

drop policy if exists "public read participants" on public.participants;
drop policy if exists "public write participants" on public.participants;
drop policy if exists "public read expenses" on public.expenses;
drop policy if exists "public write expenses" on public.expenses;
drop policy if exists "public read expense_participants" on public.expense_participants;
drop policy if exists "public write expense_participants" on public.expense_participants;
drop policy if exists "public read expense_shares" on public.expense_shares;
drop policy if exists "public write expense_shares" on public.expense_shares;
drop policy if exists "public read share_payments" on public.share_payments;
drop policy if exists "public write share_payments" on public.share_payments;
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

create policy "public read expense_shares"
  on public.expense_shares
  for select
  to anon, authenticated
  using (true);

create policy "public write expense_shares"
  on public.expense_shares
  for all
  to anon, authenticated
  using (true)
  with check (true);

create policy "public read share_payments"
  on public.share_payments
  for select
  to anon, authenticated
  using (true);

create policy "public write share_payments"
  on public.share_payments
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
