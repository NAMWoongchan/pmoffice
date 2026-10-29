-- PMOffice: common member account, group-only projects and private knowledge.
-- Prerequisite: existing membership + inquiry + PMS migrations. Never re-run old migrations.
begin;
alter table public.profiles add column display_name text not null default '';
alter table public.profiles add column company text not null default '';
alter table public.profiles add column member_kind text not null default 'individual' check(member_kind in('business','individual'));
alter table public.profiles add column registration_source text not null default 'legacy' check(registration_source in('legacy','self','google','admin'));
alter table public.profiles add column registered_by uuid references auth.users(id);
alter table public.profiles add column registered_at timestamptz;
alter table public.profiles add column registration_version text;
alter table public.profiles add column withdrawn_at timestamptz;
alter table public.profiles add column credential_version integer not null default 0;
alter table public.profiles add constraint member_profile_lengths check(length(display_name)<=120 and length(company)<=200);

alter table pmoffice_private.service_settings add column member_signup_version text not null default 'member-v1.1';
alter table public.profiles alter column registration_source set default 'self';

create or replace function pmoffice_private.account_ok() returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join auth.users u on u.id=p.id
 join pmoffice_private.service_settings s on s.singleton where p.id=auth.uid() and p.status='active' and p.withdrawn_at is null
 and (u.banned_until is null or u.banned_until<=statement_timestamp()) and
 ((p.registration_source='legacy' and p.signup_accepted_at is not null and p.signup_version=s.signup_version)
 or (p.registration_source in('self','google') and p.registered_at is not null and p.signup_accepted_at is not null and p.signup_version=s.member_signup_version)
 or (p.registration_source='admin' and p.registered_at is not null and p.registered_by is not null and p.registration_version=s.member_signup_version)))
$$;

create table public.member_documents(
 path text primary key check(path ~ '^/[A-Za-z0-9/_-]+\.html$'),
 title text not null check(length(title) between 1 and 200), category text not null,
 body_html text not null check(length(body_html)<=2000000), body_text text not null,
 toc jsonb not null default '[]', source_sha256 text not null check(source_sha256 ~ '^[0-9a-f]{64}$'),
 linked_post_id uuid references public.posts(id), published boolean not null default true,
 updated_at timestamptz not null default now()
);
create table public.member_document_media(
 object_path text primary key check(object_path ~ '^documents/[a-z0-9-]+/[a-zA-Z0-9_.-]+\.(png|webp|jpg|jpeg|gif|svg|pdf|zip|txt|ps1)$'),
 document_path text not null references public.member_documents(path),
 sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$')
);
create function pmoffice_private.member_document_allowed(p_path text) returns boolean
language sql stable security definer set search_path='' as $$
 select pmoffice_private.account_ok() and exists(select 1 from public.member_documents d where d.path=p_path
 and (pmoffice_private.is_admin() or (d.published and (d.linked_post_id is null or pmoffice_private.can_read_post(d.linked_post_id)))))
$$;
alter table public.member_documents enable row level security;
alter table public.member_document_media enable row level security;
revoke all on public.member_documents,public.member_document_media from public,anon,authenticated;
grant select on public.member_documents,public.member_document_media to authenticated;
create policy member_document_read on public.member_documents for select to authenticated using(pmoffice_private.member_document_allowed(path));
create policy member_document_media_read on public.member_document_media for select to authenticated using(pmoffice_private.member_document_allowed(document_path));

