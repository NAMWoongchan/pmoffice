-- Administrator-maintained request preferences; separate from actual membership grants.
begin;
alter table pmoffice_private.member_details add column requested_services_source text not null default 'signup' check(requested_services_source in('signup','admin'));
alter table pmoffice_private.member_details add column requested_services_updated_by uuid references auth.users(id);
alter table pmoffice_private.member_details add column requested_services_updated_at timestamptz;
create or replace function public.member_detail(p_user uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare u uuid:=coalesce(p_user,auth.uid());adm boolean:=coalesce(pmoffice_private.is_admin(),false);result jsonb;begin
 if auth.uid() is null or (not adm and (u<>auth.uid() or not coalesce(pmoffice_private.account_ok(),false))) then raise insufficient_privilege;end if;
 select jsonb_build_object('profile',to_jsonb(p)||jsonb_build_object('email',a.email,'last_sign_in_at',a.last_sign_in_at),
 'services',pmoffice_private.member_service_codes(u),'catalog',public.member_service_catalog(),
 'answers',coalesce(d.corrected_answers,d.signup_answers),'original_answers',d.signup_answers,'requested_services',coalesce(to_jsonb(d.requested_services),'[]'),'requested_source',d.requested_services_source,'requested_updated_at',d.requested_services_updated_at,'details_updated_at',d.updated_at,
 'admin_memo',case when adm then d.admin_memo else null end,
 'activity',jsonb_build_object('joined_at',coalesce(p.registered_at,p.created_at),'last_sign_in_at',a.last_sign_in_at,'ebook_count',(select count(*) from pmoffice_private.ebook_books b where b.owner_id=u),'deleted_ebook_count',(select count(*) from pmoffice_private.ebook_books b where b.owner_id=u and b.state='archived'),'group_count',(select count(*) from public.pms_group_members gm where gm.user_id=u and gm.active)),
 'management_history',case when adm then coalesce((select jsonb_agg(to_jsonb(x) order by x.created_at desc) from (select action,details,actor_id,created_at from public.audit_log where target_id=u::text and action like 'member.%' order by created_at desc limit 100)x),'[]') else '[]'::jsonb end)
 into result from public.profiles p join auth.users a on a.id=p.id left join pmoffice_private.member_details d on d.user_id=p.id where p.id=u;
 if result is null then raise insufficient_privilege;end if;return result;
end$$;
create or replace function public.member_admin_signup_answers(p_users uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 perform pmoffice_private.require_admin();
 if p_users is null or cardinality(p_users)>100 then raise exception '한 페이지의 회원만 조회해 주세요.';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('user_id',p.id,'answers',coalesce(d.corrected_answers,d.signup_answers),'original_recorded',d.signup_answers is not null,'requested_source',d.requested_services_source,'requested_names',coalesce((select jsonb_agg(c->>'name') from jsonb_array_elements(public.member_service_catalog()) c where c->>'id'=any(d.requested_services)),'[]'::jsonb))) from public.profiles p left join pmoffice_private.member_details d on d.user_id=p.id where p.id=any(p_users)),'[]'::jsonb);
end$$;
create or replace function public.member_signup_service_request(p_codes text[],p_position text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();p public.profiles;begin
 if u is null or not coalesce(pmoffice_private.account_ok(),false) then raise insufficient_privilege;end if;
 perform pmoffice_private.validate_service_codes(p_codes,false);
 if exists(select 1 from pmoffice_private.member_details where user_id=u and requested_services_source='admin') then raise exception '관리자가 설정한 신청 서비스는 회원이 변경할 수 없습니다.' using errcode='42501';end if;
 select * into strict p from public.profiles where id=u for update;
 if exists(select 1 from pmoffice_private.member_details where user_id=u and signup_answers is not null) then raise exception '가입 신청 정보는 이미 접수되었습니다. 수정은 관리자에게 요청해 주세요.';end if;
 if p_position is null or length(trim(p_position)) not between 1 and 120 then raise exception '직함을 확인해 주세요.';end if;
 update public.profiles set position=p_position where id=u;
 insert into pmoffice_private.member_details(user_id,signup_answers,requested_services) values(u,jsonb_build_object('이름',p.display_name,'이메일', (select email from auth.users where id=u),'회사·소속',p.company,'직함',p_position,'회원 구분',p.member_kind),p_codes)
 on conflict(user_id) do update set signup_answers=excluded.signup_answers,requested_services=excluded.requested_services,updated_at=now();
 insert into public.audit_log(actor_id,action,target_id,details) values(u,'member.service_requested',u::text,jsonb_build_object('requested',p_codes,'grants_changed',false));
 return jsonb_build_object('requested',p_codes,'grants_changed',false);
end$$;

create function public.member_admin_requested_services_save(p_user uuid,p_codes text[],p_reason text default '',p_expected_updated_at timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare prior pmoffice_private.member_details;stamp timestamptz;begin
 perform pmoffice_private.require_admin();
 if p_user is null or exists(select 1 from public.admin_roles where user_id=p_user) then raise insufficient_privilege;end if;
 if p_codes is null or cardinality(p_codes)>15 or length(coalesce(p_reason,''))>2000 then raise exception '신청 서비스와 사유를 확인해 주세요.' using errcode='22023';end if;
 perform pmoffice_private.validate_service_codes(p_codes,false);
 perform 1 from public.profiles where id=p_user for update;if not found then raise insufficient_privilege;end if;
 select * into prior from pmoffice_private.member_details where user_id=p_user for update;
 if prior.updated_at is distinct from p_expected_updated_at then raise exception '다른 변경이 있습니다. 새로 조회해 주세요.' using errcode='40001';end if;
 if prior.requested_services=p_codes and prior.requested_services_source='admin' then return jsonb_build_object('changed',false,'grants_changed',false);end if;
 stamp:=clock_timestamp();
 insert into pmoffice_private.member_details(user_id,requested_services,requested_services_source,requested_services_updated_by,requested_services_updated_at,updated_at)
 values(p_user,p_codes,'admin',auth.uid(),stamp,stamp)
 on conflict(user_id) do update set requested_services=excluded.requested_services,requested_services_source='admin',requested_services_updated_by=auth.uid(),requested_services_updated_at=stamp,updated_at=stamp;
 insert into public.audit_log(actor_id,action,target_id,details) values(auth.uid(),'member.requested_services_set',p_user::text,jsonb_build_object('reason',coalesce(nullif(trim(p_reason),''),'관리자 신청 서비스 설정'),'before',prior.requested_services,'after',p_codes,'source','admin','grants_changed',false));
 return jsonb_build_object('changed',true,'requested',p_codes,'source','admin','updated_at',stamp,'grants_changed',false);
end$$;
create trigger pmo_change_signal after insert or update or delete on pmoffice_private.member_details for each row execute function pmoffice_private.change_signal('members');
revoke all on function public.member_admin_requested_services_save(uuid,text[],text,timestamptz) from public,anon;
grant execute on function public.member_admin_requested_services_save(uuid,text[],text,timestamptz) to authenticated;
notify pgrst,'reload schema';
commit;
