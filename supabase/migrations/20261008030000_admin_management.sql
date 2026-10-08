-- Stage 4: MANUAL ONLY. No Auth mutations are enabled by this migration.
begin;
alter table public.admin_audit_log drop constraint admin_audit_log_action_check;
alter table public.admin_audit_log add constraint admin_audit_log_action_check
 check(action in ('user_details_view','user_favorites_view','manual_pro_grant','free_restore','account_block','account_restore'));
alter table public.admin_audit_log add column reason text,
 add column previous_value text, add column new_value text, add column request_id uuid;
alter table public.admin_audit_log add constraint admin_audit_reason_check
 check(reason is null or reason in ('manual_access','manual_revoke','abuse','security','policy'));
create unique index admin_audit_request on public.admin_audit_log(request_id) where request_id is not null;
create index admin_audit_user_time on public.admin_audit_log(object_id, occurred_at desc, id desc);

create function public.admin_set_manual_plan(target_id uuid, desired_plan text, expected_plan text, operation_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare s public.subscriptions; prior public.admin_audit_log; changed_at timestamptz; actor uuid := auth.uid();
begin
 if actor is null or not public.is_meteo_admin() then raise insufficient_privilege; end if;
 -- Hold actor membership until commit: revocation cannot race the mutation.
 perform 1 from public.admin_memberships where user_id=actor for share;
 if not found then raise insufficient_privilege; end if;
 if target_id is null or operation_id is null or desired_plan is null or desired_plan not in ('free','pro')
  or expected_plan is null or expected_plan not in ('free','pro') then raise invalid_parameter_value; end if;
 -- Global request serialization before account lock; retries never repeat writes.
 perform pg_advisory_xact_lock(hashtextextended(operation_id::text, 4));
 select * into prior from public.admin_audit_log where request_id=operation_id;
 if found then
  if prior.admin_id<>actor or prior.object_id<>target_id or prior.previous_value<>expected_plan or prior.new_value<>desired_plan
   then raise exception 'REQUEST_CONFLICT' using errcode='P0001'; end if;
  return jsonb_build_object('confirmed',true,'replayed',true,'plan',prior.new_value,'changedAt',prior.occurred_at);
 end if;
 select * into s from public.subscriptions where user_id=target_id for update;
 if not found then raise exception 'SUBSCRIPTION_MISSING' using errcode='P0001'; end if;
 if s.provider_customer_id is not null or s.provider_subscription_id is not null or s.status<>'active'
  or (s.plan='pro' and not exists(select 1 from public.admin_audit_log a where a.object_id=target_id
   and a.action='manual_pro_grant' and a.outcome='success' and a.occurred_at=s.updated_at))
  then raise exception 'EXTERNAL_SUBSCRIPTION_PROTECTED' using errcode='P0001'; end if;
 if s.plan<>expected_plan then raise exception 'STALE_PLAN' using errcode='P0001'; end if;
 if s.plan=desired_plan then raise exception 'PLAN_UNCHANGED' using errcode='P0001'; end if;
 changed_at := clock_timestamp();
 update public.subscriptions set plan=desired_plan, updated_at=changed_at where user_id=target_id;
 insert into public.admin_audit_log(admin_id,action,object_type,object_id,outcome,reason,previous_value,new_value,request_id,occurred_at)
 values(actor,case when desired_plan='pro' then 'manual_pro_grant' else 'free_restore' end,'user',target_id,'success',
  case when desired_plan='pro' then 'manual_access' else 'manual_revoke' end,s.plan,desired_plan,operation_id,changed_at);
 return jsonb_build_object('confirmed',true,'replayed',false,'plan',desired_plan,'changedAt',changed_at);
end; $$;

create function public.admin_management_account(selected_id uuid) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_meteo_admin() then raise insufficient_privilege; end if;
 if selected_id is null then raise invalid_parameter_value; end if;
 select jsonb_build_object('id',u.id,'plan',s.plan,'subscriptionStatus',s.status,
  'bannedUntil',u.banned_until,'blocked',coalesce(u.banned_until>now(),false),
  'isAdmin',exists(select 1 from public.admin_memberships where user_id=u.id),
  'manualPro', s.plan='pro' and exists(select 1 from public.admin_audit_log a where a.object_id=u.id
   and a.action='manual_pro_grant' and a.outcome='success' and a.occurred_at=s.updated_at),
  'canManagePlan',s.user_id is not null and s.provider_customer_id is null and s.provider_subscription_id is null and s.status='active'
   and (s.plan='free' or exists(select 1 from public.admin_audit_log a where a.object_id=u.id
    and a.action='manual_pro_grant' and a.outcome='success' and a.occurred_at=s.updated_at)),
  'history',(select coalesce(jsonb_agg(h order by occurred_at desc,id desc),'[]'::jsonb) from
   (select id,admin_id,action,occurred_at,outcome,reason,previous_value,new_value from public.admin_audit_log where object_id=u.id order by occurred_at desc,id desc limit 50) h)
 ) into result from auth.users u left join public.subscriptions s on s.user_id=u.id where u.id=selected_id;
 insert into public.admin_audit_log(admin_id,action,object_type,object_id,outcome)
 values(auth.uid(),'user_details_view','user',selected_id,case when result is null then 'not_found' else 'success' end);
 return result;
end; $$;

create function public.admin_management_users(search_text text default '', page_number integer default 1,
 access_status text default '', selected_plan text default '', registered_from date default null, registered_to date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare result jsonb;
begin
 if auth.uid() is null or not public.is_meteo_admin() then raise insufficient_privilege; end if;
 if search_text is null or length(search_text)>254 or page_number is null or page_number not between 1 and 1000000
  or access_status is null or access_status not in ('','active','blocked') or selected_plan is null or selected_plan not in ('','free','pro')
  or (registered_from is not null and registered_to is not null and registered_from>registered_to) then raise invalid_parameter_value; end if;
 with matching as (
  select u.id,u.email,u.created_at,u.last_sign_in_at,u.raw_app_meta_data->'providers' providers,p.display_name,s.plan,
   coalesce(u.banned_until>now(),false) blocked
  from auth.users u left join public.profiles p on p.user_id=u.id left join public.subscriptions s on s.user_id=u.id
  where (strpos(lower(coalesce(u.email,'')),lower(search_text))>0 or strpos(lower(coalesce(p.display_name,'')),lower(search_text))>0)
   and (selected_plan='' or s.plan=selected_plan)
   and (access_status='' or coalesce(u.banned_until>now(),false)=(access_status='blocked'))
   and (registered_from is null or u.created_at >= (registered_from::timestamp at time zone 'UTC'))
   and (registered_to is null or u.created_at < ((registered_to+1)::timestamp at time zone 'UTC'))
 ) select jsonb_build_object('users',(select coalesce(jsonb_agg(r order by created_at desc,id),'[]'::jsonb) from
  (select * from matching order by created_at desc,id limit 20 offset (page_number-1)*20) r),
  'total',(select count(*) from matching),'pageSize',20,'page',page_number) into result;
 return result;
end; $$;

create function public.admin_management_summary() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
 if auth.uid() is null or not public.is_meteo_admin() then raise insufficient_privilege; end if;
 return jsonb_build_object('blocked',(select count(*) from auth.users where banned_until>now()),
  'asOf',now(),'blockEnabled',false,'scope','auth_banned_until_and_admin_database',
  'entries',(select coalesce(jsonb_agg(r order by occurred_at desc,id desc),'[]'::jsonb) from
   (select id,occurred_at,admin_id,action,object_id,outcome from public.admin_audit_log order by occurred_at desc,id desc limit 5) r));
end; $$;

create or replace function public.admin_audit_entries(period text default '30', selected_action text default '', page_number integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare cutoff timestamptz;
begin
 if auth.uid() is null or not public.is_meteo_admin() then raise insufficient_privilege; end if;
 if period is null or period not in ('7','30','90','12m') or selected_action is null
  or selected_action not in ('','user_details_view','user_favorites_view','manual_pro_grant','free_restore','account_block','account_restore')
  or page_number is null or page_number not between 1 and 1000000 then raise invalid_parameter_value; end if;
 cutoff := now()-case when period='12m' then interval '12 months' else period::integer*interval '1 day' end;
 return jsonb_build_object('entries',(select coalesce(jsonb_agg(r order by occurred_at desc,id desc),'[]'::jsonb) from
  (select * from public.admin_audit_log where occurred_at>=cutoff and (selected_action='' or action=selected_action)
   order by occurred_at desc,id desc limit 20 offset (page_number-1)*20) r),
  'total',(select count(*) from public.admin_audit_log where occurred_at>=cutoff and (selected_action='' or action=selected_action)),'pageSize',20);
end; $$;
revoke all on function public.admin_set_manual_plan(uuid,text,text,uuid),public.admin_management_account(uuid),public.admin_management_users(text,integer,text,text,date,date),public.admin_management_summary() from public,anon,authenticated,service_role;
grant execute on function public.admin_set_manual_plan(uuid,text,text,uuid),public.admin_management_account(uuid),public.admin_management_users(text,integer,text,text,date,date),public.admin_management_summary() to authenticated;
commit;
