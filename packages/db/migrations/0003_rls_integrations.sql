-- Row level security and updated_at triggers for the tables added in 0002.
-- Hand written. Supabase only; skipped on PGlite like 0001.
-- API keys and webhook endpoints are admin only: both carry secrets.

do $$
declare t text;
begin
  for t in select unnest(array['api_keys', 'webhook_endpoints', 'webhook_deliveries'])
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for select using (org_id = public.current_org_id() and public.current_role_name() = ''admin'')', t || '_select', t);
    execute format(
      'create policy %I on public.%I for all using (org_id = public.current_org_id() and public.current_role_name() = ''admin'')
       with check (org_id = public.current_org_id() and public.current_role_name() = ''admin'')',
      t || '_write', t);
  end loop;
end $$;
