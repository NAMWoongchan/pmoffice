begin;
create or replace function public.member_mail_bridge(p_message text,p_signature text) returns jsonb
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
revoke all on function public.member_mail_bridge(text,text) from public,anon,authenticated;
grant execute on function public.member_mail_bridge(text,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
