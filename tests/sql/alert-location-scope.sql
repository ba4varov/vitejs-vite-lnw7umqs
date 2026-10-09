-- Disposable PostgreSQL only: location/zone isolation and rate limits.
begin;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$ declare a jsonb; b jsonb; c jsonb; ev jsonb; pa jsonb; pb jsonb; pc jsonb; begin
 perform public.my_alerts('{"operation":"settings","enabled":["rain"]}');
 ev:=jsonb_build_array(jsonb_build_object('kind','rain','start',extract(epoch from now()+interval '1 hour')*1000,'end',extract(epoch from now()+interval '2 hours')*1000,'min',12,'max',12));
 pa:=jsonb_build_object('operation','generate','locationKey','432:279','zone','UTC','city','City A','events',ev);
 pb:=pa||'{"locationKey":"427:233","city":"City B"}'::jsonb;
 pc:=pa||'{"zone":"Europe/Sofia","city":"City A other zone"}'::jsonb;
 a:=public.my_alerts(pa);b:=public.my_alerts(pb);c:=public.my_alerts(pc);
 if jsonb_array_length(a->'alerts')<>1 or jsonb_array_length(b->'alerts')<>1 or jsonb_array_length(c->'alerts')<>1 then raise exception 'new location/zone was throttled or mixed';end if;
 if a->'alerts'->0->>'city'<>'City A' or b->'alerts'->0->>'city'<>'City B' or c->'alerts'->0->>'zone'<>'Europe/Sofia' then raise exception 'wrong scope';end if;
 if public.my_alerts()->'alerts'<>'[]'::jsonb then raise exception 'unscoped load leaked history';end if;
 begin perform public.my_alerts('{"operation":"clear"}');raise exception 'unscoped clear accepted';exception when raise_exception then if sqlerrm='unscoped clear accepted' then raise;end if;end;
 begin perform public.my_alerts('{"operation":"load","locationKey":"432:279"}');raise exception 'partial scope accepted';exception when raise_exception then if sqlerrm='partial scope accepted' then raise;end if;end;
 perform public.my_alerts(jsonb_build_object('operation','read','locationKey','427:233','zone','UTC','key',a->'alerts'->0->>'key'));
 a:=public.my_alerts('{"operation":"load","locationKey":"432:279","zone":"UTC"}');if (a->'alerts'->0->>'read')::boolean then raise exception 'foreign scope read changed A';end if;
 a:=public.my_alerts(jsonb_build_object('operation','read','locationKey','432:279','zone','UTC','key',a->'alerts'->0->>'key'));
 if not (a->'alerts'->0->>'read')::boolean then raise exception 'scoped read failed';end if;
 b:=public.my_alerts('{"operation":"load","locationKey":"427:233","zone":"UTC"}');if (b->'alerts'->0->>'read')::boolean then raise exception 'A read affected B';end if;
 b:=public.my_alerts(jsonb_build_object('operation','hide','locationKey','427:233','zone','UTC','key',b->'alerts'->0->>'key'));if b->'alerts'<>'[]'::jsonb then raise exception 'hide failed';end if;
 a:=public.my_alerts('{"operation":"clear","locationKey":"432:279","zone":"UTC"}');if a->'alerts'<>'[]'::jsonb then raise exception 'clear failed';end if;
 if jsonb_array_length(public.my_alerts(pc)->'alerts')<>1 then raise exception 'clear affected other time zone';end if;
 if public.my_alerts(pa)->'alerts'<>'[]'::jsonb or public.my_alerts(pb)->'alerts'<>'[]'::jsonb then raise exception 'immediate refresh revived tombstone';end if;
 if public.my_alerts()->'enabled'<>'["rain"]'::jsonb then raise exception 'settings lost';end if;
 begin perform 1 from public.alert_generation_state;raise exception 'generation state table exposed';exception when insufficient_privilege then null;end;
end $$;
reset role;
-- Exercise refresh after the cooldown, without waiting 30 seconds.
update public.alert_generation_state set last_generated=now()-interval '31 seconds' where user_id='00000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$ declare ev jsonb; begin
 ev:=jsonb_build_array(jsonb_build_object('kind','rain','start',extract(epoch from now()+interval '1 hour')*1000,'end',extract(epoch from now()+interval '2 hours')*1000,'min',12,'max',12));
 if public.my_alerts(jsonb_build_object('operation','generate','locationKey','432:279','zone','UTC','city','A refreshed','events',ev))->'alerts'<>'[]'::jsonb then raise exception 'clear marker revived after cooldown';end if;
 if public.my_alerts(jsonb_build_object('operation','generate','locationKey','427:233','zone','UTC','city','B refreshed','events',ev))->'alerts'<>'[]'::jsonb then raise exception 'hidden marker revived after cooldown';end if;
end $$;
reset role;
update public.alert_settings set generation_tokens=0,generation_refilled_at=now() where user_id='00000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$ begin
 begin perform public.my_alerts('{"operation":"generate","locationKey":"500:300","zone":"UTC","city":"Abuse","events":[]}');raise exception 'global budget bypassed';exception when raise_exception then if sqlerrm<>'ALERTS_RATE_LIMITED' then raise;end if;end;
 -- A cached scope costs no additional generation token.
 perform public.my_alerts('{"operation":"generate","locationKey":"432:279","zone":"UTC","city":"Cached","events":[]}');
end $$;
reset role;
do $$ begin
 if exists(select 1 from public.alert_generation_state where location_key='500:300') then raise exception 'rejected request persisted rate state';end if;
 if (select count(*) from public.weather_alerts where user_id='00000000-0000-0000-0000-000000000002')<>3 then raise exception 'duplicate or deleted other history';end if;
end $$;
update public.alert_settings set generation_refilled_at=now()-interval '3 seconds' where user_id='00000000-0000-0000-0000-000000000002';
set local role authenticated;
do $$ begin perform public.my_alerts('{"operation":"generate","locationKey":"500:300","zone":"UTC","city":"Refilled","events":[]}');end $$;
reset role;
set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000001';
set local role authenticated;
do $$ begin if public.my_alerts('{"operation":"load","locationKey":"432:279","zone":"Europe/Sofia"}')->'alerts'<>'[]'::jsonb then raise exception 'account isolation failed';end if;end $$;
reset role;
rollback;
