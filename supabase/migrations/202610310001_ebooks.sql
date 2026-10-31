-- Additive migration. Customer bytes remain in a PRIVATE GitHub repository.
begin;
create table pmoffice_private.ebook_settings(singleton boolean primary key default true check(singleton),released boolean not null default false,max_storage_bytes bigint not null default 0,max_daily_jobs integer not null default 0,max_daily_delivery_bytes bigint not null default 0,storage_reserved bigint not null default 0);
insert into pmoffice_private.ebook_settings(singleton) values(true);
create table pmoffice_private.ebook_group_policy(group_id uuid primary key references public.pms_groups(id),effect text not null check(effect in('allow','deny')));
create table pmoffice_private.ebook_folders(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),name text not null check(length(trim(name)) between 1 and 120),created_at timestamptz not null default now());
create table pmoffice_private.ebook_books(id uuid primary key default gen_random_uuid(),owner_id uuid not null references auth.users(id),folder_id uuid references pmoffice_private.ebook_folders(id),title text not null check(length(trim(title)) between 1 and 200),filename text not null,format text not null check(format in('pdf','pptx')),source_bytes bigint not null check(source_bytes between 1 and 52428800),state text not null default 'uploading' check(state in('uploading','queued','processing','review','ready','failed','archived')),visibility text not null default 'private' check(visibility in('private','members','link','public')),share_hash text,shared_users uuid[] not null default '{}',pages integer check(pages between 1 and 200),warnings jsonb not null default '[]',searchable boolean not null default false,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table pmoffice_private.ebook_assets(id uuid primary key default gen_random_uuid(),book_id uuid not null references pmoffice_private.ebook_books(id),kind text not null check(kind in('source','page','thumbnail','video','text')),page integer not null default 0 check(page between 0 and 200),mime text not null,bytes bigint not null check(bytes>0),complete boolean not null default false,unique(book_id,kind,page));
create table pmoffice_private.ebook_chunks(asset_id uuid not null references pmoffice_private.ebook_assets(id),idx integer not null check(idx>=0),bytes integer not null check(bytes between 1 and 1048576),sha256 text not null check(sha256 ~ '^[a-f0-9]{64}$'),object_path text not null,git_sha text not null check(git_sha ~ '^[a-f0-9]{40}$'),primary key(asset_id,idx));
create table pmoffice_private.ebook_jobs(book_id uuid primary key references pmoffice_private.ebook_books(id),lease_id uuid,lease_until timestamptz,attempts integer not null default 0,error text,created_at timestamptz not null default now());
create table pmoffice_private.ebook_audit(id bigint generated always as identity primary key,actor_id uuid,book_id uuid,action text not null,created_at timestamptz not null default now());
create table pmoffice_private.ebook_usage(day date primary key default current_date,jobs integer not null default 0,delivery_bytes bigint not null default 0);
do $$declare t text;begin foreach t in array array['ebook_settings','ebook_group_policy','ebook_folders','ebook_books','ebook_assets','ebook_chunks','ebook_jobs','ebook_audit','ebook_usage'] loop execute format('alter table pmoffice_private.%I enable row level security',t);execute format('revoke all on pmoffice_private.%I from public,anon,authenticated',t);end loop;end$$;

create function pmoffice_private.ebook_user_ok(u uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join auth.users a on a.id=p.id join pmoffice_private.service_settings s on s.singleton where p.id=u and p.status='active' and p.withdrawn_at is null and (a.banned_until is null or a.banned_until<=now()) and
 ((p.registration_source='legacy' and p.signup_accepted_at is not null and p.signup_version=s.signup_version) or (p.registration_source in('self','google') and p.registered_at is not null and p.signup_accepted_at is not null and p.signup_version=s.member_signup_version) or (p.registration_source='admin' and p.registered_at is not null and p.registered_by is not null and p.registration_version=s.member_signup_version)))
 and not exists(select 1 from public.pms_group_members m join public.pms_groups g on g.id=m.group_id and g.active join pmoffice_private.ebook_group_policy e on e.group_id=g.id where m.user_id=u and m.active and e.effect='deny')
$$;
create function pmoffice_private.ebook_manage(b pmoffice_private.ebook_books) returns boolean language sql stable security definer set search_path='' as $$select coalesce(pmoffice_private.is_admin(),false) or (b.owner_id=auth.uid() and pmoffice_private.account_ok() and pmoffice_private.ebook_user_ok(auth.uid()))$$;
create function pmoffice_private.ebook_read(b pmoffice_private.ebook_books,h text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(pmoffice_private.is_admin(),false) or (b.state<>'archived' and pmoffice_private.ebook_user_ok(b.owner_id) and (auth.uid() is null or (pmoffice_private.account_ok() and pmoffice_private.ebook_user_ok(auth.uid()))) and
 ((b.owner_id=auth.uid() and pmoffice_private.account_ok()) or (b.state='ready' and (b.visibility='public' or (b.visibility='link' and h is not null and b.share_hash=h) or (b.visibility='members' and auth.uid()=any(b.shared_users) and pmoffice_private.account_ok() and pmoffice_private.ebook_user_ok(auth.uid()))))))
$$;
create function pmoffice_private.ebook_public_book(b pmoffice_private.ebook_books) returns jsonb language sql stable set search_path='' as $$select to_jsonb(b)-'share_hash'-'shared_users'||jsonb_build_object('url','https://ebooks.pmoffice.co.kr/book/'||b.id::text,'can_manage',pmoffice_private.ebook_manage(b))$$;

create function public.ebook_api(p_action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); adm boolean:=coalesce(pmoffice_private.is_admin(),false); b pmoffice_private.ebook_books; a pmoffice_private.ebook_assets; f pmoffice_private.ebook_folders; s pmoffice_private.ebook_settings; result jsonb; n bigint; aid uuid; h text:=p->>'share_hash';
begin
 select * into strict s from pmoffice_private.ebook_settings where singleton;
 if p_action='session' then return jsonb_build_object('member',coalesce(pmoffice_private.account_ok(),false),'admin',adm,'enabled',coalesce(pmoffice_private.account_ok() and pmoffice_private.ebook_user_ok(u),false),'released',s.released,'max_bytes',52428800,'max_pages',200,'max_books',10);end if;
 if not s.released and not adm then raise exception '시험 운영 준비 중입니다.' using errcode='42501';end if;
 if p_action in('admin','settings','group_policy') then
  if not adm then raise insufficient_privilege;end if;
  if p_action='settings' then
   if (p->>'released')::boolean and (coalesce((p->>'max_storage_bytes')::bigint,0)<=0 or coalesce((p->>'max_daily_jobs')::integer,0)<=0 or coalesce((p->>'max_daily_delivery_bytes')::bigint,0)<=0) then raise exception '측정 후 운영 한도를 먼저 확정해 주세요.';end if;
   update pmoffice_private.ebook_settings set released=(p->>'released')::boolean,max_storage_bytes=(p->>'max_storage_bytes')::bigint,max_daily_jobs=(p->>'max_daily_jobs')::integer,max_daily_delivery_bytes=(p->>'max_daily_delivery_bytes')::bigint where singleton;
  elsif p_action='group_policy' then insert into pmoffice_private.ebook_group_policy values((p->>'group_id')::uuid,p->>'effect') on conflict(group_id) do update set effect=excluded.effect;
  end if;
  insert into pmoffice_private.ebook_audit(actor_id,action) values(u,'admin.'||p_action);
  return jsonb_build_object('settings',(select to_jsonb(x) from pmoffice_private.ebook_settings x),'books',coalesce((select jsonb_agg(pmoffice_private.ebook_public_book(x) order by x.updated_at desc) from pmoffice_private.ebook_books x),'[]'),'groups',coalesce((select jsonb_agg(to_jsonb(g)||jsonb_build_object('effect',coalesce(e.effect,'allow'))) from public.pms_groups g left join pmoffice_private.ebook_group_policy e on e.group_id=g.id),'[]'),'usage',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from pmoffice_private.ebook_usage order by day desc limit 31)x),'[]'),'audit',coalesce((select jsonb_agg(to_jsonb(x)) from (select * from pmoffice_private.ebook_audit order by id desc limit 100)x),'[]'));
 end if;
 if p_action in('list','folder_save','create') then
  if not coalesce(pmoffice_private.account_ok(),false) or (not adm and not pmoffice_private.ebook_user_ok(u)) then raise insufficient_privilege;end if;
  if p_action='list' then return jsonb_build_object('folders',coalesce((select jsonb_agg(to_jsonb(x) order by x.name) from pmoffice_private.ebook_folders x where x.owner_id=u),'[]'),'books',coalesce((select jsonb_agg(pmoffice_private.ebook_public_book(x) order by x.updated_at desc) from pmoffice_private.ebook_books x where x.owner_id=u and x.state<>'archived'),'[]'));end if;
  if p_action='folder_save' then
   if p->>'id' is null then insert into pmoffice_private.ebook_folders(owner_id,name) values(u,trim(p->>'name')) returning * into f;
   else update pmoffice_private.ebook_folders set name=trim(p->>'name') where id=(p->>'id')::uuid and owner_id=u returning * into f;end if;
   if f.id is null then raise insufficient_privilege;end if;return to_jsonb(f);
  end if;
  -- Serialize per-member quota and global capacity reservation.
  perform 1 from public.profiles where id=u for update;
  if (select count(*) from pmoffice_private.ebook_books where owner_id=u and state<>'archived')>=10 then raise exception '회원당 10권 한도입니다.';end if;
  if (p->>'bytes')::bigint not between 1 and 52428800 or length(p->>'filename')>240 or not (p->>'filename' ~* '\.(pdf|pptx)$') then raise exception '파일 형식 또는 크기를 확인해 주세요.';end if;
  if p->>'folder_id' is not null and not exists(select 1 from pmoffice_private.ebook_folders where id=(p->>'folder_id')::uuid and owner_id=u) then raise insufficient_privilege;end if;
  select * into s from pmoffice_private.ebook_settings where singleton for update;
  if s.max_storage_bytes<=0 or s.storage_reserved+(p->>'bytes')::bigint>s.max_storage_bytes then raise exception '저장 한도 확정 또는 용량 확보가 필요합니다.';end if;
  update pmoffice_private.ebook_settings set storage_reserved=storage_reserved+(p->>'bytes')::bigint where singleton;
  insert into pmoffice_private.ebook_books(owner_id,folder_id,title,filename,format,source_bytes) values(u,(p->>'folder_id')::uuid,trim(p->>'title'),p->>'filename',case when p->>'filename' ~* '\.pdf$' then 'pdf' else 'pptx' end,(p->>'bytes')::bigint) returning * into b;
  insert into pmoffice_private.ebook_assets(book_id,kind,mime,bytes) values(b.id,'source',case when b.format='pdf' then 'application/pdf' else 'application/vnd.openxmlformats-officedocument.presentationml.presentation' end,b.source_bytes) returning id into aid;
  insert into pmoffice_private.ebook_audit(actor_id,book_id,action) values(u,b.id,'create');
  return pmoffice_private.ebook_public_book(b)||jsonb_build_object('source_asset',aid);
 end if;
 select * into b from pmoffice_private.ebook_books where id=(p->>'book_id')::uuid;
 if b.id is null then raise insufficient_privilege;end if;
 if p_action in('get','asset') then
  if not pmoffice_private.ebook_read(b,h) then raise insufficient_privilege;end if;
  if p_action='get' then
   insert into pmoffice_private.ebook_audit(actor_id,book_id,action) values(u,b.id,'read');
   return pmoffice_private.ebook_public_book(b)||jsonb_build_object('shared_users',case when pmoffice_private.ebook_manage(b) then to_jsonb(b.shared_users) else '[]' end,'assets',coalesce((select jsonb_agg(to_jsonb(x)-'complete') from pmoffice_private.ebook_assets x where x.book_id=b.id and x.complete and (x.kind<>'source' or pmoffice_private.ebook_manage(b))),'[]'));
  end if;
  select * into a from pmoffice_private.ebook_assets where id=(p->>'asset_id')::uuid and book_id=b.id and complete;
  if a.id is null or (a.kind='source' and not pmoffice_private.ebook_manage(b)) then raise insufficient_privilege;end if;
  insert into pmoffice_private.ebook_audit(actor_id,book_id,action) values(u,b.id,case when a.kind='source' then 'download' else 'asset.'||a.kind end);
  return to_jsonb(a)||jsonb_build_object('owner_id',b.owner_id,'chunks',coalesce((select jsonb_agg(to_jsonb(c) order by c.idx) from pmoffice_private.ebook_chunks c where c.asset_id=a.id),'[]'));
 end if;
 if not pmoffice_private.ebook_manage(b) or b.state='archived' then raise insufficient_privilege;end if;
 if p_action='update' then
  if p->>'folder_id' is not null and not exists(select 1 from pmoffice_private.ebook_folders where id=(p->>'folder_id')::uuid and owner_id=b.owner_id) then raise insufficient_privilege;end if;
  update pmoffice_private.ebook_books set title=trim(p->>'title'),folder_id=(p->>'folder_id')::uuid,updated_at=now() where id=b.id;
 elsif p_action='share' then
  if b.state<>'ready' then raise exception '검토를 통과한 이북만 공유할 수 있습니다.';end if;
  if p->>'visibility'='link' and coalesce(p->>'share_hash','') !~ '^[a-f0-9]{64}$' then raise exception '공유 토큰이 필요합니다.';end if;
  update pmoffice_private.ebook_books set visibility=p->>'visibility',share_hash=case when p->>'visibility'='link' then p->>'share_hash' else null end,shared_users=array(select jsonb_array_elements_text(coalesce(p->'shared_users','[]'))::uuid),updated_at=now() where id=b.id;
 elsif p_action='archive' then update pmoffice_private.ebook_books set state='archived',visibility='private',share_hash=null,shared_users='{}',updated_at=now() where id=b.id;delete from pmoffice_private.ebook_jobs where book_id=b.id;
 elsif p_action='approve' then
  if b.state<>'review' then raise exception '검토 대기 상태가 아닙니다.';end if;
  update pmoffice_private.ebook_books set state='ready',updated_at=now() where id=b.id;
 elsif p_action='upload_ticket' then
  if b.state<>'uploading' then raise exception '업로드 상태가 아닙니다.';end if;
  select * into strict a from pmoffice_private.ebook_assets where book_id=b.id and kind='source';
  if (p->>'idx')::int not between 0 and ((a.bytes-1)/1048576)::int then raise exception '잘못된 조각 번호입니다.';end if;
  return to_jsonb(a)||jsonb_build_object('owner_id',b.owner_id,'expected_bytes',least(1048576,a.bytes-(p->>'idx')::int*1048576));
 elsif p_action='submit' then
  select * into strict a from pmoffice_private.ebook_assets where book_id=b.id and kind='source';
  if b.state<>'uploading' or (select coalesce(sum(bytes),0) from pmoffice_private.ebook_chunks where asset_id=a.id)<>a.bytes then raise exception '파일 업로드가 끝나지 않았습니다.';end if;
  insert into pmoffice_private.ebook_usage(day) values(current_date) on conflict do nothing;
  update pmoffice_private.ebook_usage set jobs=jobs+1 where day=current_date and jobs<s.max_daily_jobs;
  if not found then raise exception '오늘의 변환 한도에 도달했습니다.';end if;
  update pmoffice_private.ebook_assets set complete=true where id=a.id;
  update pmoffice_private.ebook_books set state='queued',updated_at=now() where id=b.id;
  insert into pmoffice_private.ebook_jobs(book_id) values(b.id) on conflict(book_id) do nothing;
 else raise exception '지원하지 않는 요청입니다.';end if;
 insert into pmoffice_private.ebook_audit(actor_id,book_id,action) values(u,b.id,p_action);
 return jsonb_build_object('ok',true);
