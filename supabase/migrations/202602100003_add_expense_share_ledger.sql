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

alter table public.expense_shares enable row level security;
alter table public.share_payments enable row level security;

drop policy if exists "public read expense_shares" on public.expense_shares;
drop policy if exists "public write expense_shares" on public.expense_shares;
drop policy if exists "public read share_payments" on public.share_payments;
drop policy if exists "public write share_payments" on public.share_payments;

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

do $$
declare
  expense_row record;
  debtors uuid[];
  debtor uuid;
  debtor_count integer;
  split_amount numeric(12, 2);
begin
  for expense_row in
    select e.id, e.amount, e.paid_by, e.created_at
    from public.expenses e
  loop
    if exists(select 1 from public.expense_shares s where s.expense_id = expense_row.id) then
      continue;
    end if;

    select array_agg(ep.participant_id order by ep.participant_id)
      into debtors
    from public.expense_participants ep
    where ep.expense_id = expense_row.id
      and ep.participant_id <> expense_row.paid_by;

    debtor_count := coalesce(array_length(debtors, 1), 0);
    if debtor_count = 0 then
      continue;
    end if;

    split_amount := round((expense_row.amount / (debtor_count + 1))::numeric, 2);

    foreach debtor in array debtors
    loop
      insert into public.expense_shares (
        expense_id,
        debtor_id,
        creditor_id,
        share_amount,
        kind,
        created_at
      )
      values (
        expense_row.id,
        debtor,
        expense_row.paid_by,
        split_amount,
        'expense_split',
        expense_row.created_at
      );
    end loop;
  end loop;
end $$;

do $$
declare
  payment_row record;
  share_row record;
  remaining numeric(12, 2);
  applied numeric(12, 2);
  adjustment_expense_id uuid;
begin
  if exists(select 1 from public.payments)
    and not exists(select 1 from public.share_payments) then

    for payment_row in
      select p.id, p.from_participant_id, p.to_participant_id, p.amount, p.created_at
      from public.payments p
      order by p.created_at, p.id
    loop
      remaining := payment_row.amount;

      for share_row in
        select
          s.id,
          greatest(
            s.share_amount - coalesce((
              select sum(sp.amount)
              from public.share_payments sp
              where sp.expense_share_id = s.id
            ), 0),
            0
          ) as remaining_share
        from public.expense_shares s
        join public.expenses e on e.id = s.expense_id
        where s.debtor_id = payment_row.from_participant_id
          and s.creditor_id = payment_row.to_participant_id
        order by e.created_at, s.created_at, s.id
      loop
        exit when remaining <= 0;

        if share_row.remaining_share <= 0 then
          continue;
        end if;

        applied := least(remaining, share_row.remaining_share);

        insert into public.share_payments (
          expense_share_id,
          from_participant_id,
          to_participant_id,
          amount,
          note,
          created_at
        )
        values (
          share_row.id,
          payment_row.from_participant_id,
          payment_row.to_participant_id,
          applied,
          'Migrated from legacy global payment',
          payment_row.created_at
        );

        remaining := round((remaining - applied)::numeric, 2);
      end loop;

      if remaining > 0 then
        insert into public.expenses (
          title,
          amount,
          paid_by,
          note,
          created_at
        )
        values (
          'Legacy payment adjustment',
          remaining,
          payment_row.from_participant_id,
          'Auto-created while migrating old global payments to expense-bound ledger',
          payment_row.created_at
        )
        returning id into adjustment_expense_id;

        insert into public.expense_shares (
          expense_id,
          debtor_id,
          creditor_id,
          share_amount,
          kind,
          note,
          created_at
        )
        values (
          adjustment_expense_id,
          payment_row.to_participant_id,
          payment_row.from_participant_id,
          remaining,
          'overpayment_return',
          'Created while migrating an overpayment from legacy payments',
          payment_row.created_at
        );
      end if;
    end loop;
  end if;
end $$;
