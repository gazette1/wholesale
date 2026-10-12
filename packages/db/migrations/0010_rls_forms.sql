-- Row level security and updated_at triggers for the Workflow Forms tables added in 0009.
-- Hand written. Supabase only; skipped on PGlite like 0001, 0003, 0006 and 0008.
-- Every role reads its org. Form admins write forms and versions. Assignees write their own tasks and answers.
-- External parties never reach the database directly: the server acts for them with the service role.

create or replace function public.current_is_form_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select p.is_form_admin or p.role::text = 'admin' from public.profiles p where p.user_id = auth.uid() and p.active limit 1), false);
$$;
revoke execute on function public.current_is_form_admin() from anon;

do $$
declare t text;
begin
  for t in select unnest(array['forms', 'form_versions', 'form_submissions', 'form_tasks', 'form_task_assignees',
    'form_external_parties', 'form_comments', 'form_events', 'form_purge_requests'])
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()', t || '_set_updated_at', t);
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for select using (org_id = public.current_org_id())', t || '_select', t);
  end loop;

  -- Building and publishing.
  execute 'create policy forms_write on public.forms for all
    using (org_id = public.current_org_id() and public.current_is_form_admin())
    with check (org_id = public.current_org_id() and public.current_is_form_admin())';
  execute 'create policy form_versions_write on public.form_versions for all
    using (org_id = public.current_org_id() and public.current_is_form_admin())
    with check (org_id = public.current_org_id() and public.current_is_form_admin())';

  -- Submissions: anyone but a viewer may start one; assignees of any of its tasks and form admins may change it.
  execute 'create policy form_submissions_insert on public.form_submissions for insert
    with check (org_id = public.current_org_id() and public.current_role_name() <> ''viewer'')';
  execute 'create policy form_submissions_write on public.form_submissions for update
    using (org_id = public.current_org_id() and (public.current_is_form_admin() or exists (
      select 1 from public.form_tasks ft join public.form_task_assignees fa on fa.task_id = ft.id
      where ft.submission_id = form_submissions.id and fa.profile_id = (select id from public.current_profile()))))
    with check (org_id = public.current_org_id())';

  -- Tasks and assignees: the task''s own assignees and form admins.
  execute 'create policy form_tasks_write on public.form_tasks for all
    using (org_id = public.current_org_id() and (public.current_is_form_admin() or exists (
      select 1 from public.form_task_assignees fa where fa.task_id = form_tasks.id and fa.profile_id = (select id from public.current_profile()))))
    with check (org_id = public.current_org_id())';
  execute 'create policy form_task_assignees_write on public.form_task_assignees for all
    using (org_id = public.current_org_id() and (public.current_is_form_admin() or profile_id = (select id from public.current_profile())))
    with check (org_id = public.current_org_id())';

  -- Invites: anyone but a viewer may invite and revoke.
  execute 'create policy form_external_parties_write on public.form_external_parties for all
    using (org_id = public.current_org_id() and public.current_role_name() <> ''viewer'')
    with check (org_id = public.current_org_id() and public.current_role_name() <> ''viewer'')';

  -- Comments: any signed in member writes as themself.
  execute 'create policy form_comments_write on public.form_comments for all
    using (org_id = public.current_org_id() and author_id = (select id from public.current_profile()))
    with check (org_id = public.current_org_id() and author_id = (select id from public.current_profile()))';

  -- History is append only.
  execute 'create policy form_events_insert on public.form_events for insert
    with check (org_id = public.current_org_id())';

  -- Purge requests: admins only.
  execute 'create policy form_purge_requests_write on public.form_purge_requests for all
    using (org_id = public.current_org_id() and public.current_role_name() = ''admin'')
    with check (org_id = public.current_org_id() and public.current_role_name() = ''admin'')';
end $$;