create table public.member_mail_jobs(
 id uuid primary key default gen_random_uuid(), request_id uuid not null unique,
 actor_id uuid references auth.users(id), kind text not null check(kind in('manual','signup_admin')),
 target_groups uuid[] not null default '{}', target_users uuid[] not null default '{}',
 subject text not null check(length(subject) between 1 and 200), body text not null check(length(body) between 1 and 50000),
 created_at timestamptz not null default now(), signup_user_id uuid unique references auth.users(id)
);
create table public.member_mail_messages(
 id uuid primary key default gen_random_uuid(), job_id uuid not null references public.member_mail_jobs(id),
 user_id uuid references auth.users(id), recipient text not null,
 state text not null default 'queued' check(state in('queued','sending','sent','failed','unknown','cancelled')),
 claim_id uuid, error text, updated_at timestamptz not null default now(), unique(job_id,recipient)
);
create table pmoffice_private.member_mail_nonces(nonce text primary key,created_at timestamptz not null default now());
alter table pmoffice_private.member_mail_nonces enable row level security;
create table public.member_admin_operations(
 request_id uuid primary key, actor_id uuid not null references auth.users(id), action text not null,
 target_id uuid references auth.users(id) on delete set null,
 state text not null default 'started' check(state in('started','complete','failed','recovery_required')),
 updated_at timestamptz not null default now()
);
alter table public.member_mail_jobs enable row level security;
alter table public.member_mail_messages enable row level security;
alter table public.member_admin_operations enable row level security;
revoke all on public.member_mail_jobs,public.member_mail_messages,public.member_admin_operations,pmoffice_private.member_mail_nonces from public,anon,authenticated;

create function pmoffice_private.member_validate(p_name text,p_company text,p_kind text) returns void
language plpgsql set search_path='' as $$
begin
 if p_name is null or length(trim(p_name)) not between 1 and 120 or p_company is null or length(trim(p_company))>200
 or p_kind is null or p_kind not in('business','individual') or (p_kind='business' and length(trim(p_company))=0) then
 raise exception '이름과 회원 구분, 회사·소속을 확인해 주세요.' using errcode='22023';end if;
end$$;
create function pmoffice_private.member_signup_notice(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
declare p public.profiles; email text; job uuid;
begin
 select * into strict p from public.profiles where id=p_user;
 select u.email into email from auth.users u where id=p_user;
 insert into public.member_mail_jobs(request_id,kind,subject,body,signup_user_id)
 values(gen_random_uuid(),'signup_admin','[피엠오피스] 새 회원 가입',
 '이름: '||p.display_name||E'\n이메일: '||email||E'\n회사·소속: '||p.company||E'\n가입 경로: '||p.registration_source||E'\n회원 관리: https://pmoffice.co.kr/admin/#members',p_user)
 on conflict(signup_user_id) do nothing returning id into job;
 if job is not null then insert into public.member_mail_messages(job_id,recipient) values(job,'namwoongchan@gmail.com');end if;
end$$;

create function public.member_complete_registration(p_name text,p_company text,p_kind text,p_accept boolean) returns void
language plpgsql security definer set search_path='' as $$
declare p public.profiles; v text; src text;
begin
 if auth.uid() is null or p_accept is distinct from true then raise insufficient_privilege;end if;
 perform pmoffice_private.member_validate(p_name,p_company,p_kind);
 select * into strict p from public.profiles where id=auth.uid() for update;
 if p.status<>'active' or p.withdrawn_at is not null then raise insufficient_privilege;end if;
 if p.registered_at is not null then return;end if;
 select member_signup_version into v from pmoffice_private.service_settings where singleton;
 src:=case when exists(select 1 from auth.identities where user_id=auth.uid() and provider='google') then 'google' else 'self' end;
 update public.profiles set display_name=trim(p_name),company=trim(p_company),member_kind=p_kind,
 signup_accepted_at=now(),signup_version=v,registered_at=now(),registration_source=src,registration_version=v where id=auth.uid();
 insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'member.register',auth.uid()::text,jsonb_build_object('source',src,'consent_version',v));
 perform pmoffice_private.member_signup_notice(auth.uid());
end$$;

