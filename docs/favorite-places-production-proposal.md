# Conditional Production proposal — NOT APPLIED

This document is for separate approval. No Production mismatch is confirmed, and no SQL was executed. This PR changes no migration files.

## Evidence needed before a migration

Use the safe `places_sync` event described in [the diagnosis](favorite-places-sync-diagnosis.md). Compare Production's migration history and read-only schema/grant/policy metadata against:

- `supabase/migrations/20260930010000_favorite_places.sql`
- `supabase/migrations/20260930020000_place_geoname_identity.sql`

Verify both tables, every selected column (including `created_at`), generated coordinate keys, unique constraints, the composite default foreign key, forced RLS, own-user policies, authenticated grants and `set_my_default_place(uuid)` security-invoker/EXECUTE contract. An operator should inspect metadata without retrieving user rows or changing secrets. No broad grant, RLS disablement or public/anonymous access is proposed.

## If only the GeoNames migration is confirmed missing

Evidence: `favorite_places` fails with 42703/PGRST204 and metadata confirms the identity columns are absent, while the base table contract is present. The required migration is the existing `20260930020000_place_geoname_identity.sql`, quoted below for review; existing favorites/defaults remain in place. This is a conditional proposal, not a runnable migration added to the deployment directory.

```sql
alter table public.favorite_places add column if not exists geoname_id bigint;
alter table public.favorite_places add column if not exists country_code text
  check (country_code is null or char_length(country_code) = 2);
alter table public.favorite_places add column if not exists admin1_id bigint;
create index if not exists favorite_places_geoname_id_idx
  on public.favorite_places (user_id, geoname_id) where geoname_id is not null;
grant update (geoname_id, country_code, admin1_id)
  on public.favorite_places to authenticated;
```

After an approved application, verify PostgREST's schema cache and authenticated SELECT/add/remove/default/backfill with dedicated test accounts. Existing column types and constraints must be inspected before applying: `IF NOT EXISTS` does not repair a column with an incompatible definition. No blind retry of schema writes is authorized.

## Other diagnostic outcomes

- Missing base tables / RPC (404/PGRST205/PGRST202/42P01): inspect migration history and dependencies, especially `20260930000000_auth_profiles.sql`; propose the missing portion of the existing base migration separately once table existence and user-data preservation are verified. Do not rerun its unconditional CREATE TABLE against an existing table.
- Permission error (403/42501): identify the exact missing SELECT/INSERT/DELETE, identity-column UPDATE, settings INSERT/UPDATE or RPC EXECUTE grant, or differing own-user policy. Prepare a targeted repair matching the existing migration, after inspecting current policies. A blanket grant is not justified by the generic error.
- Schema-cache mismatch with correct schema: this is an operational/cache issue; a data migration is not established as necessary.
- Session/network/server/response errors: schema changes are not supported by that evidence. Use the client recovery and investigate the corresponding service/network/auth condition.

Production changes require the user's separate approval after the mismatch and final proposed SQL are concrete. Nothing in this document authorizes execution, deployment, data deletion or secret changes.
