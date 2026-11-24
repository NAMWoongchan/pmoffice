begin;
create extension if not exists pg_cron with schema pg_catalog;
do $$begin if not exists(select 1 from vault.secrets where name='auto_trading_paper_recovery') then perform vault.create_secret(encode(extensions.gen_random_bytes(32),'hex'),'auto_trading_paper_recovery','Server paper recovery only; no exchange keys');end if;end$$;
create function public.auto_trading_paper_recovery_auth(p_token text) returns boolean language sql security definer set search_path='' as $$select length(p_token)=64 and exists(select 1 from vault.decrypted_secrets where name='auto_trading_paper_recovery' and decrypted_secret=p_token)$$;
revoke all on function public.auto_trading_paper_recovery_auth(text) from public,anon,authenticated;grant execute on function public.auto_trading_paper_recovery_auth(text) to service_role;
create function pmoffice_private.paper_recovery() returns void language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from pmoffice_private.paper_events where state in('queued','awaiting_exit')) then
 perform net.http_post(url:='https://wkpoervofwniizdcklre.supabase.co/functions/v1/auto-trading-paper/recover',headers:=jsonb_build_object('Content-Type','application/json','x-paper-worker',(select decrypted_secret from vault.decrypted_secrets where name='auto_trading_paper_recovery')),body:='{}',timeout_milliseconds:=5000);
 end if;end$$;
revoke all on function pmoffice_private.paper_recovery() from public,anon,authenticated;
select cron.schedule('auto-trading-paper-recovery','* * * * *','select pmoffice_private.paper_recovery();');
commit;