create function public.member_account() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.profiles; email text; ok boolean;
begin
 if auth.uid() is null then return jsonb_build_object('signed_in',false,'member',false,'admin',false);end if;
 select * into p from public.profiles where id=auth.uid();
 select u.email into email from auth.users u where u.id=auth.uid();
 ok:=coalesce(pmoffice_private.account_ok(),false);
 return jsonb_build_object('signed_in',true,'member',ok,'admin',coalesce(pmoffice_private.is_admin(),false),'profile',to_jsonb(p)||jsonb_build_object('email',email),
 'signup_version',(select member_signup_version from pmoffice_private.service_settings where singleton));
end$$;

create function public.member_profile_save(p_user uuid,p_name text,p_company text,p_kind text) returns void
language plpgsql security definer set search_path='' as $$
declare a boolean:=coalesce(pmoffice_private.is_admin(),false);
begin
 if not a and (p_user is distinct from auth.uid() or not coalesce(pmoffice_private.account_ok(),false)) then raise insufficient_privilege;end if;
 perform pmoffice_private.member_validate(p_name,p_company,p_kind);
 update public.profiles set display_name=trim(p_name),company=trim(p_company),member_kind=p_kind where id=p_user;
 if not found then raise exception '회원이 없습니다.';end if;
 insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'member.profile',p_user::text);
end$$;
create function public.member_admin_register(p_user uuid,p_name text,p_company text,p_kind text) returns void
language plpgsql security definer set search_path='' as $$
declare v text;
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 perform pmoffice_private.member_validate(p_name,p_company,p_kind);
 if not exists(select 1 from auth.users where id=p_user and raw_app_meta_data->>'member_created_by'=auth.uid()::text) then raise insufficient_privilege;end if;
 select member_signup_version into v from pmoffice_private.service_settings where singleton;
 update public.profiles set display_name=trim(p_name),company=trim(p_company),member_kind=p_kind,
 registered_at=now(),registered_by=auth.uid(),registration_version=v,registration_source='admin'
 where id=p_user and registered_at is null and status='active' and withdrawn_at is null;
 if found then
 insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'member.admin_register',p_user::text,'{"member_consent_recorded":false}');
 perform pmoffice_private.member_signup_notice(p_user);
 end if;
end$$;

create function public.member_admin_list(p_search text default '',p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (select p.*,u.email,
 coalesce((select jsonb_agg(jsonb_build_object('id',g.id,'name',g.name,'active',g.active and m.active)) from public.pms_groups g join public.pms_group_members m on m.group_id=g.id where m.user_id=p.id),'[]') as groups
 from public.profiles p join auth.users u on u.id=p.id where length(p_search)<=200 and
 (p_search='' or u.email ilike '%'||p_search||'%' or p.display_name ilike '%'||p_search||'%' or p.company ilike '%'||p_search||'%')
 order by p.created_at desc,p.id offset greatest(0,p_offset) limit 51) x),'[]');
end$$;
create function public.member_admin_withdraw(p_user uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) or p_user=auth.uid() or exists(select 1 from public.admin_roles where user_id=p_user) then raise insufficient_privilege;end if;
 update public.profiles set status='suspended',withdrawn_at=coalesce(withdrawn_at,now()),credential_version=credential_version+1 where id=p_user;
 if not found then raise exception '회원이 없습니다.';end if;
 update public.pms_group_members set active=false where user_id=p_user;
 update public.pms_members set active=false,updated_at=now() where user_id=p_user;
 update public.member_mail_messages set state='cancelled',error='회원 이용 중지',updated_at=now() where user_id=p_user and state='queued';
 insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'member.withdraw',p_user::text);
