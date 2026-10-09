-- Disposable PostgreSQL: invariants through the real security-definer RPC.
begin;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
update public.subscriptions set plan='pro',status='active' where user_id=auth.uid();
create function pg_temp.daily_event(hour integer,kind text default 'garden') returns jsonb language sql as $$
 select jsonb_build_object('kind',kind,'start',extract(epoch from date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'+interval '1 day'+hour*interval '1 hour')*1000,
 'end',extract(epoch from date_trunc('day',now() at time zone 'UTC') at time zone 'UTC'+interval '1 day'+(hour+2)*interval '1 hour')*1000,
 'feelsLikeMin',18,'feelsLikeMax',20,'rainProbability',10,'rain',0,'wind',5);
$$;
create function pg_temp.daily_generate(events jsonb,location text default '432:279',zone text default 'UTC') returns jsonb language plpgsql as $$ begin
 update public.alert_generation_state set last_generated=now()-interval '31 seconds' where user_id=auth.uid();
 return public.my_alerts(jsonb_build_object('operation','generate','city','Synthetic daily city','locationKey',location,'zone',zone,'events',events));
end $$;
do $$ declare a jsonb; b jsonb; key text; ev jsonb; day text; begin
 perform public.my_alerts('{"operation":"settings","enabled":["garden","sport","wind"]}');
 a:=pg_temp.daily_generate(jsonb_build_array(pg_temp.daily_event(7),pg_temp.daily_event(11),pg_temp.daily_event(15)));
 if jsonb_array_length(a->'alerts')<>1 or jsonb_array_length(a->'alerts'->0->'event'->'windows')<>3 then raise exception 'same-day windows created multiple notifications';end if;
 key:=a->'alerts'->0->>'key';day:=a->'alerts'->0->'event'->>'day';
 begin
  insert into public.weather_alerts(user_id,event_key,kind,location_key,city,zone,event,recommendation_date)
   select user_id,'forged-second-daily-key',kind,location_key,city,zone,event,recommendation_date
   from public.weather_alerts where user_id=auth.uid() and event_key=key;
  raise exception 'daily unique index bypassed';
 exception when unique_violation then null;end;
 if a->'alerts'->0->'event'->'windows'->0->>'start'<>pg_temp.daily_event(7)->>'start' then raise exception 'windows not sorted';end if;
 perform public.my_alerts(jsonb_build_object('operation','read','locationKey','432:279','zone','UTC','key',key));
 b:=pg_temp.daily_generate(jsonb_build_array(pg_temp.daily_event(17)));
 if jsonb_array_length(b->'alerts')<>1 or b->'alerts'->0->>'key'<>key or not (b->'alerts'->0->>'read')::boolean
  or b->'alerts'->0->'event'->'windows'<>jsonb_build_array(pg_temp.daily_event(17)-'kind') then raise exception 'disjoint refresh lost identity/read or retained stale windows';end if;
 perform public.my_alerts(jsonb_build_object('operation','hide','locationKey','432:279','zone','UTC','key',key));
 b:=pg_temp.daily_generate(jsonb_build_array(pg_temp.daily_event(9)));
 if b->'alerts'<>'[]'::jsonb then raise exception 'hidden daily recommendation revived';end if;
 if not exists(select 1 from public.weather_alerts where user_id=auth.uid() and event_key=key and hidden and is_read
  and event->'windows'=jsonb_build_array(pg_temp.daily_event(9)-'kind')) then raise exception 'hidden refresh failed to update existing row';end if;
 -- Other day, activity, city, timezone and user must not inherit the tombstone.
 b:=pg_temp.daily_generate(jsonb_build_array(pg_temp.daily_event(31)));
 if jsonb_array_length(b->'alerts')<>1 or b->'alerts'->0->'event'->>'day'=day then raise exception 'next date merged';end if;
 b:=pg_temp.daily_generate(jsonb_build_array(pg_temp.daily_event(9,'sport')));
 if jsonb_array_length(b->'alerts')<>2 then raise exception 'other activity merged';end if;
 if jsonb_array_length(pg_temp.daily_generate(jsonb_build_array(pg_temp.daily_event(9)),'427:233')->'alerts')<>1 then raise exception 'city state mixed';end if;
 if jsonb_array_length(pg_temp.daily_generate(jsonb_build_array(pg_temp.daily_event(9)),'432:279','Europe/Sofia')->'alerts')<>1 then raise exception 'zone state mixed';end if;
 -- Separate dangerous events on one day are not consolidated by day.
 ev:=jsonb_build_array((pg_temp.daily_event(7)-array['feelsLikeMin','feelsLikeMax','rainProbability','rain','wind'])||'{"kind":"wind","min":65,"max":65}'::jsonb,
  (pg_temp.daily_event(15)-array['feelsLikeMin','feelsLikeMax','rainProbability','rain','wind'])||'{"kind":"wind","min":65,"max":65}'::jsonb);
 b:=pg_temp.daily_generate(ev,'500:300');if jsonb_array_length(b->'alerts')<>2 then raise exception 'separate risks merged';end if;
 begin perform pg_temp.daily_generate(jsonb_build_array(pg_temp.daily_event(7),pg_temp.daily_event(8)),'501:300');raise exception 'overlapping windows accepted';exception when raise_exception then if sqlerrm<>'overlapping daily windows' then raise;end if;end;
 begin perform pg_temp.daily_generate(jsonb_build_array(pg_temp.daily_event(23)),'501:300');raise exception 'cross-day window accepted';exception when raise_exception then if sqlerrm<>'activity crosses local date' then raise;end if;end;
 -- A burst of risks cannot evict an active daily read/hidden tombstone.
 insert into public.weather_alerts(user_id,event_key,kind,location_key,city,zone,event)
 select auth.uid(),'risk-burst-'||n,'wind','600:300','Burst','UTC',jsonb_build_object('kind','wind','start',0,'end',1,'min',65,'max',65) from generate_series(1,205)n;
 perform public.my_alerts('{"operation":"load","locationKey":"432:279","zone":"UTC"}');
 if not exists(select 1 from public.weather_alerts where user_id=auth.uid() and event_key=key and hidden) then raise exception 'risk burst evicted daily tombstone';end if;
 update public.subscriptions set plan='free' where user_id=auth.uid();
 if public.my_alerts('{"operation":"load","locationKey":"427:233","zone":"UTC"}')->'alerts'<>'[]'::jsonb then raise exception 'Free received personal history';end if;
 begin perform pg_temp.daily_generate(jsonb_build_array(pg_temp.daily_event(9)),'427:233');raise exception 'Free generated personal';exception when insufficient_privilege then null;end;
 update public.subscriptions set plan='pro' where user_id=auth.uid();
 if pg_temp.daily_generate(jsonb_build_array(pg_temp.daily_event(19)))->'alerts'->0->>'key'=key then raise exception 'hidden marker returned on Pro restoration';end if;
 if not exists(select 1 from public.weather_alerts where user_id=auth.uid() and event_key=key and hidden) then raise exception 'rights switch erased hidden marker';end if;
end $$;
-- SQL uses the city's date even at UTC midnight boundaries and DST folds/gaps.
do $$ begin
 if (to_timestamp(1791493200) at time zone 'Europe/Sofia')::date<>'2026-10-09' then raise exception 'Sofia midnight date wrong';end if;
 if ('2026-10-25T00:30Z'::timestamptz at time zone 'Europe/Sofia')::date<>('2026-10-25T01:30Z'::timestamptz at time zone 'Europe/Sofia')::date then raise exception 'DST fold changed date';end if;
 if ('2026-03-29T00:30Z'::timestamptz at time zone 'Europe/Sofia')::date<>('2026-03-29T01:30Z'::timestamptz at time zone 'Europe/Sofia')::date then raise exception 'DST gap changed date';end if;
 if ('2026-10-08T18:15Z'::timestamptz at time zone 'Asia/Kathmandu')::date<>'2026-10-09' then raise exception 'fractional offset wrong';end if;
end $$;
set local role authenticated;
do $$ begin
 begin perform 1 from public.weather_alerts;raise exception 'daily table directly exposed';exception when insufficient_privilege then null;end;
 if public.my_alerts()->>'dailyActivityVersion'<>'1' then raise exception 'daily capability missing';end if;
end $$;
reset role;
rollback;
select 'PASS: daily grouping/disjoint updates/read/hidden, day/kind/city/zone separation, risks, DST, rights and tombstone retention' as result;
