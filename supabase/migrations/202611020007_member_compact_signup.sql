-- Required profile fields apply to future registration and edits; existing rows and grants are preserved.
begin;
alter table public.profiles alter column member_kind set default 'individual';
create or replace function pmoffice_private.member_require_fields(p_name text,p_company text,p_position text,p_kind text) returns void language plpgsql set search_path='' as $$begin
 if p_name is null or length(trim(p_name)) not between 1 and 120 or p_company is null or length(trim(p_company)) not between 1 and 200 or p_position is null or length(trim(p_position)) not between 1 and 120 or p_kind is null or p_kind not in('business','individual') then raise exception '이름, 직함, 회사명·소속을 모두 입력해 주세요.' using errcode='22023';end if;
end$$;
create or replace function public.member_complete_registration(p_name text,p_company text,p_kind text,p_accept boolean) returns void
language plpgsql security definer set search_path='' as $$
declare p public.profiles; v text; src text;
begin
 if auth.uid() is null or p_accept is distinct from true then raise insufficient_privilege;end if;
 perform pmoffice_private.member_require_fields(p_name,p_company,(select position from public.profiles where id=auth.uid()),p_kind);
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
create or replace function public.member_profile_save(p_user uuid,p_name text,p_company text,p_kind text) returns void
language plpgsql security definer set search_path='' as $$
declare a boolean:=coalesce(pmoffice_private.is_admin(),false);
begin
 if not a and (p_user is distinct from auth.uid() or not coalesce(pmoffice_private.account_ok(),false)) then raise insufficient_privilege;end if;
 perform pmoffice_private.member_require_fields(p_name,p_company,(select position from public.profiles where id=p_user),p_kind);
 update public.profiles set display_name=trim(p_name),company=trim(p_company),member_kind=p_kind where id=p_user;
 if not found then raise exception '회원이 없습니다.';end if;
 insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'member.profile',p_user::text);
end$$;
create or replace function public.member_admin_register(p_user uuid,p_name text,p_company text,p_kind text) returns void
language plpgsql security definer set search_path='' as $$
declare v text;
begin
 if not coalesce(pmoffice_private.is_admin(),false) then raise insufficient_privilege;end if;
 perform pmoffice_private.member_require_fields(p_name,p_company,(select position from public.profiles where id=p_user),p_kind);
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
create or replace function public.member_position_save(p_user uuid,p_position text) returns void
language plpgsql security definer set search_path='' as $$begin
 if not coalesce(pmoffice_private.is_admin(),false) and (p_user is distinct from auth.uid() or not coalesce(pmoffice_private.account_ok(),false)) then raise insufficient_privilege;end if;
 if p_position is null or length(trim(p_position)) not between 1 and 120 then raise exception '직함을 확인해 주세요.';end if;
 update public.profiles set position=trim(p_position) where id=p_user;
 if not found then raise exception '회원이 없습니다.';end if;
 insert into public.audit_log(actor_id,action,target_id) values(auth.uid(),'member.position',p_user::text);
end$$;
create or replace function public.member_signup_service_request(p_codes text[],p_position text default '') returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();p public.profiles;begin
 if u is null or not coalesce(pmoffice_private.account_ok(),false) then raise insufficient_privilege;end if;
 perform pmoffice_private.validate_service_codes(p_codes,false);
 select * into strict p from public.profiles where id=u for update;
 if exists(select 1 from pmoffice_private.member_details where user_id=u and signup_answers is not null) then raise exception '가입 신청 정보는 이미 접수되었습니다. 수정은 관리자에게 요청해 주세요.';end if;
 if p_position is null or length(trim(p_position)) not between 1 and 120 then raise exception '직함을 확인해 주세요.';end if;
 update public.profiles set position=p_position where id=u;
 insert into pmoffice_private.member_details(user_id,signup_answers,requested_services) values(u,jsonb_build_object('이름',p.display_name,'이메일', (select email from auth.users where id=u),'회사·소속',p.company,'직함',p_position,'회원 구분',p.member_kind),p_codes)
 on conflict(user_id) do update set signup_answers=excluded.signup_answers,requested_services=excluded.requested_services,updated_at=now();
 insert into public.audit_log(actor_id,action,target_id,details) values(u,'member.service_requested',u::text,jsonb_build_object('requested',p_codes,'grants_changed',false));
 return jsonb_build_object('requested',p_codes,'grants_changed',false);
