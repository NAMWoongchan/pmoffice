-- Administrator-only password target listing and a fresh server-side guard.
begin;
create or replace function public.member_password_targets(p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at,x.id) from (
 select p.id,p.display_name,p.company,p.status,p.withdrawn_at,p.created_at,u.email,
 (p.id=auth.uid() or lower(u.email)='namwoongchan@gmail.com' or exists(select 1 from public.admin_roles a where a.user_id=p.id)) as is_admin
 from public.profiles p join auth.users u on u.id=p.id
 order by p.created_at,p.id offset greatest(0,p_offset) limit 101
 ) x),'[]');
end$$;
create or replace function public.member_password_target(p_user uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 return exists(select 1 from public.profiles p join auth.users u on u.id=p.id
 where p.id=p_user and p.id<>auth.uid() and lower(u.email)<>'namwoongchan@gmail.com'
 and not exists(select 1 from public.admin_roles a where a.user_id=p.id));
end$$;
revoke all on function public.member_password_targets(integer),public.member_password_target(uuid) from public,anon;
grant execute on function public.member_password_targets(integer),public.member_password_target(uuid) to authenticated;
notify pgrst,'reload schema';
commit;
