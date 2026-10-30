-- The approved Korean Railroad group receives project-wide task editing.
-- Current group membership, account status and all expiry checks are evaluated on every request.
-- No administrator, project-management or whole-workbook publication role is granted.
begin;
create or replace function public.pms_task_policy(p_slug text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a jsonb:=public.pms_access(p_slug); orgs jsonb;
begin
 if not coalesce((a->>'canRead')::boolean,false) then raise insufficient_privilege;end if;
 select coalesce(jsonb_agg(distinct x.org_name),'[]') into orgs from public.pms_org_grants x
 join public.pms_groups g on g.id=x.group_id and g.active
 join public.pms_group_members m on m.group_id=g.id and m.active and m.user_id=auth.uid() and (m.expires_at is null or m.expires_at>now())
 join public.pms_group_grants p on p.group_id=g.id and p.project_slug=x.project_slug and p.active and (p.expires_at is null or p.expires_at>now())
 where x.project_slug=p_slug and x.active and coalesce(pmoffice_private.account_ok(),false);
 return jsonb_build_object('admin',coalesce((a->>'canManage')::boolean,false),'organizations',orgs,'allTasks',p_slug='korail' and orgs ? '한국철도공사');
end$$;
notify pgrst,'reload schema';
commit;
