-- Migration : remboursement de dette initié par le client (Wave ou liquide),
-- confirmé ensuite par n'importe quel vendeur (la dette est globale).
create table if not exists debt_repayments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references clients(id),
  debt_ids uuid[] not null,
  amount numeric(10,2) not null,
  payment_method_id uuid references payment_methods(id),
  status text not null default 'pending',   -- pending | confirmed | cancelled
  confirmed_by_vendor_id uuid references vendors(id),
  cash_amount_received numeric(10,2),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);

alter table debt_repayments enable row level security;

create index if not exists idx_debt_repayments_client on debt_repayments(client_id);
create index if not exists idx_debt_repayments_status on debt_repayments(status);
