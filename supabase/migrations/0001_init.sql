-- 0001_init.sql
-- DRAFT ONLY. Not applied in Session 1. Do not run against any project until
-- docs/ARCHITECTURE.md section 5 is reviewed and Supabase auth is set up.
--
-- Tables:
--   deals              one row per saved deal, inputs and outputs as jsonb
--   rehab_line_items   normalized copy of deals.inputs.rehab.lines for reporting
--   cost_defaults      per user unit cost table seeded from the Rehab Estimator H column

create extension if not exists "pgcrypto";

-- --------------------------------------------------------------------------
-- deals
-- --------------------------------------------------------------------------
create table if not exists public.deals (
  id             uuid primary key default gen_random_uuid(),
  owner          uuid not null references auth.users (id) on delete cascade,
  name           text not null,
  address        text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  inputs         jsonb not null,
  outputs        jsonb not null,
  engine_version text not null,
  -- generated columns for list views and comparisons; recomputed from outputs
  net_profit     numeric generated always as ((outputs #>> '{acquisitions,netProfit}')::numeric) stored,
  roi_on_cash    numeric generated always as ((outputs #>> '{acquisitions,roiOnCash}')::numeric) stored,
  arv            numeric generated always as ((inputs  #>> '{acquisitions,arv}')::numeric) stored
);

create index if not exists deals_owner_updated_idx on public.deals (owner, updated_at desc);

-- --------------------------------------------------------------------------
-- rehab_line_items
-- --------------------------------------------------------------------------
create table if not exists public.rehab_line_items (
  id          uuid primary key default gen_random_uuid(),
  deal_id     uuid not null references public.deals (id) on delete cascade,
  row_number  int  not null,           -- workbook row 3 to 69, keeps the checklist order
  item_number int,                     -- 1 to 25, null on option rows
  question    text,
  option      text,
  answer      text check (answer in ('Yes', 'No') or answer is null),
  quantity    numeric,
  unit_cost   numeric,
  line_total  numeric,
  unique (deal_id, row_number)
);

-- --------------------------------------------------------------------------
-- cost_defaults
-- --------------------------------------------------------------------------
create table if not exists public.cost_defaults (
  id          uuid primary key default gen_random_uuid(),
  owner       uuid not null references auth.users (id) on delete cascade,
  row_number  int  not null,
  item_number int,
  question    text,
  option      text,
  unit_cost   numeric,
  unit        text,                    -- each, sqft, per 10x10, per window
  market      text,                    -- where the price came from, free text
  as_of       date,                    -- when the price was last checked
  updated_at  timestamptz not null default now(),
  unique (owner, row_number)
);

-- --------------------------------------------------------------------------
-- updated_at trigger
-- --------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists deals_set_updated_at on public.deals;
create trigger deals_set_updated_at
  before update on public.deals
  for each row execute function public.set_updated_at();

drop trigger if exists cost_defaults_set_updated_at on public.cost_defaults;
create trigger cost_defaults_set_updated_at
  before update on public.cost_defaults
  for each row execute function public.set_updated_at();

-- --------------------------------------------------------------------------
-- row level security: owners see only their own rows
-- --------------------------------------------------------------------------
alter table public.deals            enable row level security;
alter table public.rehab_line_items enable row level security;
alter table public.cost_defaults    enable row level security;

create policy deals_owner_all on public.deals
  for all using (owner = auth.uid()) with check (owner = auth.uid());

create policy rehab_line_items_owner_all on public.rehab_line_items
  for all using (exists (select 1 from public.deals d where d.id = deal_id and d.owner = auth.uid()))
  with check  (exists (select 1 from public.deals d where d.id = deal_id and d.owner = auth.uid()));

create policy cost_defaults_owner_all on public.cost_defaults
  for all using (owner = auth.uid()) with check (owner = auth.uid());

-- --------------------------------------------------------------------------
-- Airtable mapping notes (not SQL)
-- --------------------------------------------------------------------------
-- The "To Airtable" sheet is one flat row of 87 columns. Every column maps to
-- deals.name, deals.address, deals.notes, deals.inputs.acquisitions, or
-- deals.outputs.acquisitions. Nothing in it covers rehab, cash flow, or
-- Buy and Hold. Four columns share the header
-- "Miscellaneous Holding Costs Annualized" and map by position to
-- outputs.acquisitions.holding.miscHoldingTotal[0..3]. "Name" is
-- address plus potential profit and is rebuilt at export time.
