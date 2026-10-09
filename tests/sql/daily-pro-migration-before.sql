-- Synthetic disposable account and Production-shaped legacy rows. Local runner only.
insert into auth.users(id,email) values('91000000-0000-0000-0000-000000000001','daily-migration@example.invalid');
insert into public.weather_alerts(user_id,event_key,kind,location_key,city,zone,event,is_read,hidden,updated_at)
select '91000000-0000-0000-0000-000000000001',key,kind,'432:279','Legacy city',zone,
 jsonb_build_object('kind',kind,'start',extract(epoch from starts)*1000,'end',extract(epoch from starts+interval '2 hours')*1000,
 'feelsLikeMin',18,'feelsLikeMax',20,'rainProbability',10,'rain',0,'wind',5),was_read,was_hidden,'2026-10-01T12:00Z'
from (values
 ('legacy-read','garden','Europe/Sofia','2026-10-25T05:00Z'::timestamptz,true,false),
 ('legacy-hidden','garden','Europe/Sofia','2026-10-25T13:00Z'::timestamptz,false,true),
 ('legacy-unread','sport','Europe/Sofia','2026-10-25T09:00Z'::timestamptz,false,false),
 ('legacy-zone','garden','UTC','2026-10-25T05:00Z'::timestamptz,false,false),
 ('legacy-next-day','garden','Europe/Sofia','2026-10-26T05:00Z'::timestamptz,false,false)
) v(key,kind,zone,starts,was_read,was_hidden);
insert into public.weather_alerts(user_id,event_key,kind,location_key,city,zone,event,is_read)
 values('91000000-0000-0000-0000-000000000001','legacy-risk','wind','432:279','Legacy city','Europe/Sofia',
 '{"kind":"wind","start":1792890000000,"end":1792893600000,"min":65,"max":65}',true);
create table public.daily_migration_originals as
 select user_id,event_key,kind,location_key,city,zone,event,updated_at,is_read,hidden
 from public.weather_alerts where user_id='91000000-0000-0000-0000-000000000001';