end$$;
create or replace function public.member_account() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare p public.profiles; email text; ok boolean;
begin
 if auth.uid() is null then return jsonb_build_object('signed_in',false,'member',false,'admin',false);end if;
 select * into p from public.profiles where id=auth.uid();
 select u.email into email from auth.users u where u.id=auth.uid();
 ok:=coalesce(pmoffice_private.account_ok(),false);
 return jsonb_build_object('signed_in',true,'member',ok,'admin',coalesce(pmoffice_private.is_admin(),false),'profile',to_jsonb(p)||jsonb_build_object('email',email),
 'google_account',exists(select 1 from auth.identities where user_id=auth.uid() and provider='google'),'signup_version',(select member_signup_version from pmoffice_private.service_settings where singleton));
end$$;

-- Atomic write entrypoints: no partially completed membership if required fields/service request fails.
create function public.member_complete_profile(p_name text,p_company text,p_kind text,p_position text,p_accept boolean,p_codes text[] default '{}') returns void language plpgsql security definer set search_path='' as $$begin
 if auth.uid() is null then raise insufficient_privilege;end if;
 perform pmoffice_private.member_require_fields(p_name,p_company,p_position,p_kind);
 perform 1 from public.profiles where id=auth.uid() and registered_at is null and status='active' and withdrawn_at is null for update;
 if not found then raise insufficient_privilege;end if;
 update public.profiles set position=trim(p_position) where id=auth.uid();
 perform public.member_complete_registration(p_name,p_company,p_kind,p_accept);
 perform public.member_signup_service_request(p_codes,trim(p_position));
end$$;
create function public.member_profile_fields_save(p_user uuid,p_name text,p_company text,p_kind text,p_position text) returns void language plpgsql security definer set search_path='' as $$begin
 if not coalesce(pmoffice_private.is_admin(),false) and (p_user is distinct from auth.uid() or not coalesce(pmoffice_private.account_ok(),false)) then raise insufficient_privilege;end if;
 perform pmoffice_private.member_require_fields(p_name,p_company,p_position,p_kind);
 perform 1 from public.profiles where id=p_user for update;if not found then raise insufficient_privilege;end if;
 perform public.member_position_save(p_user,trim(p_position));
 perform public.member_profile_save(p_user,p_name,p_company,p_kind);
end$$;
create function public.member_admin_profile_register(p_user uuid,p_name text,p_company text,p_kind text,p_position text) returns void language plpgsql security definer set search_path='' as $$begin
 perform pmoffice_private.require_admin();
 perform pmoffice_private.member_require_fields(p_name,p_company,p_position,p_kind);
 perform public.member_position_save(p_user,trim(p_position));
 perform public.member_admin_register(p_user,p_name,p_company,p_kind);
end$$;
create function public.member_admin_signup_answers(p_users uuid[]) returns jsonb language plpgsql stable security definer set search_path='' as $$begin
 perform pmoffice_private.require_admin();
 if p_users is null or cardinality(p_users)>100 then raise exception '한 페이지의 회원만 조회해 주세요.';end if;
 return coalesce((select jsonb_agg(jsonb_build_object('user_id',p.id,'answers',coalesce(d.corrected_answers,d.signup_answers),'original_recorded',d.signup_answers is not null,'requested_names',coalesce((select jsonb_agg(c->>'name') from jsonb_array_elements(public.member_service_catalog()) c where c->>'id'=any(d.requested_services)),'[]'::jsonb))) from public.profiles p left join pmoffice_private.member_details d on d.user_id=p.id where p.id=any(p_users)),'[]'::jsonb);
end$$;
revoke all on function pmoffice_private.member_require_fields(text,text,text,text) from public,anon,authenticated;
revoke all on function public.member_complete_profile(text,text,text,text,boolean,text[]),public.member_profile_fields_save(uuid,text,text,text,text),public.member_admin_profile_register(uuid,text,text,text,text),public.member_admin_signup_answers(uuid[]) from public,anon;
grant execute on function public.member_complete_profile(text,text,text,text,boolean,text[]),public.member_profile_fields_save(uuid,text,text,text,text),public.member_admin_profile_register(uuid,text,text,text,text),public.member_admin_signup_answers(uuid[]) to authenticated;
notify pgrst,'reload schema';
commit;