end$$;
create function public.member_operation(p_request uuid,p_action text,p_target uuid default null,p_state text default 'started') returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.member_admin_operations;
begin
 if not coalesce(pmoffice_private.is_admin(),false) or p_action not in('create','update','password','withdraw') or p_state not in('started','complete','failed','recovery_required') then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into o from public.member_admin_operations where request_id=p_request for update;
 if found then
 if o.actor_id<>auth.uid() or o.action<>p_action then raise insufficient_privilege;end if;
 if o.state='complete' then return to_jsonb(o);end if;
 update public.member_admin_operations set target_id=coalesce(p_target,target_id),state=p_state,updated_at=now() where request_id=p_request returning * into o;
 else insert into public.member_admin_operations(request_id,actor_id,action,target_id,state) values(p_request,auth.uid(),p_action,p_target,p_state) returning * into o;end if;
 if p_state in('complete','recovery_required') then insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'member.admin_'||p_action,coalesce(o.target_id::text,p_request::text),jsonb_build_object('state',p_state,'request_id',p_request));end if;
 return to_jsonb(o);
end$$;
create function public.member_admin_history() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (select * from (select 'member-'||id::text as id,actor_id,action,target_id,created_at,'recorded'::text as state from public.audit_log where action like 'member.%' union all select 'pms-'||id::text,actor,'pms.'||action,project_slug,created_at,'recorded' from public.pms_audit union all select 'operation-'||request_id::text,actor_id,'member.operation.'||action,coalesce(target_id::text,request_id::text),updated_at,state from public.member_admin_operations where state in('failed','recovery_required')) events order by created_at desc limit 200) x),'[]');
end$$;

-- Only active group grants determine project access. No title/description leak from listed.
alter table public.pms_group_members add column expires_at timestamptz;
alter table public.pms_projects alter column access_mode set default 'assigned';
create table pmoffice_private.member_access_migration_backup as
 select 'project'::text as kind,to_jsonb(p) as snapshot from public.pms_projects p union all select 'person',to_jsonb(m) from public.pms_members m;
alter table pmoffice_private.member_access_migration_backup enable row level security;
revoke all on pmoffice_private.member_access_migration_backup from public,anon,authenticated;
do $$declare p record; m record; gid uuid;begin
 for p in select distinct project_slug from public.pms_members loop
  for m in select * from public.pms_members where project_slug=p.project_slug loop
   -- Separate migration groups preserve each person's role and expiration exactly.
   insert into public.pms_groups(name,active) values('기존 권한 전환 · '||p.project_slug||' · '||left(m.user_id::text,8),m.active) returning id into gid;
   insert into public.pms_group_members(group_id,user_id,active,expires_at) values(gid,m.user_id,m.active,m.expires_at);
   insert into public.pms_group_grants(project_slug,group_id,role,active,expires_at) values(p.project_slug,gid,m.role,m.active,m.expires_at);
  end loop;
 end loop;
 update public.pms_members set active=false,updated_at=now();
 update public.pms_projects set access_mode='assigned',listed=false,version=version+1,updated_at=now();
end$$;
create or replace function public.pms_access(p_slug text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.pms_projects; a boolean:=coalesce(pmoffice_private.is_admin(),false); r boolean:=false; e boolean:=false;
begin
 select * into p from public.pms_projects where slug=p_slug;
 if found then
 if a then r:=true;e:=true;
 elsif p.status='published' and coalesce(pmoffice_private.account_ok(),false) then
 select count(*)>0,coalesce(bool_or(x.role='editor'),false) into r,e from public.pms_group_grants x
 join public.pms_groups g on g.id=x.group_id and g.active
 join public.pms_group_members m on m.group_id=g.id and m.user_id=auth.uid() and m.active and (m.expires_at is null or m.expires_at>now())
 where x.project_slug=p_slug and x.active and (x.expires_at is null or x.expires_at>now());
 end if;end if;
 if not r then return jsonb_build_object('allowed',false,'admin',a,'canRead',false,'canPublish',false,'canManage',a);end if;
 return jsonb_build_object('allowed',true,'admin',a,'canRead',true,'canPublish',e,'canManage',a,'project',to_jsonb(p));
end$$;
create or replace function public.pms_catalog() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(p) order by p.customer,p.title),'[]') from public.pms_projects p where coalesce((public.pms_access(p.slug)->>'canRead')::boolean,false)
$$;
create or replace function public.pms_account() returns jsonb
language sql stable security definer set search_path='' as $$ select public.member_account()||jsonb_build_object('user_id',auth.uid()) $$;
-- Old Google-only function remains for old consumers, now evaluates the common account.
create or replace function pmoffice_private.pms_google_member() returns boolean
language sql stable security definer set search_path='' as $$ select pmoffice_private.account_ok() $$;
create or replace function public.pms_find_members(p_search text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 if length(trim(p_search))<2 then return '[]';end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (select u.id,u.email,p.display_name,p.company,p.status from auth.users u join public.profiles p on p.id=u.id
 where p.status='active' and p.withdrawn_at is null and (p.registered_at is not null or p.signup_accepted_at is not null) and
 (u.email ilike '%'||left(trim(p_search),120)||'%' or p.display_name ilike '%'||left(trim(p_search),120)||'%' or p.company ilike '%'||left(trim(p_search),120)||'%') order by u.email limit 25) x),'[]');
