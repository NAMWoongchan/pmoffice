-- Read-only admin member overview; no authentication/session identifiers are returned.
begin;
create or replace function public.member_admin_list(p_search text default '',p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc,x.id) from (
 select p.*,u.email,u.last_sign_in_at,
 case when p.status<>'active' or p.withdrawn_at is not null or u.banned_until>statement_timestamp() then 'blocked'
 when exists(select 1 from auth.sessions s where s.user_id=p.id and (s.not_after is null or s.not_after>statement_timestamp())) then 'signed_in'
 else 'signed_out' end as login_status,
 coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'active',g.active and m.active and (m.expires_at is null or m.expires_at>statement_timestamp())) order by g.name,g.id)
 from public.pms_groups g join public.pms_group_members m on m.group_id=g.id where m.user_id=p.id),'[]') as groups
 from public.profiles p join auth.users u on u.id=p.id
 where length(p_search)<=200 and (p_search='' or u.email ilike '%'||p_search||'%' or p.display_name ilike '%'||p_search||'%' or p.company ilike '%'||p_search||'%')
 order by p.created_at desc,p.id offset greatest(0,p_offset) limit 101
 ) x),'[]');
end$$;
revoke all on function public.member_admin_list(text,integer) from public,anon;
grant execute on function public.member_admin_list(text,integer) to authenticated;
notify pgrst,'reload schema';
commit;
