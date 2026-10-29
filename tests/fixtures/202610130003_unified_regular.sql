-- Current user policy: one PMOffice regular membership; 15 specialist VIP groups.
-- Previous migrations are preserved as deployment history. Apply 001 -> 002 -> 003.
begin;
create table public.unified_regular_memberships (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  status text not null check(status in ('active','suspended','revoked')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  granted_by uuid references auth.users(id) on delete set null,
  reason text not null check(length(btrim(reason)) between 1 and 2000),
  updated_at timestamptz not null default now(),
  check(status<>'active' or expires_at is null or expires_at>starts_at)
);
create table public.board_unified_regular_rules (
  board_id uuid primary key references public.boards(id) on delete cascade
);
create table public.post_unified_regular_rules (
  post_id uuid primary key references public.posts(id) on delete cascade
);
create table pmoffice_private.admin_identity_config (
  singleton boolean primary key default true check(singleton),
  allowed_user_id uuid references auth.users(id) on delete cascade,
  allowed_google_provider_id text,
  updated_at timestamptz not null default now(),
  check((allowed_user_id is null)=(allowed_google_provider_id is null))
);
-- Explicit operator bootstrap is required. No first-signup or email-only admin grant.
insert into pmoffice_private.admin_identity_config(singleton) values(true);
revoke all on pmoffice_private.admin_identity_config from public,anon,authenticated;

-- Merge existing regular rows using the intersection of their validity windows.
-- One blocked source prevents silently reviving any old regular membership.
insert into public.unified_regular_memberships(user_id,status,starts_at,expires_at,reason)
select user_id,
case when bool_or(status='revoked') then 'revoked'
when bool_or(status='suspended' or starts_at>statement_timestamp() or (expires_at is not null and expires_at<=statement_timestamp()))
or (min(expires_at) is not null and min(expires_at)<=max(starts_at)) then 'suspended'
else 'active' end,
max(starts_at),min(expires_at),'Conservative migration of legacy msp/ai/pm regular memberships'
from public.user_memberships where tier_id='regular' group by user_id;
insert into public.audit_log(actor_id,action,target_id,details)
select null,'membership.regular_unified_migration',u.user_id::text,
jsonb_build_object('legacy_rows',(select jsonb_agg(to_jsonb(old) order by old.membership_id)
from public.user_memberships old where old.user_id=u.user_id and old.tier_id='regular'),'unified',to_jsonb(u),'policy','revoked-first; blocked/expired/future suspended; latest start and earliest finite expiry')
from public.unified_regular_memberships u;

-- Every regular ACL becomes the shared PMOffice regular group.
insert into public.board_unified_regular_rules select distinct board_id from public.board_access_rules where tier_id='regular';
insert into public.post_unified_regular_rules select distinct post_id from public.post_access_rules where tier_id='regular';
-- Legacy minimum-regular also allowed same-field VIP+: preserve that allowance.
insert into public.board_access_rules(board_id,membership_id,tier_id,match_mode)
select board_id,membership_id,'vip','minimum' from public.board_access_rules where tier_id='regular' and match_mode='minimum' on conflict do nothing;
insert into public.post_access_rules(post_id,membership_id,tier_id,match_mode)
select post_id,membership_id,'vip','minimum' from public.post_access_rules where tier_id='regular' and match_mode='minimum' on conflict do nothing;
insert into public.audit_log(actor_id,action,details) values(null,'acl.regular_unified_migration',jsonb_build_object('board_rules',(select jsonb_agg(to_jsonb(r)) from public.board_access_rules r where tier_id='regular'),'post_rules',(select jsonb_agg(to_jsonb(r)) from public.post_access_rules r where tier_id='regular'),'same_field_vip_minimum_preserved',true));
delete from public.board_access_rules where tier_id='regular';
delete from public.post_access_rules where tier_id='regular';
delete from public.user_memberships where tier_id='regular';
delete from public.membership_tiers where id='regular';
-- The old 3x6 helper's 'regular' tier no longer exists. Remaining ranks 2..6 unchanged.

create or replace function pmoffice_private.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
select pmoffice_private.account_ok() and exists(
select 1 from pmoffice_private.admin_identity_config c
join public.admin_roles r on r.user_id=c.allowed_user_id
join auth.users u on u.id=r.user_id
join auth.identities i on i.user_id=u.id and i.provider='google' and i.provider_id=c.allowed_google_provider_id
where c.singleton and c.allowed_user_id=auth.uid()
and lower(u.email)='namwoongchan@gmail.com' and u.email_confirmed_at is not null
and lower(i.identity_data->>'email')='namwoongchan@gmail.com'
and i.identity_data->>'email_verified'='true'
and length(c.allowed_google_provider_id)>0)
$$;
create function pmoffice_private.has_unified_regular() returns boolean
language sql stable security definer set search_path='' as $$
select pmoffice_private.account_ok() and exists(select 1 from public.unified_regular_memberships u
where u.user_id=auth.uid() and u.status='active' and u.starts_at<=statement_timestamp()
and (u.expires_at is null or u.expires_at>statement_timestamp()))
$$;
create function pmoffice_private.has_course_membership(p_kind text) returns boolean
language sql stable security definer set search_path='' as $$
select pmoffice_private.has_unified_regular() or (pmoffice_private.account_ok() and pmoffice_private.matches_rule(p_kind,'vip','minimum'))
$$;
create or replace function pmoffice_private.can_read_board(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
select pmoffice_private.account_ok() and exists(select 1 from public.boards b where b.id=p_id and
(pmoffice_private.is_admin() or b.policy_mode='public' or (b.policy_mode='groups' and
((exists(select 1 from public.board_unified_regular_rules r where r.board_id=b.id) and pmoffice_private.has_unified_regular())
or exists(select 1 from public.board_access_rules r where r.board_id=b.id and pmoffice_private.matches_rule(r.membership_id,r.tier_id,r.match_mode))))))
$$;
create or replace function pmoffice_private.can_read_post(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
select pmoffice_private.account_ok() and exists(select 1 from public.posts p where p.id=p_id and
(pmoffice_private.is_admin() or (p.status='published' and pmoffice_private.can_read_board(p.board_id) and
(p.access_mode='inherit' or (p.access_mode='restrict' and (p.policy_mode='public' or (p.policy_mode='groups' and
((exists(select 1 from public.post_unified_regular_rules r where r.post_id=p.id) and pmoffice_private.has_unified_regular())
or exists(select 1 from public.post_access_rules r where r.post_id=p.id and pmoffice_private.matches_rule(r.membership_id,r.tier_id,r.match_mode))))))))))
$$;
create or replace function pmoffice_private.can_read_lesson(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from public.lessons l join public.courses c on c.id=l.course_id where l.id=p_id
and (pmoffice_private.is_admin() or (c.published and l.published and l.media_ready
and pmoffice_private.education_content_ready(l.id) and pmoffice_private.education_media_ready(l.id) and
(l.access_mode='preview' or (l.access_mode='member' and pmoffice_private.account_ok()
and exists(select 1 from public.enrollments e where e.user_id=auth.uid() and e.course_id=c.id)
and pmoffice_private.has_course_membership(c.membership_id)
and (l.post_id is null or pmoffice_private.can_read_post(l.post_id)))))))
$$;

alter table public.unified_regular_memberships enable row level security;
alter table public.board_unified_regular_rules enable row level security;
alter table public.post_unified_regular_rules enable row level security;
revoke all on public.unified_regular_memberships,public.board_unified_regular_rules,public.post_unified_regular_rules from anon,authenticated;
grant select on public.unified_regular_memberships,public.board_unified_regular_rules,public.post_unified_regular_rules to authenticated;
create policy own_unified_regular on public.unified_regular_memberships for select to authenticated using(user_id=auth.uid() or pmoffice_private.is_admin());
create policy board_unified_admin on public.board_unified_regular_rules for select to authenticated using(pmoffice_private.is_admin());
create policy post_unified_admin on public.post_unified_regular_rules for select to authenticated using(pmoffice_private.is_admin());

create function public.register_unified_regular() returns public.unified_regular_memberships
language plpgsql security definer set search_path='' as $$
declare result public.unified_regular_memberships;
begin
if not pmoffice_private.account_ok() then raise exception 'Accepted active account required' using errcode='42501'; end if;
perform 1 from public.profiles where id=auth.uid() for update;
if not pmoffice_private.account_ok() then raise exception 'Account changed' using errcode='42501'; end if;
select * into result from public.unified_regular_memberships where user_id=auth.uid() for update;
if result.user_id is not null then
if result.status<>'active' or result.starts_at>statement_timestamp() or (result.expires_at is not null and result.expires_at<=statement_timestamp()) then raise exception 'Existing regular membership requires administrator review' using errcode='42501'; end if;
return result;
end if;
insert into public.unified_regular_memberships(user_id,status,expires_at,reason) values(auth.uid(),'active',null,'PMOffice regular registration requested by accepted account') returning * into result;
insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'membership.unified_regular_registered',auth.uid()::text,jsonb_build_object('membership','PMOffice regular','expiry',null));
return result; end $$;
create function public.admin_set_unified_regular(p_user_id uuid,p_status text,p_expires_at timestamptz,p_reason text) returns public.unified_regular_memberships
language plpgsql security definer set search_path='' as $$
declare result public.unified_regular_memberships; previous jsonb;
begin
perform pmoffice_private.require_admin();
if p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then raise exception 'Reason required' using errcode='22023'; end if;
if not exists(select 1 from public.profiles where id=p_user_id) then raise exception 'Target profile required' using errcode='22023'; end if;
perform 1 from public.profiles where id=p_user_id for update;
select to_jsonb(u) into previous from public.unified_regular_memberships u where user_id=p_user_id for update;
insert into public.unified_regular_memberships(user_id,status,expires_at,granted_by,reason)
values(p_user_id,p_status,p_expires_at,auth.uid(),btrim(p_reason))
on conflict(user_id) do update set status=excluded.status,expires_at=excluded.expires_at,granted_by=auth.uid(),reason=excluded.reason,updated_at=now() returning * into result;
insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'membership.unified_regular_set',p_user_id::text,jsonb_build_object('before',previous,'after',to_jsonb(result)));
return result; end $$;

create or replace function public.enroll_course(p_course_id uuid) returns public.enrollments
language plpgsql security definer set search_path='' as $$
declare c public.courses; result public.enrollments;
begin
if not pmoffice_private.account_ok() then raise exception 'Accepted active account required' using errcode='42501'; end if;
perform 1 from public.profiles where id=auth.uid() for update;
if not pmoffice_private.account_ok() then raise exception 'Account changed' using errcode='42501'; end if;
select * into c from public.courses where id=p_course_id for share;
if c.id is null or not c.published or not c.auto_enroll then raise exception 'Auto-enrollment unavailable' using errcode='22023'; end if;
if not pmoffice_private.has_course_membership(c.membership_id) then raise exception 'PMOffice regular registration or valid specialist VIP membership required' using errcode='42501'; end if;
-- Never grant specialist tiers or revive a blocked regular row through enrollment.
insert into public.enrollments(user_id,course_id) values(auth.uid(),c.id) on conflict do nothing returning * into result;
if result.user_id is not null then insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'education.enrolled',c.id::text,jsonb_build_object('user_id',auth.uid(),'policy','unified regular or valid same-field VIP'));
else select * into result from public.enrollments where user_id=auth.uid() and course_id=c.id; end if;
return result; end $$;

