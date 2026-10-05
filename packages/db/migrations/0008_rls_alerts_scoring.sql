-- Row level security and updated_at triggers for the tables added in 0007.
-- Hand written. Supabase only; skipped on PGlite like 0001, 0003 and 0006.
-- alerts: every role reads its org, and any role may mark read or dismiss.
-- lead_scores: every role reads, acquisitions and admin write (they own the review queue).
-- buyer_match_models: every role reads, dispositions and admin write (they own buyer matching).

do $$
declare t text;
begin
  for t in select unnest(array['alerts', 'lead_scores', 'buyer_match_models'])
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for select using (org_id = public.current_org_id())', t || '_select', t);
  end loop;
  execute 'create policy alerts_write on public.alerts for all
    using (org_id = public.current_org_id())
    with check (org_id = public.current_org_id())';
  execute 'create policy lead_scores_write on public.lead_scores for all
    using (org_id = public.current_org_id() and public.current_role_name() in (''admin'', ''acquisitions''))
    with check (org_id = public.current_org_id() and public.current_role_name() in (''admin'', ''acquisitions''))';
  execute 'create policy buyer_match_models_write on public.buyer_match_models for all
    using (org_id = public.current_org_id() and public.current_role_name() in (''admin'', ''dispositions''))
    with check (org_id = public.current_org_id() and public.current_role_name() in (''admin'', ''dispositions''))';
end $$;