end$$;
create or replace function public.pms_set_group_person(p_group uuid,p_user uuid,p_active boolean) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 if p_active and not exists(select 1 from public.profiles p where p.id=p_user and p.status='active' and p.withdrawn_at is null and (p.registered_at is not null or p.signup_accepted_at is not null)) then raise exception '가입을 완료한 활성 회원을 선택해 주세요.';end if;
 insert into public.pms_group_members(group_id,user_id,active) values(p_group,p_user,p_active)
 on conflict(group_id,user_id) do update set active=excluded.active;
 insert into public.pms_audit(actor,project_slug,action,details) values(auth.uid(),'@groups','group.member',jsonb_build_object('group',p_group,'user',p_user,'active',p_active));
end$$;
-- Enforce group-only access even through old admin clients.
create function pmoffice_private.member_project_guard() returns trigger language plpgsql set search_path='' as $$
begin if new.access_mode<>'assigned' or new.listed then raise exception '고객 프로젝트는 지정 그룹에만 공개할 수 있습니다.';end if;return new;end$$;
create trigger member_project_guard before insert or update on public.pms_projects for each row execute function pmoffice_private.member_project_guard();
revoke execute on function public.pms_set_person(text,uuid,text,boolean,timestamptz),public.pms_set_member(text,uuid,boolean,timestamptz) from public,anon,authenticated;

create function public.member_document_list() returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x) order by x.category,x.title),'[]') from (
 select d.path,d.title,d.category,d.toc from public.member_documents d where pmoffice_private.member_document_allowed(d.path)
 union all select '/knowledge/index.html?post='||p.id,p.title,b.title,'[]'::jsonb from public.posts p join public.boards b on b.id=p.board_id where pmoffice_private.can_read_post(p.id)) x
$$;
create function public.member_document_get(p_path text) returns jsonb
language sql stable security definer set search_path='' as $$
 select to_jsonb(d) from public.member_documents d where d.path=p_path and pmoffice_private.member_document_allowed(d.path)
$$;
create function public.member_post_get(p_id uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('title',p.title,'body',p.body,'attachments',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'file_name',a.file_name)) from public.attachments a where a.post_id=p.id),'[]'))
 from public.posts p where pmoffice_private.can_read_post(p.id)
$$;
create function public.member_document_search(p_query text) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(x)),'[]') from (
 select d.path,d.title,d.category from public.member_documents d where length(trim(p_query)) between 1 and 100
 and pmoffice_private.member_document_allowed(d.path) and (d.title ilike '%'||p_query||'%' or d.body_text ilike '%'||p_query||'%')
 union all select '/knowledge/index.html?post='||p.id,p.title,b.title from public.posts p join public.boards b on b.id=p.board_id
 where length(trim(p_query)) between 1 and 100 and pmoffice_private.can_read_post(p.id) and (p.title ilike '%'||p_query||'%' or p.body ilike '%'||p_query||'%') limit 50) x
