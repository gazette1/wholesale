-- Row level security, updated_at triggers, and helper functions.
-- Hand written; drizzle-kit does not manage policies. Applied after 0000_crm_init.sql.

-- --------------------------------------------------------------------------
-- helpers
-- --------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- The caller's profile, resolved from the Supabase JWT. Null when unauthenticated.
create or replace function public.current_profile()
returns public.profiles language sql stable security definer set search_path = public as $$
  select p.* from public.profiles p where p.user_id = auth.uid() and p.active limit 1;
$$;

create or replace function public.current_org_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.org_id from public.profiles p where p.user_id = auth.uid() and p.active limit 1;
$$;

create or replace function public.current_role_name()
returns text language sql stable security definer set search_path = public as $$
  select p.role::text from public.profiles p where p.user_id = auth.uid() and p.active limit 1;
$$;

-- --------------------------------------------------------------------------
-- updated_at triggers on every table that has the column
-- --------------------------------------------------------------------------
do $$
declare t text;
begin
  for t in
    select table_name from information_schema.columns
    where table_schema = 'public' and column_name = 'updated_at'
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
  end loop;
end $$;

-- --------------------------------------------------------------------------
-- row level security
-- Every table is scoped by org_id. Writers are decided by role:
--   admin: everything
--   acquisitions: leads, properties, contacts, activities, tasks, offers, messages, templates, campaigns, analyses, rehab lines, comps, reports, documents
--   dispositions: buyers, criteria, purchases, packages, submissions, plus notes on leads (activities)
--   viewer: read only
-- --------------------------------------------------------------------------
do $$
declare
  t text;
  writers text;
begin
  for t, writers in
    select * from (values
      ('orgs', 'admin'),
      ('profiles', 'admin'),
      ('audit_log', 'admin'),
      ('properties', 'admin,acquisitions'),
      ('contacts', 'admin,acquisitions'),
      ('property_contacts', 'admin,acquisitions'),
      ('pipeline_stages', 'admin'),
      ('lead_sources', 'admin'),
      ('leads', 'admin,acquisitions'),
      ('activities', 'admin,acquisitions,dispositions'),
      ('tasks', 'admin,acquisitions,dispositions'),
      ('tags', 'admin,acquisitions'),
      ('lead_tags', 'admin,acquisitions'),
      ('offers', 'admin,acquisitions'),
      ('documents', 'admin,acquisitions,dispositions'),
      ('saved_views', 'admin,acquisitions,dispositions,viewer'),
      ('property_reports', 'admin,acquisitions'),
      ('comps', 'admin,acquisitions'),
      ('message_templates', 'admin,acquisitions'),
      ('campaigns', 'admin,acquisitions'),
      ('campaign_steps', 'admin,acquisitions'),
      ('campaign_enrollments', 'admin,acquisitions'),
      ('messages', 'admin,acquisitions,dispositions'),
      ('jobs', 'admin'),
      ('deal_analyses', 'admin,acquisitions'),
      ('rehab_line_items', 'admin,acquisitions'),
      ('cost_defaults', 'admin,acquisitions'),
      ('buyers', 'admin,dispositions'),
      ('buyer_criteria', 'admin,dispositions'),
      ('buyer_purchases', 'admin,dispositions'),
      ('deal_packages', 'admin,dispositions'),
      ('deal_submissions', 'admin,dispositions')
    ) as v(t, writers)
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    if t = 'orgs' then
      execute 'create policy orgs_select on public.orgs for select using (id = public.current_org_id())';
      execute 'create policy orgs_write on public.orgs for all using (id = public.current_org_id() and public.current_role_name() = ''admin'') with check (id = public.current_org_id() and public.current_role_name() = ''admin'')';
    else
      execute format('create policy %I on public.%I for select using (org_id = public.current_org_id())', t || '_select', t);
      execute format(
        'create policy %I on public.%I for all using (org_id = public.current_org_id() and public.current_role_name() = any (string_to_array(%L, '','')))
         with check (org_id = public.current_org_id() and public.current_role_name() = any (string_to_array(%L, '','')))',
        t || '_write', t, writers, writers);
    end if;
  end loop;
end $$;

-- Saved views: owners edit their own, everyone in the org reads shared ones.
drop policy if exists saved_views_select on public.saved_views;
create policy saved_views_select on public.saved_views for select
  using (org_id = public.current_org_id() and (is_shared or owner_id = (select id from public.current_profile())));
drop policy if exists saved_views_write on public.saved_views;
create policy saved_views_write on public.saved_views for all
  using (org_id = public.current_org_id() and owner_id = (select id from public.current_profile()))
  with check (org_id = public.current_org_id() and owner_id = (select id from public.current_profile()));

-- A user may read and update their own profile row regardless of role.
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles for select using (user_id = auth.uid());
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Storage bucket for documents and photos, private, path prefixed by org id.
insert into storage.buckets (id, name, public) values ('crm-files', 'crm-files', false)
on conflict (id) do nothing;
drop policy if exists crm_files_org_read on storage.objects;
create policy crm_files_org_read on storage.objects for select
  using (bucket_id = 'crm-files' and (storage.foldername(name))[1] = public.current_org_id()::text);
drop policy if exists crm_files_org_write on storage.objects;
create policy crm_files_org_write on storage.objects for all
  using (bucket_id = 'crm-files' and (storage.foldername(name))[1] = public.current_org_id()::text and public.current_role_name() <> 'viewer')
  with check (bucket_id = 'crm-files' and (storage.foldername(name))[1] = public.current_org_id()::text and public.current_role_name() <> 'viewer');