create or replace function pmoffice_private.validate_rules(p_rules jsonb,p_mode text) returns void
language plpgsql security definer set search_path='' as $$
declare r jsonb; unified_count integer:=0;
begin
if p_mode is null or p_mode not in ('public','groups') then raise exception 'Invalid policy mode' using errcode='22023'; end if;
if p_rules is null or jsonb_typeof(p_rules)<>'array' then raise exception 'Rules array required' using errcode='22023'; end if;
if jsonb_array_length(p_rules)>31 then raise exception 'Too many rules' using errcode='22023'; end if;
if p_mode='groups' and jsonb_array_length(p_rules)=0 then raise exception 'Group policy requires rules' using errcode='22023'; end if;
if p_mode='public' and jsonb_array_length(p_rules)>0 then raise exception 'Public policy cannot have rules' using errcode='22023'; end if;
for r in select value from jsonb_array_elements(p_rules) loop
if jsonb_typeof(r)<>'object' then raise exception 'Invalid rule object' using errcode='22023'; end if;
if r->>'rule_type'='unified_regular' then
unified_count:=unified_count+1;
if unified_count>1 or r?'membership_id' or r?'tier_id' or r?'match_mode' then raise exception 'Unified rule has no field, tier or rank; one entry only' using errcode='22023'; end if;
elsif coalesce(r->>'rule_type','membership')='membership' then
if not exists(select 1 from public.membership_types where id=r->>'membership_id')
or not exists(select 1 from public.membership_tiers where id=r->>'tier_id')
or coalesce(r->>'match_mode','') not in ('exact','minimum') then raise exception 'Invalid VIP rule' using errcode='22023'; end if;
else raise exception 'Invalid rule type' using errcode='22023'; end if;
end loop; end $$;
create or replace function public.admin_save_board(p_payload jsonb) returns public.boards
language plpgsql security definer set search_path='' as $$
declare result public.boards; bid uuid; rules jsonb; previous jsonb;
begin
perform pmoffice_private.require_admin();
if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Object payload required' using errcode='22023'; end if;
rules:=coalesce(p_payload->'rules','[]'::jsonb);perform pmoffice_private.validate_rules(rules,p_payload->>'policy_mode');
bid:=nullif(p_payload->>'id','')::uuid;
if bid is null then insert into public.boards(slug,title,policy_mode) values(p_payload->>'slug',p_payload->>'title',p_payload->>'policy_mode') returning * into result;
else
select to_jsonb(b) into previous from public.boards b where id=bid for update;
update public.boards set slug=p_payload->>'slug',title=p_payload->>'title',policy_mode=p_payload->>'policy_mode',updated_at=now() where id=bid returning * into result;
if result.id is null then raise exception 'Board not found' using errcode='22023'; end if;
end if;
delete from public.board_access_rules where board_id=result.id;delete from public.board_unified_regular_rules where board_id=result.id;
insert into public.board_access_rules select result.id,r->>'membership_id',r->>'tier_id',r->>'match_mode' from jsonb_array_elements(rules) r where coalesce(r->>'rule_type','membership')='membership';
insert into public.board_unified_regular_rules select result.id from jsonb_array_elements(rules) r where r->>'rule_type'='unified_regular';
insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'board.saved',result.id::text,jsonb_build_object('before',previous,'after',to_jsonb(result),'rules',rules));
return result; end $$;
create or replace function public.admin_save_post(p_payload jsonb) returns public.posts
language plpgsql security definer set search_path='' as $$
declare result public.posts; pid uuid; rules jsonb; previous jsonb; v_access_mode text; v_policy_mode text;
begin
perform pmoffice_private.require_admin();
if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Object payload required' using errcode='22023'; end if;
v_access_mode:=coalesce(p_payload->>'access_mode','inherit');v_policy_mode:=coalesce(p_payload->>'policy_mode','groups');rules:=coalesce(p_payload->'rules','[]'::jsonb);
if v_access_mode='restrict' then perform pmoffice_private.validate_rules(rules,v_policy_mode);
elsif v_access_mode='inherit' then if rules<>'[]'::jsonb then raise exception 'Inherited post cannot have rules' using errcode='22023'; end if;
else raise exception 'Invalid access mode' using errcode='22023'; end if;
pid:=nullif(p_payload->>'id','')::uuid;
if pid is null then insert into public.posts(board_id,title,body,status,access_mode,policy_mode,created_by)
values((p_payload->>'board_id')::uuid,p_payload->>'title',coalesce(p_payload->>'body',''),coalesce(p_payload->>'status','draft'),v_access_mode,v_policy_mode,auth.uid()) returning * into result;
else
select to_jsonb(p) into previous from public.posts p where id=pid for update;
update public.posts set board_id=(p_payload->>'board_id')::uuid,title=p_payload->>'title',body=coalesce(p_payload->>'body',''),status=coalesce(p_payload->>'status','draft'),access_mode=v_access_mode,policy_mode=v_policy_mode,updated_at=now() where id=pid returning * into result;
if result.id is null then raise exception 'Post not found' using errcode='22023'; end if;
end if;
delete from public.post_access_rules where post_id=result.id;delete from public.post_unified_regular_rules where post_id=result.id;
insert into public.post_access_rules select result.id,r->>'membership_id',r->>'tier_id',r->>'match_mode' from jsonb_array_elements(rules) r where coalesce(r->>'rule_type','membership')='membership';
insert into public.post_unified_regular_rules select result.id from jsonb_array_elements(rules) r where r->>'rule_type'='unified_regular';
insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'post.saved',result.id::text,jsonb_build_object('before',previous-'body','after',to_jsonb(result)-'body','rules',rules));
return result; end $$;

revoke all on function pmoffice_private.has_unified_regular(),pmoffice_private.has_course_membership(text) from public,anon,authenticated;
revoke all on function public.register_unified_regular(),public.admin_set_unified_regular(uuid,text,timestamptz,text) from public,anon,authenticated;
grant execute on function public.register_unified_regular(),public.admin_set_unified_regular(uuid,text,timestamptz,text) to authenticated;
commit;