end$$;

-- Trusted gateway only. No browser has service_role credentials.
create function public.ebook_internal(p_action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare j pmoffice_private.ebook_jobs; b pmoffice_private.ebook_books; a pmoffice_private.ebook_assets; s pmoffice_private.ebook_settings; n bigint; result jsonb;
begin
 if p_action='chunk' then
  select * into strict a from pmoffice_private.ebook_assets where id=(p->>'asset_id')::uuid for update;
  if a.complete or exists(select 1 from pmoffice_private.ebook_books where id=a.book_id and state='archived') then raise exception '완료 또는 보관 처리된 파일입니다.';end if;
  if (p->>'idx')::int not between 0 and ((a.bytes-1)/1048576)::int or (p->>'bytes')::int<>least(1048576,a.bytes-(p->>'idx')::int*1048576) then raise exception '조각 크기가 맞지 않습니다.';end if;
  if exists(select 1 from pmoffice_private.ebook_chunks where asset_id=a.id and idx=(p->>'idx')::int and sha256<>p->>'sha256') then raise exception '다른 내용의 중복 업로드입니다.';end if;
  insert into pmoffice_private.ebook_chunks values(a.id,(p->>'idx')::int,(p->>'bytes')::int,p->>'sha256',p->>'object_path',p->>'git_sha') on conflict(asset_id,idx) do nothing;return '{"ok":true}';
 elsif p_action='delivery' then
  select * into strict s from pmoffice_private.ebook_settings where singleton;
  insert into pmoffice_private.ebook_usage(day) values(current_date) on conflict do nothing;
  update pmoffice_private.ebook_usage set delivery_bytes=delivery_bytes+(p->>'bytes')::bigint where day=current_date and delivery_bytes+(p->>'bytes')::bigint<=s.max_daily_delivery_bytes;
  if not found then raise exception '오늘의 전송 한도에 도달했습니다.';end if;return '{"ok":true}';
 elsif p_action='claim' then
  update pmoffice_private.ebook_books set state='failed',warnings=jsonb_build_array('PC 작업 연결이 반복 중단되어 관리자 확인이 필요합니다.'),updated_at=now() where id in(select book_id from pmoffice_private.ebook_jobs where attempts>=3 and lease_until<now()) and state='processing';
  select q.* into j from pmoffice_private.ebook_jobs q join pmoffice_private.ebook_books x on x.id=q.book_id where x.state in('queued','processing') and pmoffice_private.ebook_user_ok(x.owner_id) and (q.lease_until is null or q.lease_until<now()) and q.attempts<3 order by q.created_at for update of q skip locked limit 1;
  if j.book_id is null then return 'null';end if;
  update pmoffice_private.ebook_jobs set lease_id=gen_random_uuid(),lease_until=now()+interval '15 minutes',attempts=attempts+1 where book_id=j.book_id returning * into j;
  update pmoffice_private.ebook_books set state='processing',updated_at=now() where id=j.book_id returning * into b;
  select * into a from pmoffice_private.ebook_assets where book_id=b.id and kind='source';
  return jsonb_build_object('job',to_jsonb(j),'book',to_jsonb(b)-'share_hash','asset',to_jsonb(a),'chunks',(select jsonb_agg(to_jsonb(c) order by c.idx) from pmoffice_private.ebook_chunks c where c.asset_id=a.id));
 end if;
 select * into strict j from pmoffice_private.ebook_jobs where book_id=(p->>'book_id')::uuid and lease_id=(p->>'lease_id')::uuid and lease_until>now() for update;
 select * into strict b from pmoffice_private.ebook_books where id=j.book_id and state='processing';
 if not pmoffice_private.ebook_user_ok(b.owner_id) then raise insufficient_privilege;end if;
 if p_action='source' then
  select * into strict a from pmoffice_private.ebook_assets where book_id=b.id and kind='source' and complete;
  return to_jsonb(a)||jsonb_build_object('owner_id',b.owner_id,'chunks',(select jsonb_agg(to_jsonb(c) order by c.idx) from pmoffice_private.ebook_chunks c where c.asset_id=a.id));
 elsif p_action='asset_ticket' then
  select * into strict a from pmoffice_private.ebook_assets where id=(p->>'asset_id')::uuid and book_id=b.id and not complete;
  if (p->>'idx')::int not between 0 and ((a.bytes-1)/1048576)::int then raise exception '조각 번호 오류';end if;
  return to_jsonb(a)||jsonb_build_object('owner_id',b.owner_id,'expected_bytes',least(1048576,a.bytes-(p->>'idx')::int*1048576));
 elsif p_action='heartbeat' then update pmoffice_private.ebook_jobs set lease_until=now()+interval '15 minutes' where book_id=b.id;return '{"ok":true}';
 elsif p_action='asset_create' then
  select * into a from pmoffice_private.ebook_assets where book_id=b.id and kind=p->>'kind' and page=(p->>'page')::int;
  if a.id is not null then
   if a.bytes<>(p->>'bytes')::bigint then raise exception '재시도 결과 크기가 다릅니다. 관리자 확인이 필요합니다.';end if;return to_jsonb(a)||jsonb_build_object('owner_id',b.owner_id);
  end if;
  select * into s from pmoffice_private.ebook_settings where singleton for update;
  if (p->>'bytes')::bigint<=0 or s.storage_reserved+(p->>'bytes')::bigint>s.max_storage_bytes then raise exception '변환 결과 저장 한도입니다.';end if;
  update pmoffice_private.ebook_settings set storage_reserved=storage_reserved+(p->>'bytes')::bigint where singleton;
  insert into pmoffice_private.ebook_assets(book_id,kind,page,mime,bytes) values(b.id,p->>'kind',(p->>'page')::int,p->>'mime',(p->>'bytes')::bigint) returning * into a;return to_jsonb(a)||jsonb_build_object('owner_id',b.owner_id);
 elsif p_action='asset_complete' then
  select * into strict a from pmoffice_private.ebook_assets where id=(p->>'asset_id')::uuid and book_id=b.id;
  if (select coalesce(sum(bytes),0) from pmoffice_private.ebook_chunks where asset_id=a.id)<>a.bytes then raise exception '결과 파일이 불완전합니다.';end if;
  update pmoffice_private.ebook_assets set complete=true where id=a.id;
 elsif p_action='finish' then
  n:=(p->>'pages')::int;if n not between 1 and 200 then raise exception '200쪽 한도입니다.';end if;
  if (select count(*) from pmoffice_private.ebook_assets where book_id=b.id and kind='page' and complete and page between 1 and n)<>n then raise exception '페이지 누락';end if;
  if b.format='pptx' and (select count(*) from pmoffice_private.ebook_assets where book_id=b.id and kind='video' and complete and page between 1 and n)<>n then raise exception '슬라이드 영상 누락';end if;
  update pmoffice_private.ebook_books set state='review',pages=n,warnings=coalesce(p->'warnings','[]'),searchable=coalesce((p->>'searchable')::boolean,false),updated_at=now() where id=b.id;
  delete from pmoffice_private.ebook_jobs where book_id=b.id;
 elsif p_action='fail' then update pmoffice_private.ebook_books set state='failed',warnings=jsonb_build_array(left(coalesce(p->>'error','변환 실패'),300)),updated_at=now() where id=b.id;delete from pmoffice_private.ebook_jobs where book_id=b.id;
 else raise exception '잘못된 처리 요청';end if;
 return '{"ok":true}';
end$$;
revoke all on function public.ebook_api(text,jsonb),public.ebook_internal(text,jsonb),pmoffice_private.ebook_user_ok(uuid),pmoffice_private.ebook_manage(pmoffice_private.ebook_books),pmoffice_private.ebook_read(pmoffice_private.ebook_books,text),pmoffice_private.ebook_public_book(pmoffice_private.ebook_books) from public,anon,authenticated;
grant execute on function public.ebook_api(text,jsonb) to anon,authenticated;
grant execute on function public.ebook_internal(text,jsonb) to service_role;
commit;
