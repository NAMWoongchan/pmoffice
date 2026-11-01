begin;
create or replace function public.ebook_api(p_action text,p jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); adm boolean:=coalesce(pmoffice_private.is_admin(),false); b pmoffice_private.ebook_books; a pmoffice_private.ebook_assets; f pmoffice_private.ebook_folders; s pmoffice_private.ebook_settings; result jsonb; n bigint; aid uuid; h text:=p->>'share_hash';
begin
 select * into strict s from pmoffice_private.ebook_settings where singleton;
 if p_action='session' then return jsonb_build_object('member',coalesce(pmoffice_private.account_ok(),false),'admin',adm,'enabled',coalesce(pmoffice_private.account_ok() and pmoffice_private.ebook_user_ok(u),false),'released',s.released,'unlimited',adm,'max_bytes',case when adm then null else 52428800 end,'max_pages',case when adm then null else 200 end,'max_books',case when adm then null else 10 end);end if;

 if p_action like 'admin_%' then
  if not adm then raise insufficient_privilege;end if;
  if p_action='admin_summary' then return (select jsonb_build_object('queued',count(*) filter(where state='queued'),'failed',count(*) filter(where state='failed')) from pmoffice_private.ebook_books where deleted_at is null);end if;
  if p_action='admin_history' then return coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from (select aud.*,bk.title from pmoffice_private.ebook_audit aud left join pmoffice_private.ebook_books bk on bk.id=aud.book_id where aud.action like 'admin.%' and aud.book_id is not null order by aud.id desc limit 200)x),'[]');end if;
  if p_action='admin_list' then
   select count(*) into n from pmoffice_private.ebook_books x join auth.users u on u.id=x.owner_id left join public.profiles pr on pr.id=x.owner_id
    where (coalesce(p->>'search','')='' or concat_ws(' ',x.title,x.filename,pr.display_name,u.email) ilike '%'||(p->>'search')||'%')
    and (coalesce(p->>'state','')='' or x.state=p->>'state')
    and (coalesce(p->>'publication','')='' or (p->>'publication'='suspended' and x.publication_suspended) or (p->>'publication'='active' and not x.publication_suspended))
    and (coalesce(p->>'deleted','active')='all' or (p->>'deleted'='deleted' and x.deleted_at is not null) or (coalesce(p->>'deleted','active')='active' and x.deleted_at is null));
   select coalesce(jsonb_agg(pmoffice_private.ebook_admin_record(x) order by x.updated_at desc,x.id),'[]') into result from (
    select x.* from pmoffice_private.ebook_books x join auth.users u on u.id=x.owner_id left join public.profiles pr on pr.id=x.owner_id
    where (coalesce(p->>'search','')='' or concat_ws(' ',x.title,x.filename,pr.display_name,u.email) ilike '%'||(p->>'search')||'%')
    and (coalesce(p->>'state','')='' or x.state=p->>'state')
    and (coalesce(p->>'publication','')='' or (p->>'publication'='suspended' and x.publication_suspended) or (p->>'publication'='active' and not x.publication_suspended))
    and (coalesce(p->>'deleted','active')='all' or (p->>'deleted'='deleted' and x.deleted_at is not null) or (coalesce(p->>'deleted','active')='active' and x.deleted_at is null))
    order by x.updated_at desc,x.id limit 50 offset greatest(0,coalesce((p->>'offset')::int,0))
   )x;
   return jsonb_build_object('books',result,'total',n);
  end if;
  if p_action not in('admin_detail','admin_retry','admin_suspend','admin_resume','admin_delete','admin_restore','admin_approve') then raise exception '잘못된 관리 요청';end if;
  -- Lock the book before its job/assets on every mutation, including worker callbacks.
  select * into b from pmoffice_private.ebook_books where id=(p->>'book_id')::uuid for update;
  if b.id is null then raise insufficient_privilege;end if;
  if p_action='admin_detail' then
   return pmoffice_private.ebook_admin_record(b)||jsonb_build_object('assets',coalesce((select jsonb_agg(to_jsonb(x)-'complete') from pmoffice_private.ebook_assets x where x.book_id=b.id and x.complete),'[]'),'audit',coalesce((select jsonb_agg(to_jsonb(x) order by x.id desc) from (select * from pmoffice_private.ebook_audit where book_id=b.id order by id desc limit 100)x),'[]'));
  end if;
  if length(trim(coalesce(p->>'reason',''))) not between 1 and 1000 then raise exception '조치 사유를 1~1000자로 입력해 주세요.';end if;
  if p->>'expected_updated_at' is null or (p->>'expected_updated_at')::timestamptz<>b.updated_at then raise exception '다른 변경이 있습니다. 상세 화면을 새로고침해 주세요.' using errcode='40001';end if;
  result=jsonb_build_object('state',b.state,'suspended',b.publication_suspended,'deleted_at',b.deleted_at,'visibility',b.visibility);
  if p_action='admin_retry' then
   if b.deleted_at is not null or b.state<>'failed' or not exists(select 1 from pmoffice_private.ebook_assets where book_id=b.id and kind='source' and complete) then raise exception '업로드가 완료된 원본이 있는 실패 건만 재처리할 수 있습니다.';end if;
   if exists(select 1 from pmoffice_private.ebook_jobs where book_id=b.id and lease_until>now()) then raise exception '실행 중인 작업이 있습니다.';end if;
   -- Keep old asset/chunk references and stored bytes; new conversion receives new asset IDs.
   insert into pmoffice_private.ebook_result_history(book_id,asset,chunks) select b.id,to_jsonb(ax),coalesce((select jsonb_agg(to_jsonb(c)) from pmoffice_private.ebook_chunks c where c.asset_id=ax.id),'[]') from pmoffice_private.ebook_assets ax where ax.book_id=b.id and ax.kind<>'source';
   delete from pmoffice_private.ebook_chunks where asset_id in(select id from pmoffice_private.ebook_assets where book_id=b.id and kind<>'source');
   delete from pmoffice_private.ebook_assets where book_id=b.id and kind<>'source';
   delete from pmoffice_private.ebook_jobs where book_id=b.id;
   update pmoffice_private.ebook_books set state='queued',admin_retry_pending=true,warnings='[]',pages=null,searchable=false,visibility='private',share_hash=null,shared_users='{}',updated_at=clock_timestamp() where id=b.id;
   insert into pmoffice_private.ebook_jobs(book_id) values(b.id);
  elsif p_action='admin_suspend' then
   if b.deleted_at is not null or b.state='archived' then raise exception '삭제·보관된 이북입니다.';end if;
   update pmoffice_private.ebook_books set publication_suspended=true,admin_retry_pending=false,state=case when state in('processing','queued') then 'failed' else state end,updated_at=clock_timestamp() where id=b.id;
   delete from pmoffice_private.ebook_jobs where book_id=b.id;
  elsif p_action='admin_resume' then
   if b.deleted_at is not null or b.state<>'ready' or not b.publication_suspended then raise exception '검토 완료된 게시 중지 이북만 재개할 수 있습니다.';end if;
   update pmoffice_private.ebook_books set publication_suspended=false,updated_at=clock_timestamp() where id=b.id;
  elsif p_action='admin_delete' then
   if b.deleted_at is not null then raise exception '이미 삭제된 이북입니다.';end if;
   update pmoffice_private.ebook_books set admin_retry_pending=false,before_delete_state=state,deleted_at=clock_timestamp(),state='archived',publication_suspended=true,visibility='private',share_hash=null,shared_users='{}',updated_at=clock_timestamp() where id=b.id;
   delete from pmoffice_private.ebook_jobs where book_id=b.id;
  elsif p_action='admin_approve' then
   if b.deleted_at is not null or b.state<>'review' then raise exception '검토 대기 이북만 승인할 수 있습니다.';end if;
   update pmoffice_private.ebook_books set state='ready',admin_retry_pending=false,updated_at=clock_timestamp() where id=b.id;
  elsif p_action='admin_restore' then
   if b.deleted_at is null then raise exception '삭제된 이북만 복원할 수 있습니다.';end if;
   update pmoffice_private.ebook_books set deleted_at=null,state=case when before_delete_state in('ready','review','uploading') then before_delete_state else 'failed' end,publication_suspended=true,visibility='private',share_hash=null,shared_users='{}',before_delete_state=null,updated_at=clock_timestamp() where id=b.id;
  end if;
  select * into b from pmoffice_private.ebook_books where id=b.id;
  insert into pmoffice_private.ebook_audit(actor_id,book_id,action,reason,before_state,after_state) values(u,b.id,replace(p_action,'admin_','admin.'),trim(p->>'reason'),result,jsonb_build_object('state',b.state,'suspended',b.publication_suspended,'deleted_at',b.deleted_at,'visibility',b.visibility));
  return pmoffice_private.ebook_admin_record(b);
 end if;
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
  if not adm and (select count(*) from pmoffice_private.ebook_books where owner_id=u and state<>'archived')>=10 then raise exception '회원당 10권 한도입니다.';end if;
  if coalesce((p->>'bytes')::bigint,0)<1 or (not adm and (p->>'bytes')::bigint>52428800) or length(p->>'filename')>240 or not (p->>'filename' ~* '\.(pdf|pptx)$') then raise exception '파일 형식 또는 크기를 확인해 주세요.';end if;
  if p->>'folder_id' is not null and not exists(select 1 from pmoffice_private.ebook_folders where id=(p->>'folder_id')::uuid and owner_id=u) then raise insufficient_privilege;end if;
  select * into s from pmoffice_private.ebook_settings where singleton for update;
  if not adm and (s.max_storage_bytes<=0 or s.member_storage_reserved+(p->>'bytes')::bigint>s.max_storage_bytes) then raise exception '저장 한도 확정 또는 용량 확보가 필요합니다.';end if;
  update pmoffice_private.ebook_settings set storage_reserved=storage_reserved+(p->>'bytes')::bigint,member_storage_reserved=member_storage_reserved+case when adm then 0 else (p->>'bytes')::bigint end where singleton;
  insert into pmoffice_private.ebook_books(owner_id,folder_id,title,filename,format,source_bytes,quota_exempt) values(u,(p->>'folder_id')::uuid,trim(p->>'title'),p->>'filename',case when p->>'filename' ~* '\.pdf$' then 'pdf' else 'pptx' end,(p->>'bytes')::bigint,adm) returning * into b;
  insert into pmoffice_private.ebook_assets(book_id,kind,mime,bytes) values(b.id,'source',case when b.format='pdf' then 'application/pdf' else 'application/vnd.openxmlformats-officedocument.presentationml.presentation' end,b.source_bytes) returning id into aid;
  insert into pmoffice_private.ebook_audit(actor_id,book_id,action) values(u,b.id,'create');
  return pmoffice_private.ebook_public_book(b)||jsonb_build_object('source_asset',aid);
 end if;
 select * into b from pmoffice_private.ebook_books where id=(p->>'book_id')::uuid for update;
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
  return to_jsonb(a)||jsonb_build_object('owner_id',b.owner_id,'delivery_exempt',adm,'chunks',coalesce((select jsonb_agg(to_jsonb(c) order by c.idx) from pmoffice_private.ebook_chunks c where c.asset_id=a.id),'[]'));
 end if;
 if not pmoffice_private.ebook_manage(b) or b.state='archived' then raise insufficient_privilege;end if;
 if p_action='update' then
  if p->>'folder_id' is not null and not exists(select 1 from pmoffice_private.ebook_folders where id=(p->>'folder_id')::uuid and owner_id=b.owner_id) then raise insufficient_privilege;end if;
  update pmoffice_private.ebook_books set title=trim(p->>'title'),folder_id=(p->>'folder_id')::uuid,updated_at=now() where id=b.id;
 elsif p_action='share' then
  if b.state<>'ready' then raise exception '검토를 통과한 이북만 공유할 수 있습니다.';end if;
  if p->>'visibility'='link' and coalesce(p->>'share_hash','') !~ '^[a-f0-9]{64}$' then raise exception '공유 토큰이 필요합니다.';end if;
  update pmoffice_private.ebook_books set visibility=p->>'visibility',share_hash=case when p->>'visibility'='link' then p->>'share_hash' else null end,shared_users=array(select jsonb_array_elements_text(coalesce(p->'shared_users','[]'))::uuid),updated_at=now() where id=b.id;
 elsif p_action='archive' then
  update pmoffice_private.ebook_books set before_delete_state=state,deleted_at=clock_timestamp(),admin_retry_pending=false,state='archived',publication_suspended=true,visibility='private',share_hash=null,shared_users='{}',updated_at=clock_timestamp() where id=b.id;
  delete from pmoffice_private.ebook_jobs where book_id=b.id;
  insert into pmoffice_private.ebook_audit(actor_id,book_id,action,reason,before_state,after_state) values(u,b.id,'member.delete','소유자 삭제',jsonb_build_object('state',b.state,'visibility',b.visibility),jsonb_build_object('state','archived','suspended',true));
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
  update pmoffice_private.ebook_usage set jobs=jobs+1,limited_jobs=limited_jobs+case when adm then 0 else 1 end where day=current_date and (adm or limited_jobs<s.max_daily_jobs);
  if not found then raise exception '오늘의 변환 한도에 도달했습니다.';end if;
  update pmoffice_private.ebook_assets set complete=true where id=a.id;
  update pmoffice_private.ebook_books set state='queued',updated_at=now() where id=b.id;
  insert into pmoffice_private.ebook_jobs(book_id) values(b.id) on conflict(book_id) do nothing;
 else raise exception '지원하지 않는 요청입니다.';end if;
 insert into pmoffice_private.ebook_audit(actor_id,book_id,action) values(u,b.id,p_action);
 return jsonb_build_object('ok',true);
end$$;

notify pgrst,'reload schema';
commit;
