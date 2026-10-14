-- REVIEW ONLY: read-only diagnostics. Do not apply automatically to a hosted DB.
begin;
-- Internal helper: decoded bytes, domain-separated nonce-bound SHA-256, then a
-- fixed 32-byte XOR/OR loop (no content-dependent early exit or prefix equality).
create function public.push_key_proof_status(key_text text, proof text, context_bytes bytea, key_size integer) returns text
language plpgsql immutable set search_path='' as $$
declare decoded bytea; expected bytea; supplied bytea; difference integer:=0; i integer;
begin
 if key_text is null or key_text='' or proof='missing' then return 'missing';end if;
 if proof is null or proof='unavailable' then return 'unavailable';end if;
 if proof !~ '^[a-f0-9]{64}$' or key_size not in (16,65) then return 'unavailable';end if;
 if (key_size=65 and key_text !~ '^[A-Za-z0-9_-]{87}$') or (key_size=16 and key_text !~ '^[A-Za-z0-9_-]{22}$') then return 'unavailable';end if;
 decoded:=decode(translate(key_text,'-_','+/')||case when key_size=65 then '=' else '==' end,'base64');
 if octet_length(decoded)<>key_size or rtrim(translate(replace(encode(decoded,'base64'),E'\n',''),'+/','-_'),'=')<>key_text then return 'unavailable';end if;
 if key_size=65 and get_byte(decoded,0)<>4 then return 'unavailable';end if;
 expected:=sha256(context_bytes||decoded);supplied:=decode(proof,'hex');
 for i in 0..31 loop difference:=difference | (get_byte(expected,i) # get_byte(supplied,i));end loop;
 return case when difference=0 then 'match' else 'mismatch' end;
exception when others then return 'unavailable';
end $$;
revoke all on function public.push_key_proof_status(text,text,bytea,integer) from public,anon,authenticated,service_role;

create function public.check_my_push_keys(device_id uuid,endpoint_fingerprint text,nonce_hex text,p256dh_proof text,auth_proof text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare d public.push_devices; context_text text; unavailable jsonb:='{"p256dh":"unavailable","auth":"unavailable"}'::jsonb;
begin
 if auth.uid() is null or not exists(select 1 from auth.users u where u.id=auth.uid() and (u.banned_until is null or u.banned_until<=now()) and (to_jsonb(u)->>'deleted_at') is null) then raise insufficient_privilege;end if;
 if endpoint_fingerprint is null or endpoint_fingerprint !~ '^[a-f0-9]{64}$' or nonce_hex is null or nonce_hex !~ '^[a-f0-9]{64}$'
  or p256dh_proof is null or not (p256dh_proof ~ '^[a-f0-9]{64}$' or p256dh_proof in ('missing','unavailable'))
  or auth_proof is null or not (auth_proof ~ '^[a-f0-9]{64}$' or auth_proof in ('missing','unavailable')) then return unavailable;end if;
 -- Gate both ownership and exact endpoint identity BEFORE touching key material.
 select * into d from public.push_devices p where p.id=device_id and p.user_id=auth.uid() and p.fingerprint=endpoint_fingerprint;
 if not found then return unavailable;end if;
 context_text:=E'meteo-pulse:push-key:v1\n'||device_id::text||E'\n'||endpoint_fingerprint||E'\n'||nonce_hex||E'\n';
 return jsonb_build_object(
  'p256dh',public.push_key_proof_status(d.p256dh,p256dh_proof,convert_to(context_text||E'p256dh\n','UTF8'),65),
  'auth',public.push_key_proof_status(d.auth_key,auth_proof,convert_to(context_text||E'auth\n','UTF8'),16));
end $$;
revoke all on function public.check_my_push_keys(uuid,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.check_my_push_keys(uuid,text,text,text,text) to authenticated;
commit;
