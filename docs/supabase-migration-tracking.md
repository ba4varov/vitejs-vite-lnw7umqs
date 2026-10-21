# Proposed adoption of Supabase CLI migration tracking

## Current state and scope

As reported by the operator on 2026-10-21, production uses PostgreSQL 17.6 and
has no `supabase_migrations.schema_migrations` table.
[PR #112 manual application and smoke checks](service-role-table-privileges.md#production-record--2026-10-21)
are recorded separately. No CLI history is created by this documentation PR.
This is a future proposal, not an approved production execution runbook.

Missing tracking is not evidence that SQL is pending. A successful manual
application is not a CLI tracking record. Do not run a blanket `supabase db push`,
production reset, automatic replay, or blanket `migration repair --status applied`.
Do not create the tracking schema/table with handwritten SQL.

## 1. Inventory and reconcile every migration

Freeze the reviewed repository commit and record its SHA. Inventory every file
in `supabase/migrations` in timestamp order, including later additions before
execution. Preserve historical SQL files and record content hashes; identify
duplicate versions, renamed/edited files, dependencies and manual changes.

The repository inventory at commit `e8532948fdd86679d065dfe32fc2762d37066c97` contains the
following 19 forward migrations. This checklist is documentation, not database
migration history and not a declaration that these versions are applied.

| Migration file | Evidence status |
| --- | --- |
| `20260930000000_auth_profiles.sql` | Not reconciled by this documentation update |
| `20260930010000_favorite_places.sql` | Not reconciled by this documentation update |
| `20260930020000_place_geoname_identity.sql` | Not reconciled by this documentation update |
| `20261008000000_admin_readonly.sql` | Not reconciled by this documentation update |
| `20261008010000_admin_user_favorites.sql` | Not reconciled by this documentation update |
| `20261008020000_admin_statistics_audit.sql` | Not reconciled by this documentation update |
| `20261008030000_admin_management.sql` | Not reconciled by this documentation update |
| `20261008040000_user_activity.sql` | Not reconciled by this documentation update |
| `20261009000000_planner_entitlement.sql` | Not reconciled by this documentation update |
| `20261009010000_weather_alerts.sql` | Not reconciled by this documentation update |
| `20261009020000_alert_location_scope.sql` | Not reconciled by this documentation update |
| `20261009030000_daily_pro_recommendations.sql` | Not reconciled by this documentation update |
| `20261009040000_web_push_preparation.sql` | Not reconciled by this documentation update |
| `20261009050000_web_push_test_delivery.sql` | Not reconciled by this documentation update |
| `20261009060000_activity_signup_offer.sql` | Not reconciled by this documentation update |
| `20261013050000_push_operator.sql` | Not reconciled by this documentation update |
| `20261014060000_push_key_diagnostics.sql` | Not reconciled by this documentation update |
| `20261018170000_gemini_quota.sql` | Not reconciled by this documentation update |
| `20261021130000_service_role_table_privileges.sql` | Manual application confirmed 2026-10-21; reconcile full effects before tracking |

For **each** version, a future operator/reviewer must record file hash, PR or
deployment evidence, expected changes, observed production effects, dependencies,
discrepancies, disposition and reviewer sign-off. Classify it as verified applied,
not applied, partially applied, superseded or unknown. Unknown/partial entries
block tracking adoption; file presence and matching object names are insufficient.

Compare expected effects against an approved read-only production catalog/schema
snapshot: tables, columns, types, defaults, indexes, constraints, triggers, function
bodies and SECURITY DEFINER/search_path/ownership, RLS policies and flags, role/table/
column/function/default grants. Reconcile data backfills and seed changes with
separate evidence; schema diff alone cannot establish their execution. Account for
later migrations replacing earlier objects, managed Supabase objects, Auth/storage
dependencies, production-only/manual changes and externally managed jobs.
For PR #112 specifically include the four privileges across all three tables and
retain the dated operator confirmation; do not infer unchanged ACLs from the
12 false results alone.

## 2. Rehearse in isolation

Select and pin a Supabase CLI version; review that version's documented behavior
for linking, migration listing, repair, dry runs and initialization when the
tracking table is absent. Explicitly confirm project/environment identity without
publishing connection credentials. Prepare a tested backup and restore plan
(schema, roles/grants and data as appropriate); restore only to an isolated,
access-controlled staging environment with sensitive data protected.

Using separate disposable databases, validate both a clean ordered replay (with
required Supabase dependencies) and reconciliation against a restored production
snapshot on compatible PostgreSQL 17.6. SQL execution belongs only to that future
approved rehearsal, not this documentation task. Disable outbound jobs and real
notifications. Exercise favorites/defaults/RLS, admin and quota/chatbot paths;
keep PR #113's application fix distinct.

Resolve every discrepancy in reviewed follow-up work. Where changes are missing
or partial, design a targeted forward correction and validate it in staging;
never replay historical files blindly. If a baseline/squash is needed instead,
review it as a separate strategy with explicit mapping of all historical versions
and fresh-install verification. Do not silently mix baseline and historical replay.

## 3. Review a concrete production tracking proposal

Only after reconciliation and staging pass, prepare a separate change request
with the exact version-to-status mapping, evidence, pinned CLI version, target
project, commands, expected metadata writes, backup/restore evidence, maintenance
window, owner, reviewer and stop/recovery criteria. Obtain explicit authorization
for production writes at that time.

Supabase CLI `migration repair` modifies tracking metadata; it does not execute
or validate the migration SQL and is not a schema repair. Only fully reconciled
versions may be proposed as applied. Validate the supported CLI initialization/
repair path in staging when the table is absent; do not assume that listing or
linking initializes it without writes. Do not fabricate execution timestamps or
claim CLI originally applied manually executed migrations. Preserve their actual
manual provenance in deployment notes.

No commands to create/repair production tracking are executed or authorized by
this plan. Avoid automatic migration/deployment jobs during the future cutover.

## 4. Controlled adoption and ongoing deployment

In the separately approved window, take the agreed backup, confirm no concurrent
schema changes, and revalidate the signed-off inventory against current state.
Perform only the reviewed tracking initialization/repair operations. Stop on
unexpected initialization, target mismatch, drift or pending historical SQL.
If tracking setup fails, stop before any schema deployment; use the rehearsed,
reviewed metadata recovery procedure rather than resetting production or changing
application privileges.

Compare CLI local/remote migration lists with the complete signed-off mapping.
Review a dry-run deployment plan: already applied historical versions must not
appear as pending. A dry run does not replace reconciliation or authorization.
Require explicit review of any genuinely pending new migrations before deployment.
Keep the dated manual record for PR #112 even after tracking exists.

After cutover, require a pinned CLI, reviewed forward migrations, staging checks,
backup/recovery readiness and captured application/verification evidence for each
production deployment. Prevent edits to applied migration files, detect schema and
history drift, and record manual emergency changes for later reconciliation.
