-- Row level security and updated_at triggers for the tables added in 0005.
-- Hand written. Supabase only; skipped on PGlite like 0001 and 0003.
-- calls: every role reads, acquisitions and dispositions write (same as messages).
-- enrichment_settings: every role reads, admin writes (it controls spend).

do $$
declare t text;
begin
  for t in select unnest(array['calls', 'enrichment_settings'])
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for select using (org_id = public.current_org_id())', t || '_select', t);
  end loop;
  execute 'create policy calls_write on public.calls for all
    using (org_id = public.current_org_id() and public.current_role_name() in (''admin'', ''acquisitions'', ''dispositions''))
    with check (org_id = public.current_org_id() and public.current_role_name() in (''admin'', ''acquisitions'', ''dispositions''))';
  execute 'create policy enrichment_settings_write on public.enrichment_settings for all
    using (org_id = public.current_org_id() and public.current_role_name() = ''admin'')
    with check (org_id = public.current_org_id() and public.current_role_name() = ''admin'')';
end $$;
