-- Review and apply separately; never execute against Production from this PR.
-- No backfill: existing accounts and consent rows remain unchanged.
create table public.activity_signup_offer (
 user_id uuid primary key references auth.users(id) on delete cascade,
 state text not null default 'pending' check (state in ('pending','shown','answered'))
);
alter table public.activity_signup_offer enable row level security;
alter table public.activity_signup_offer force row level security;
revoke all on public.activity_signup_offer from public, anon, authenticated, service_role;

create function public.enroll_activity_signup_offer() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
 insert into public.activity_signup_offer(user_id) values(new.id);
 return new;
end; $$;
revoke all on function public.enroll_activity_signup_offer() from public, anon, authenticated, service_role;
create trigger enroll_activity_signup_offer after insert on auth.users
for each row execute function public.enroll_activity_signup_offer();

create function public.claim_activity_offer() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare subject uuid := auth.uid(); claimed boolean := false;
begin
 if subject is null or not exists(select 1 from auth.users where id=subject and email_confirmed_at is not null) then raise insufficient_privilege; end if;
 perform pg_advisory_xact_lock(hashtextextended(subject::text,610));
 -- A profile privacy decision always takes precedence, including explicit refusal.
 update public.activity_signup_offer set state='answered' where user_id=subject
 and exists(select 1 from public.activity_consent where user_id=subject);
 update public.activity_signup_offer set state='shown' where user_id=subject and state='pending';
 claimed := found;
 return jsonb_build_object('offer',claimed);
end; $$;

create function public.answer_activity_offer(desired boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare subject uuid := auth.uid();
begin
 if subject is null or not exists(select 1 from auth.users where id=subject and email_confirmed_at is not null) then raise insufficient_privilege; end if;
 if desired is null then raise invalid_parameter_value; end if;
 perform pg_advisory_xact_lock(hashtextextended(subject::text,610));
 if exists(select 1 from public.activity_signup_offer where user_id=subject and state in ('pending','shown'))
 and not exists(select 1 from public.activity_consent where user_id=subject) then
  perform public.set_activity_consent(desired);
 end if;
 update public.activity_signup_offer set state='answered' where user_id=subject;
 return public.get_activity_consent();
end; $$;
revoke all on function public.claim_activity_offer(), public.answer_activity_offer(boolean) from public, anon, authenticated, service_role;
grant execute on function public.claim_activity_offer(), public.answer_activity_offer(boolean) to authenticated;
