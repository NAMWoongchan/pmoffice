-- PMOffice membership backend. Apply to a dedicated Supabase staging project first.
begin;
create schema if not exists pmoffice_private;
revoke all on schema pmoffice_private from public;
grant usage on schema pmoffice_private to authenticated;

create table pmoffice_private.service_settings (
  singleton boolean primary key default true check (singleton),
  signup_version text not null check (length(signup_version) between 1 and 100)
);
insert into pmoffice_private.service_settings values (true, 'v1.0');
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  status text not null default 'active' check (status in ('active','suspended')),
  signup_accepted_at timestamptz,
  signup_version text,
  created_at timestamptz not null default now(),
  check ((signup_accepted_at is null) = (signup_version is null))
);
create table public.admin_roles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.membership_types (id text primary key, name text not null);
insert into public.membership_types values ('msp','MS Project'),('ai','AI'),('pm','PM 실무');
create table public.membership_tiers (id text primary key, name text not null, rank integer not null unique check(rank between 1 and 6));
insert into public.membership_tiers values ('regular','정회원',1),('vip','VIP',2),('vip-plus','VIP+',3),('vvip','VVIP',4),('premium','프리미엄',5),('prestige','프레스티지',6);
create table public.user_memberships (
  user_id uuid not null references public.profiles(id) on delete cascade,
  membership_id text not null references public.membership_types(id),
  tier_id text not null references public.membership_tiers(id),
  status text not null check (status in ('active','suspended','revoked')),
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  granted_by uuid references auth.users(id) on delete set null,
  reason text not null check(length(reason) between 1 and 2000),
  updated_at timestamptz not null default now(),
  primary key(user_id,membership_id),
  check(expires_at is null or expires_at > starts_at)
);
create table public.membership_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  membership_id text not null references public.membership_types(id),
  status text not null default 'pending' check(status in ('pending','approved','rejected')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  reason text,
  check((status = 'pending') = (reviewed_at is null))
);
create unique index membership_requests_one_pending on public.membership_requests(user_id,membership_id) where status='pending';
create index membership_requests_admin_queue on public.membership_requests(status,created_at);
create table public.boards (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check(slug ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  title text not null check(length(title) between 1 and 200),
  policy_mode text not null check(policy_mode in ('public','groups')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.board_access_rules (
  board_id uuid not null references public.boards(id) on delete cascade,
  membership_id text not null references public.membership_types(id),
  tier_id text not null references public.membership_tiers(id),
  match_mode text not null check(match_mode in ('exact','minimum')),
  primary key(board_id,membership_id,tier_id,match_mode)
);
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  board_id uuid not null references public.boards(id) on delete restrict,
  title text not null check(length(title) between 1 and 200),
  body text not null default '' check(length(body)<=1000000),
  status text not null default 'draft' check(status in ('draft','published')),
  access_mode text not null default 'inherit' check(access_mode in ('inherit','restrict')),
  policy_mode text not null default 'groups' check(policy_mode in ('public','groups')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index posts_board_status on public.posts(board_id,status,created_at desc);
create table public.post_access_rules (
  post_id uuid not null references public.posts(id) on delete cascade,
  membership_id text not null references public.membership_types(id),
  tier_id text not null references public.membership_tiers(id),
  match_mode text not null check(match_mode in ('exact','minimum')),
  primary key(post_id,membership_id,tier_id,match_mode)
);
create table public.attachments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.posts(id) on delete cascade,
  object_path text not null unique,
  file_name text not null check(length(file_name) between 1 and 255 and file_name !~ '[\r\n]'),
  content_type text not null default 'application/octet-stream',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check(object_path ~ '^posts/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|docx|xlsx|pptx|txt|csv|png|jpg|jpeg|webp|zip)$')
);
create index attachments_post on public.attachments(post_id);
create table public.audit_log (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  target_id text,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index audit_log_time on public.audit_log(created_at desc);

create function pmoffice_private.on_auth_user() returns trigger
language plpgsql security definer set search_path='' as $$
begin insert into public.profiles(id) values(new.id) on conflict do nothing; return new; end $$;
create trigger pmoffice_new_auth_user after insert on auth.users for each row execute function pmoffice_private.on_auth_user();
insert into public.profiles(id) select id from auth.users on conflict do nothing;

create function pmoffice_private.account_ok() returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from public.profiles p join pmoffice_private.service_settings s on s.singleton
where p.id=auth.uid() and p.status='active' and p.signup_accepted_at is not null and p.signup_version=s.signup_version)
$$;
create function pmoffice_private.is_admin() returns boolean
language sql stable security definer set search_path='' as $$
select pmoffice_private.account_ok() and exists(select 1 from public.admin_roles where user_id=auth.uid())
$$;
create function public.is_admin() returns boolean
language sql stable security definer set search_path='' as $$ select pmoffice_private.is_admin() $$;
create function pmoffice_private.matches_rule(p_kind text,p_tier text,p_mode text) returns boolean
language sql stable security definer set search_path='' as $$
select exists(select 1 from public.user_memberships u
join public.membership_tiers own_t on own_t.id=u.tier_id
join public.membership_tiers required_t on required_t.id=p_tier
where u.user_id=auth.uid() and u.membership_id=p_kind and u.status='active'
and u.starts_at<=statement_timestamp() and (u.expires_at is null or u.expires_at>statement_timestamp())
and ((p_mode='exact' and u.tier_id=p_tier) or (p_mode='minimum' and own_t.rank>=required_t.rank)))
$$;
create function pmoffice_private.can_read_board(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
select pmoffice_private.account_ok() and exists(select 1 from public.boards b where b.id=p_id and
(pmoffice_private.is_admin() or b.policy_mode='public' or (b.policy_mode='groups' and exists
(select 1 from public.board_access_rules r where r.board_id=b.id and pmoffice_private.matches_rule(r.membership_id,r.tier_id,r.match_mode)))))
$$;
create function pmoffice_private.can_read_post(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
select pmoffice_private.account_ok() and exists(select 1 from public.posts p where p.id=p_id and
(pmoffice_private.is_admin() or (p.status='published' and pmoffice_private.can_read_board(p.board_id) and
(p.access_mode='inherit' or (p.access_mode='restrict' and (p.policy_mode='public' or (p.policy_mode='groups' and exists
(select 1 from public.post_access_rules r where r.post_id=p.id and pmoffice_private.matches_rule(r.membership_id,r.tier_id,r.match_mode)))))))))
$$;
create function pmoffice_private.require_admin() returns void
language plpgsql stable security definer set search_path='' as $$
begin if not pmoffice_private.is_admin() then raise exception 'Administrator required' using errcode='42501'; end if; end $$;

-- No direct mutation privileges: all membership/content changes use audited RPCs.
do $$ declare t text; begin
foreach t in array array['profiles','admin_roles','membership_types','membership_tiers','user_memberships','membership_requests','boards','board_access_rules','posts','post_access_rules','attachments','audit_log'] loop
execute format('alter table public.%I enable row level security',t);
execute format('revoke all on table public.%I from anon,authenticated',t);
execute format('grant select on table public.%I to authenticated',t);
end loop; end $$;
create policy own_profile on public.profiles for select to authenticated using(id=auth.uid() or pmoffice_private.is_admin());
create policy own_admin_role on public.admin_roles for select to authenticated using(user_id=auth.uid() and pmoffice_private.is_admin());
create policy catalog_membership on public.membership_types for select to authenticated using(true);
create policy catalog_tiers on public.membership_tiers for select to authenticated using(true);
create policy own_memberships on public.user_memberships for select to authenticated using(user_id=auth.uid() or pmoffice_private.is_admin());
create policy own_requests on public.membership_requests for select to authenticated using(user_id=auth.uid() or pmoffice_private.is_admin());
create policy readable_board on public.boards for select to authenticated using(pmoffice_private.can_read_board(id));
create policy readable_post on public.posts for select to authenticated using(pmoffice_private.can_read_post(id));
create policy board_rules_admin on public.board_access_rules for select to authenticated using(pmoffice_private.is_admin());
create policy post_rules_admin on public.post_access_rules for select to authenticated using(pmoffice_private.is_admin());
create policy readable_attachment on public.attachments for select to authenticated using(pmoffice_private.can_read_post(post_id));
create policy audit_admin on public.audit_log for select to authenticated using(pmoffice_private.is_admin());

create function public.accept_signup(p_version text) returns public.profiles
language plpgsql security definer set search_path='' as $$
declare result public.profiles;
begin
if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
if not exists(select 1 from pmoffice_private.service_settings where signup_version=p_version) then raise exception 'Invalid signup version' using errcode='22023'; end if;
select * into result from public.profiles where id=auth.uid() for update;
if result.id is null or result.status<>'active' then raise exception 'Active account required' using errcode='42501'; end if;
if result.signup_version is distinct from p_version then
update public.profiles set signup_accepted_at=now(),signup_version=p_version where id=auth.uid() returning * into result;
insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'signup.accepted',auth.uid()::text,jsonb_build_object('version',p_version));
end if;
return result; end $$;
create function public.request_membership(p_kind text) returns public.membership_requests
language plpgsql security definer set search_path='' as $$
declare result public.membership_requests;
begin
if not pmoffice_private.account_ok() then raise exception 'Accepted active account required' using errcode='42501'; end if;
if not exists(select 1 from public.membership_types where id=p_kind) then raise exception 'Invalid membership' using errcode='22023'; end if;
insert into public.membership_requests(user_id,membership_id) values(auth.uid(),p_kind)
on conflict(user_id,membership_id) where status='pending' do update set membership_id=excluded.membership_id returning * into result;
return result; end $$;
create function public.admin_set_membership(p_user_id uuid,p_kind text,p_tier text,p_status text,p_expires_at timestamptz,p_reason text,p_request_id uuid default null) returns public.user_memberships
language plpgsql security definer set search_path='' as $$
declare result public.user_memberships; req public.membership_requests; previous jsonb;
begin
perform pmoffice_private.require_admin();
if p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then raise exception 'Reason required' using errcode='22023'; end if;
if not exists(select 1 from public.profiles where id=p_user_id and status='active' and signup_accepted_at is not null) then raise exception 'Target account must have accepted signup and be active' using errcode='22023'; end if;
if p_request_id is not null then
select * into req from public.membership_requests where id=p_request_id for update;
if req.id is null or req.status<>'pending' or req.user_id<>p_user_id or req.membership_id<>p_kind or p_status<>'active' then raise exception 'Pending request mismatch' using errcode='22023'; end if;
end if;
select to_jsonb(u) into previous from public.user_memberships u where user_id=p_user_id and membership_id=p_kind for update;
insert into public.user_memberships(user_id,membership_id,tier_id,status,expires_at,granted_by,reason)
values(p_user_id,p_kind,p_tier,p_status,p_expires_at,auth.uid(),btrim(p_reason))
on conflict(user_id,membership_id) do update set tier_id=excluded.tier_id,status=excluded.status,expires_at=excluded.expires_at,granted_by=auth.uid(),reason=excluded.reason,updated_at=now() returning * into result;
if p_request_id is not null then update public.membership_requests set status='approved',reviewed_at=now(),reviewed_by=auth.uid(),reason=btrim(p_reason) where id=p_request_id; end if;
insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'membership.set',p_user_id::text,jsonb_build_object('before',previous,'after',to_jsonb(result),'request_id',p_request_id));
return result; end $$;
create function public.admin_reject_request(p_id uuid,p_reason text) returns public.membership_requests
language plpgsql security definer set search_path='' as $$
declare result public.membership_requests;
begin
perform pmoffice_private.require_admin();
if p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then raise exception 'Reason required' using errcode='22023'; end if;
update public.membership_requests set status='rejected',reviewed_at=now(),reviewed_by=auth.uid(),reason=btrim(p_reason) where id=p_id and status='pending' returning * into result;
if result.id is null then raise exception 'Pending request not found' using errcode='22023'; end if;
insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'request.rejected',p_id::text,jsonb_build_object('reason',btrim(p_reason)));
return result; end $$;
create function public.admin_set_account_status(p_user_id uuid,p_status text,p_reason text) returns public.profiles
language plpgsql security definer set search_path='' as $$
declare result public.profiles;
begin
perform pmoffice_private.require_admin();
if p_user_id=auth.uid() then raise exception 'Self account status changes are disabled' using errcode='22023'; end if;
if p_reason is null or length(btrim(p_reason)) not between 1 and 2000 then raise exception 'Reason required' using errcode='22023'; end if;
update public.profiles set status=p_status where id=p_user_id returning * into result;
if result.id is null then raise exception 'Account not found' using errcode='22023'; end if;
insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'account.status',p_user_id::text,jsonb_build_object('status',p_status,'reason',btrim(p_reason)));
return result; end $$;

-- Validated JSON rules are replaced atomically with content writes.
create function pmoffice_private.validate_rules(p_rules jsonb,p_mode text) returns void
language plpgsql security definer set search_path='' as $$
declare r jsonb;
begin
if p_mode not in ('public','groups') or p_mode is null then raise exception 'Invalid policy mode' using errcode='22023'; end if;
if p_rules is null or jsonb_typeof(p_rules)<>'array' or jsonb_array_length(p_rules)>18 then raise exception 'Rules must be an array of up to 18 entries' using errcode='22023'; end if;
if p_mode='groups' and jsonb_array_length(p_rules)=0 then raise exception 'Group policy requires rules' using errcode='22023'; end if;
if p_mode='public' and jsonb_array_length(p_rules)>0 then raise exception 'Public policy cannot have group rules' using errcode='22023'; end if;
for r in select value from jsonb_array_elements(p_rules) loop
if jsonb_typeof(r)<>'object' or not exists(select 1 from public.membership_types where id=r->>'membership_id')
or not exists(select 1 from public.membership_tiers where id=r->>'tier_id')
or coalesce(r->>'match_mode','') not in ('exact','minimum') then raise exception 'Invalid access rule' using errcode='22023'; end if;
end loop; end $$;
create function public.admin_save_board(p_payload jsonb) returns public.boards
language plpgsql security definer set search_path='' as $$
declare result public.boards; bid uuid; rules jsonb; previous jsonb;
begin
perform pmoffice_private.require_admin();
if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Object payload required' using errcode='22023'; end if;
rules:=coalesce(p_payload->'rules','[]'::jsonb); perform pmoffice_private.validate_rules(rules,p_payload->>'policy_mode');
bid:=nullif(p_payload->>'id','')::uuid;
if bid is null then
insert into public.boards(slug,title,policy_mode) values(p_payload->>'slug',p_payload->>'title',p_payload->>'policy_mode') returning * into result;
else
select to_jsonb(b) into previous from public.boards b where id=bid for update;
update public.boards set slug=p_payload->>'slug',title=p_payload->>'title',policy_mode=p_payload->>'policy_mode',updated_at=now() where id=bid returning * into result;
if result.id is null then raise exception 'Board not found' using errcode='22023'; end if;
end if;
delete from public.board_access_rules where board_id=result.id;
insert into public.board_access_rules select result.id,r->>'membership_id',r->>'tier_id',r->>'match_mode' from jsonb_array_elements(rules) r;
insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'board.saved',result.id::text,jsonb_build_object('before',previous,'after',to_jsonb(result),'rules',rules));
return result; end $$;
create function public.admin_save_post(p_payload jsonb) returns public.posts
language plpgsql security definer set search_path='' as $$
declare result public.posts; pid uuid; rules jsonb; previous jsonb; v_access_mode text; v_policy_mode text;
begin
perform pmoffice_private.require_admin();
if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Object payload required' using errcode='22023'; end if;
v_access_mode:=coalesce(p_payload->>'access_mode','inherit'); v_policy_mode:=coalesce(p_payload->>'policy_mode','groups'); rules:=coalesce(p_payload->'rules','[]'::jsonb);
if v_access_mode='restrict' then perform pmoffice_private.validate_rules(rules,v_policy_mode);
elsif v_access_mode='inherit' then
if rules<>'[]'::jsonb then raise exception 'Inherited post cannot have rules' using errcode='22023'; end if;
else raise exception 'Invalid access mode' using errcode='22023'; end if;
pid:=nullif(p_payload->>'id','')::uuid;
if pid is null then
insert into public.posts(board_id,title,body,status,access_mode,policy_mode,created_by)
values((p_payload->>'board_id')::uuid,p_payload->>'title',coalesce(p_payload->>'body',''),coalesce(p_payload->>'status','draft'),v_access_mode,v_policy_mode,auth.uid()) returning * into result;
else
select to_jsonb(p) into previous from public.posts p where id=pid for update;
update public.posts set board_id=(p_payload->>'board_id')::uuid,title=p_payload->>'title',body=coalesce(p_payload->>'body',''),status=coalesce(p_payload->>'status','draft'),access_mode=v_access_mode,policy_mode=v_policy_mode,updated_at=now() where id=pid returning * into result;
if result.id is null then raise exception 'Post not found' using errcode='22023'; end if;
end if;
delete from public.post_access_rules where post_id=result.id;
insert into public.post_access_rules select result.id,r->>'membership_id',r->>'tier_id',r->>'match_mode' from jsonb_array_elements(rules) r;
-- Avoid copying potentially private article bodies into audit payloads.
insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'post.saved',result.id::text,jsonb_build_object('before',previous-'body','after',to_jsonb(result)-'body','rules',rules));
return result; end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('member-files','member-files',false,20971520,
array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/vnd.openxmlformats-officedocument.presentationml.presentation','text/plain','text/csv','image/png','image/jpeg','image/webp','application/zip','application/octet-stream']);
-- Members cannot access storage directly, create signed URLs or enumerate object paths.
-- Admin insert is limited to existing post routes and immutable unique object names.
create function pmoffice_private.valid_upload_path(p_name text) returns boolean
language sql stable security definer set search_path='' as $$
select pmoffice_private.is_admin() and case when p_name ~ '^posts/[0-9a-f-]{36}/[0-9a-f-]{36}\.(pdf|docx|xlsx|pptx|txt|csv|png|jpg|jpeg|webp|zip)$'
then exists(select 1 from public.posts where id::text=split_part(p_name,'/',2)) else false end
$$;
create policy pmoffice_admin_upload on storage.objects for insert to authenticated
with check(bucket_id='member-files' and pmoffice_private.valid_upload_path(name));

create function public.admin_attach_file(p_payload jsonb) returns public.attachments
language plpgsql security definer set search_path='' as $$
declare result public.attachments; pid uuid; obj text; metadata jsonb;
begin
perform pmoffice_private.require_admin();
if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Object payload required' using errcode='22023'; end if;
pid:=(p_payload->>'post_id')::uuid; obj:=p_payload->>'object_path';
if not pmoffice_private.valid_upload_path(obj) or split_part(obj,'/',2)<>pid::text then raise exception 'Invalid attachment route' using errcode='22023'; end if;
select o.metadata into metadata from storage.objects o where bucket_id='member-files' and name=obj;
if metadata is null then raise exception 'Upload the object before registering attachment' using errcode='22023'; end if;
insert into public.attachments(post_id,object_path,file_name,content_type,created_by)
values(pid,obj,p_payload->>'file_name',coalesce(metadata->>'mimetype','application/octet-stream'),auth.uid()) returning * into result;
insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'attachment.registered',result.id::text,to_jsonb(result));
return result; end $$;

-- Lock down SECURITY DEFINER functions (Postgres grants EXECUTE to PUBLIC by default).
revoke all on all functions in schema pmoffice_private from public,anon,authenticated;
grant execute on function pmoffice_private.account_ok(),pmoffice_private.is_admin(),pmoffice_private.can_read_board(uuid),pmoffice_private.can_read_post(uuid),pmoffice_private.valid_upload_path(text) to authenticated;
revoke all on function public.is_admin(),public.accept_signup(text),public.request_membership(text),public.admin_set_membership(uuid,text,text,text,timestamptz,text,uuid),public.admin_reject_request(uuid,text),public.admin_set_account_status(uuid,text,text),public.admin_save_board(jsonb),public.admin_save_post(jsonb),public.admin_attach_file(jsonb) from public,anon,authenticated;
grant execute on function public.is_admin(),public.accept_signup(text),public.request_membership(text),public.admin_set_membership(uuid,text,text,text,timestamptz,text,uuid),public.admin_reject_request(uuid,text),public.admin_set_account_status(uuid,text,text),public.admin_save_board(jsonb),public.admin_save_post(jsonb),public.admin_attach_file(jsonb) to authenticated;
commit;