$$;
create function public.member_document_import(p_doc jsonb,p_media jsonb default '[]') returns void
language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 if (p_doc->>'body_html') ~* '<(script|iframe|object|embed|style)\y|\yon[a-z]+\s*=|javascript:|data:text/html' then raise exception '허용하지 않는 본문입니다.';end if;
 insert into public.member_documents(path,title,category,body_html,body_text,toc,source_sha256)
 values(p_doc->>'path',p_doc->>'title',p_doc->>'category',p_doc->>'body_html',p_doc->>'body_text',p_doc->'toc',p_doc->>'source_sha256')
 on conflict(path) do update set title=excluded.title,category=excluded.category,body_html=excluded.body_html,body_text=excluded.body_text,toc=excluded.toc,source_sha256=excluded.source_sha256,updated_at=now();
 insert into public.member_document_media(object_path,document_path,sha256)
 select x->>'object_path',p_doc->>'path',x->>'sha256' from jsonb_array_elements(p_media) x on conflict(object_path) do update set sha256=excluded.sha256;
 insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'member.document_import',p_doc->>'path');
end$$;

create function public.member_mail_preview(p_groups uuid[] default '{}',p_users uuid[] default '{}') returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) or cardinality(p_groups)>200 or cardinality(p_users)>2000 then raise insufficient_privilege;end if;
 return coalesce((select jsonb_agg(to_jsonb(x) order by x.email) from (select distinct on(lower(u.email)) u.id,u.email,p.display_name,p.company
 from auth.users u join public.profiles p on p.id=u.id where p.status='active' and p.withdrawn_at is null and (p.registered_at is not null or p.signup_accepted_at is not null)
 and (u.id=any(p_users) or exists(select 1 from public.pms_group_members m join public.pms_groups g on g.id=m.group_id and g.active where m.user_id=u.id and m.active and (m.expires_at is null or m.expires_at>now()) and m.group_id=any(p_groups))) order by lower(u.email),u.id) x),'[]');
end$$;
create function public.member_mail_send(p_request uuid,p_groups uuid[],p_users uuid[],p_subject text,p_body text,p_expected text[]) returns uuid
language plpgsql security definer set search_path='' as $$
declare people jsonb; addresses text[]; job uuid; old public.member_mail_jobs;
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_request::text,0));
 select * into old from public.member_mail_jobs where request_id=p_request;
 if found then
 if old.actor_id<>auth.uid() or old.kind<>'manual' or old.subject<>p_subject or old.body<>p_body or old.target_groups<>p_groups or old.target_users<>p_users then raise exception '중복 요청의 내용이 다릅니다.';end if;
 return old.id;end if;
 if p_subject ~ '[\r\n]' or length(trim(p_subject)) not between 1 and 200 or length(trim(p_body)) not between 1 and 50000 then raise exception '제목과 본문을 확인해 주세요.';end if;
 people:=public.member_mail_preview(p_groups,p_users);
 select array_agg(x->>'email' order by x->>'email') into addresses from jsonb_array_elements(people) x;
 if addresses is null or addresses is distinct from (select array_agg(x order by x) from unnest(p_expected) x) then raise exception '수신자 목록이 변경되었습니다. 다시 확인해 주세요.' using errcode='40001';end if;
 insert into public.member_mail_jobs(request_id,actor_id,kind,target_groups,target_users,subject,body) values(p_request,auth.uid(),'manual',p_groups,p_users,trim(p_subject),p_body) returning id into job;
 insert into public.member_mail_messages(job_id,user_id,recipient) select job,(x->>'id')::uuid,x->>'email' from jsonb_array_elements(people) x;
 insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'member.mail_send',job::text,jsonb_build_object('count',cardinality(addresses)));
 return job;
