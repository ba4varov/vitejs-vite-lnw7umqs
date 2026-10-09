do $$ begin
 if exists(select * from public.daily_migration_originals except
  select user_id,event_key,kind,location_key,city,zone,event,updated_at,is_read,hidden from public.weather_alerts)
 then raise exception 'migration lost or rewrote original history/state';end if;
 if (select count(*) from public.weather_alerts where user_id='91000000-0000-0000-0000-000000000001' and not superseded)<>5
 then raise exception 'migration failed to separate kind, zone or day';end if;
 if not exists(select 1 from public.weather_alerts where user_id='91000000-0000-0000-0000-000000000001'
  and not superseded and kind='garden' and zone='Europe/Sofia' and recommendation_date='2026-10-25' and is_read and hidden)
 then raise exception 'migration did not preserve both acknowledgment flags';end if;
 if (select jsonb_array_length(event->'windows') from public.weather_alerts where user_id='91000000-0000-0000-0000-000000000001'
  and not superseded and kind='garden' and zone='Europe/Sofia' and recommendation_date='2026-10-25')<>2
 then raise exception 'latest legacy windows were not preserved in the daily recommendation';end if;
 if not exists(select 1 from public.weather_alerts where event_key='legacy-risk' and not superseded and recommendation_date is null and is_read)
 then raise exception 'risk history was consolidated';end if;
 if exists(select 1 from public.weather_alerts where user_id='91000000-0000-0000-0000-000000000001'
  and not superseded and kind='sport' and (hidden or is_read)) then raise exception 'unread activity falsely acknowledged';end if;
end $$;
-- Delete only this fixture's entire synthetic account after testing cascade.
delete from auth.users where id='91000000-0000-0000-0000-000000000001';
drop table public.daily_migration_originals;
select 'PASS: migration preserves every original row, merges read/hidden intent, separates zone/kind/day, leaves risks unchanged' as result;
