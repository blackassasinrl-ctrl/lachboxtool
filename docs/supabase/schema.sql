-- ============================================================
-- LACHBOX OS — CLOUD-SCHEMA (Milestone 8a)
-- Plak dit hele bestand in het Supabase-dashboard onder
-- "SQL Editor" -> "New query" -> Run. Eenmalig, op een leeg project.
--
-- Eén tabel per bestaande IndexedDB-store. Elke tabel heeft de
-- kolommen waar storage.js nu al op filtert/indexeert als echte
-- kolommen (voor snelle queries), plus een `data jsonb`-kolom met de
-- rest van het record — dezelfde vrije structuur (factuurregels,
-- extra's, kosten, checklist-items) die nu al in IndexedDB staat,
-- ongewijzigd overgenomen.
--
-- Row Level Security: elke ingelogde gebruiker mag alles lezen en
-- schrijven (auth.role() = 'authenticated') — één gedeelde workspace
-- voor het hele Lachbox-team, geen aparte data per persoon.
-- ============================================================

-- ---------- Helper: updated_at automatisch bijhouden ----------
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------- customers ----------
create table customers (
  id uuid primary key default gen_random_uuid(),
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table customers enable row level security;
create policy "authenticated read/write" on customers
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create trigger customers_set_updated_at before update on customers
  for each row execute function set_updated_at();

-- ---------- leads ----------
create table leads (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete cascade,
  status text not null default 'Nieuw',
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index leads_customer_id_idx on leads(customer_id);
create index leads_status_idx on leads(status);
alter table leads enable row level security;
create policy "authenticated read/write" on leads
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create trigger leads_set_updated_at before update on leads
  for each row execute function set_updated_at();

-- ---------- events ----------
create table events (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  lead_id uuid references leads(id) on delete set null,
  status text not null default 'Gepland',
  event_date date,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index events_customer_id_idx on events(customer_id);
create index events_status_idx on events(status);
create index events_date_idx on events(event_date);
alter table events enable row level security;
create policy "authenticated read/write" on events
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create trigger events_set_updated_at before update on events
  for each row execute function set_updated_at();

-- ---------- checklists ----------
create table checklists (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index checklists_event_id_idx on checklists(event_id);
alter table checklists enable row level security;
create policy "authenticated read/write" on checklists
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create trigger checklists_set_updated_at before update on checklists
  for each row execute function set_updated_at();

-- ---------- invoices ----------
create table invoices (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  event_id uuid references events(id) on delete set null,
  invoice_number text,
  payment_status text not null default 'concept',
  issue_date date,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index invoices_customer_id_idx on invoices(customer_id);
create index invoices_event_id_idx on invoices(event_id);
create index invoices_payment_status_idx on invoices(payment_status);
create unique index invoices_number_idx on invoices(invoice_number) where invoice_number is not null;
alter table invoices enable row level security;
create policy "authenticated read/write" on invoices
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create trigger invoices_set_updated_at before update on invoices
  for each row execute function set_updated_at();

-- ---------- reviews ----------
create table reviews (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references customers(id) on delete set null,
  event_id uuid references events(id) on delete cascade,
  status text not null default 'niet_gevraagd',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index reviews_event_id_idx on reviews(event_id);
create index reviews_status_idx on reviews(status);
alter table reviews enable row level security;
create policy "authenticated read/write" on reviews
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create trigger reviews_set_updated_at before update on reviews
  for each row execute function set_updated_at();

-- ---------- settings (één vaste rij, id 'main') ----------
create table settings (
  id text primary key default 'main',
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table settings enable row level security;
create policy "authenticated read/write" on settings
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create trigger settings_set_updated_at before update on settings
  for each row execute function set_updated_at();

-- ---------- invoice_counter (één vaste rij, id 'main') ----------
create table invoice_counter (
  id text primary key default 'main',
  year int not null,
  month int not null,
  last_number int not null default 0,
  updated_at timestamptz not null default now()
);
alter table invoice_counter enable row level security;
create policy "authenticated read/write" on invoice_counter
  for all using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create trigger invoice_counter_set_updated_at before update on invoice_counter
  for each row execute function set_updated_at();

-- ---------- Realtime: laat de app live wijzigingen ontvangen ----------
alter publication supabase_realtime add table customers, leads, events, checklists, invoices, reviews, settings;