end$$;
create function public.member_mail_history() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (select m.id,m.recipient,m.state,m.error,m.updated_at,j.subject,j.kind from public.member_mail_messages m join public.member_mail_jobs j on j.id=m.job_id order by m.updated_at desc limit 200) x),'[]');
end$$;
create function public.member_mail_bridge(p_message text,p_signature text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare secret text; request_json jsonb; claimed_row public.member_mail_messages; action text;
begin
 select bridge_secret into secret from pmoffice_private.inquiry_settings where singleton;
 if secret is null or length(p_message)>64000 or p_signature is null or p_signature<>encode(extensions.hmac(convert_to(p_message,'UTF8'),convert_to(secret,'UTF8'),'sha256'),'hex') then raise insufficient_privilege;end if;
 request_json:=p_message::jsonb;
 if request_json->>'ts' is null or request_json->>'nonce' is null or abs(extract(epoch from clock_timestamp())-(request_json->>'ts')::numeric)>300 or length(request_json->>'nonce') not between 20 and 100 then raise insufficient_privilege;end if;
 insert into pmoffice_private.member_mail_nonces(nonce) values(request_json->>'nonce');
 delete from pmoffice_private.member_mail_nonces where created_at<now()-interval '1 day';
 action:=request_json->>'action';
 if action='poll' then
 update public.member_mail_messages set state='unknown',error='발송 결과 확인 필요',updated_at=now() where state='sending' and updated_at<now()-interval '10 minutes';
 update public.member_mail_messages m set state='cancelled',error='수신자 상태 변경',updated_at=now() where state='queued' and user_id is not null and not exists(select 1 from auth.users u join public.profiles p on p.id=u.id where u.id=m.user_id and u.email=m.recipient and p.status='active' and p.withdrawn_at is null);
 return coalesce((select jsonb_agg(to_jsonb(x)) from (select m.id,m.recipient,j.subject,j.body from public.member_mail_messages m join public.member_mail_jobs j on j.id=m.job_id where m.state='queued' and (j.kind='manual' or m.recipient='namwoongchan@gmail.com') order by m.updated_at limit 20) x),'[]');
 elsif action='claim' then
 update public.member_mail_messages set state='sending',claim_id=gen_random_uuid(),updated_at=now() where id=(request_json->>'id')::uuid and state='queued' and (user_id is null or exists(select 1 from auth.users u join public.profiles p on p.id=u.id where u.id=member_mail_messages.user_id and u.email=member_mail_messages.recipient and p.status='active' and p.withdrawn_at is null)) returning * into claimed_row;
 return jsonb_build_object('claimed',found,'claim_id',claimed_row.claim_id);
 elsif action='result' then
 if request_json->>'state' not in('sent','failed','unknown') then raise exception 'Invalid state';end if;
 update public.member_mail_messages set state=request_json->>'state',error=left(request_json->>'error',250),updated_at=now() where id=(request_json->>'id')::uuid and claim_id=(request_json->>'claim_id')::uuid and state='sending';
 return jsonb_build_object('ok',found);
 end if;raise exception 'Unknown operation';
end$$;

-- Existing inquiry RPC is preserved; filter new and pending non-admin notifications.
create function pmoffice_private.member_inquiry_recipient() returns trigger language plpgsql set search_path='' as $$
begin if new.recipient<>'namwoongchan@gmail.com' then return null;end if;return new;end$$;
create trigger member_inquiry_recipient before insert on public.inquiry_notifications for each row execute function pmoffice_private.member_inquiry_recipient();
update public.inquiry_notifications set state='확인 필요',error='관리자 단일 수신 정책으로 취소',updated_at=now() where recipient<>'namwoongchan@gmail.com' and state in('대기','재시도','발송 중');

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('member-knowledge','member-knowledge',false,41943040,array['image/png','image/webp','image/jpeg','image/gif','image/svg+xml','application/pdf','application/zip','text/plain','application/octet-stream']) on conflict(id) do update set public=false;
create policy member_knowledge_admin on storage.objects for all to authenticated using(bucket_id='member-knowledge' and pmoffice_private.is_admin()) with check(bucket_id='member-knowledge' and pmoffice_private.is_admin());
create policy member_existing_attachment_read on storage.objects for select to authenticated using(bucket_id='member-files' and exists(select 1 from public.attachments a where a.object_path=name and pmoffice_private.can_read_post(a.post_id)));
create policy member_knowledge_read on storage.objects for select to authenticated using(bucket_id='member-knowledge' and exists(select 1 from public.member_document_media m where m.object_path=name and pmoffice_private.member_document_allowed(m.document_path)));

-- Explicitly revoke default PUBLIC EXECUTE for all newly created routines.
do $$declare r record;begin
 for r in select p.oid::regprocedure as signature,n.nspname,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where (n.nspname='public' and p.proname like 'member_%') or (n.nspname='pmoffice_private' and p.proname like 'member_%') loop
 execute 'revoke all on function '||r.signature||' from public,anon,authenticated';
 if r.nspname='public' then execute 'grant execute on function '||r.signature||' to authenticated';end if;
 end loop;
end$$;
grant execute on function public.member_account(),public.member_mail_bridge(text,text) to anon;
grant execute on function pmoffice_private.member_document_allowed(text) to authenticated;

create function public.member_provisioned_user(p_request uuid) returns uuid
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 return (select id from auth.users where raw_app_meta_data->>'member_request_id'=p_request::text and raw_app_meta_data->>'member_created_by'=auth.uid()::text limit 1);
end$$;
revoke all on function public.member_provisioned_user(uuid) from public,anon,authenticated;
grant execute on function public.member_provisioned_user(uuid) to authenticated;
create table pmoffice_private.member_registration_attempts(fingerprint text not null,attempted_at timestamptz not null default now());
alter table pmoffice_private.member_registration_attempts enable row level security;
create index member_registration_attempts_lookup on pmoffice_private.member_registration_attempts(fingerprint,attempted_at);
revoke all on pmoffice_private.member_registration_attempts from public,anon,authenticated;
create function public.member_registration_gate(p_fingerprint text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_fingerprint is null or p_fingerprint !~ '^[0-9a-f]{64}$' then raise insufficient_privilege;end if;
 perform pg_advisory_xact_lock(hashtextextended(p_fingerprint,0));
 if (select count(*) from pmoffice_private.member_registration_attempts where fingerprint=p_fingerprint and attempted_at>now()-interval '1 hour')>=10 then raise exception 'Too many attempts';end if;
 delete from pmoffice_private.member_registration_attempts where attempted_at<now()-interval '1 day';
 insert into pmoffice_private.member_registration_attempts(fingerprint) values(p_fingerprint);
end$$;
revoke all on function public.member_registration_gate(text) from public,anon,authenticated;
grant execute on function public.member_registration_gate(text) to service_role;


create or replace function public.pms_group_people(p_group uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 return coalesce((select jsonb_agg(to_jsonb(x)) from (select m.user_id,m.active,m.expires_at,u.email,p.display_name,p.company
 from public.pms_group_members m join auth.users u on u.id=m.user_id join public.profiles p on p.id=m.user_id where m.group_id=p_group order by u.email) x),'[]');
end$$;
create function public.member_group_expiry(p_group uuid,p_user uuid,p_expires timestamptz) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 update public.pms_group_members set expires_at=p_expires where group_id=p_group and user_id=p_user;
 if not found then raise exception '그룹 구성원이 없습니다.';end if;
 insert into public.pms_audit(actor,project_slug,action,details) values(auth.uid(),'@groups','group.member_expiry',jsonb_build_object('group',p_group,'user',p_user,'expires_at',p_expires));
end$$;
revoke all on function public.member_group_expiry(uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.member_group_expiry(uuid,uuid,timestamptz) to authenticated;

notify pgrst,'reload schema';
commit;
