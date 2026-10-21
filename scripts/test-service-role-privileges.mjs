// Only a disposable local PostgreSQL 17 container; never accepts a database URL.
import { spawnSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'
const name = `meteo-privileges-${process.pid}`
const env = { ...process.env }
for (const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) delete env[key]
function docker(args, input, allowFailure = false) {
  const r = spawnSync('docker', ['--host=unix:///var/run/docker.sock', ...args], { env, input, encoding: 'utf8', timeout: 60000 })
  if (!allowFailure && (r.error || r.status !== 0)) throw Error(r.error?.message || r.stderr)
  return r
}
const sql = s => docker(['exec','-i',name,'psql','-h','127.0.0.1','-X','-At','-U','postgres','-v','ON_ERROR_STOP=1'], s).stdout.trim()
const read = p => readFileSync(p, 'utf8')
const tables = "('public.favorite_places'::regclass,'public.place_settings'::regclass,'public.gemini_project_quota'::regclass)"
const grants = `select c.relname,a.grantor,a.grantee,a.privilege_type,a.is_grantable from pg_class c cross join lateral aclexplode(c.relacl) a where c.oid in ${tables}`
const snapshot = `select jsonb_build_object(
 'tables',(select jsonb_agg(to_jsonb(c)-'relacl' order by c.oid) from pg_class c where c.oid in ${tables}),
 'columns',(select jsonb_agg(to_jsonb(a) order by a.attrelid,a.attnum) from pg_attribute a where a.attrelid in ${tables}),
 'policies',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p),
 'constraints',(select jsonb_agg(to_jsonb(c) order by c.oid) from pg_constraint c),
 'triggers',(select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t),
 'functions',(select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p where p.pronamespace='public'::regnamespace),
 'other_acl',(select jsonb_agg(to_jsonb(g) order by relname,grantee,privilege_type) from (${grants} and not (a.grantee='service_role'::regrole and a.privilege_type in ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN'))) g));`
function privileges(expected) {
  assert.equal(sql(`select count(*) from (${grants} and a.grantee='service_role'::regrole and a.privilege_type in ('TRUNCATE','REFERENCES','TRIGGER','MAINTAIN')) g;`), expected ? '12' : '0')
  assert.equal(sql(`select bool_and(has_table_privilege('service_role',c.oid,p) = ${expected}) from pg_class c cross join unnest(array['TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p where c.oid in ${tables};`), 't')
}
try {
  docker(['run','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-bookworm'])
  let ready = false
  for (let i=0;i<100;i++) { if (docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],undefined,true).status===0) { ready=true; break } await delay(250) }
  assert.ok(ready, 'PostgreSQL startup timeout')
  console.log('PostgreSQL:', sql('show server_version;'))
  sql(read('tests/sql/admin-bootstrap.sql'))
  for (const file of readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql') && f < '20261021130000').sort()) sql(read(`supabase/migrations/${file}`))
  // Reproduce the audited production baseline, without granting CRUD.
  sql(`revoke all on public.favorite_places,public.place_settings,public.gemini_project_quota from service_role; grant TRUNCATE,REFERENCES,TRIGGER,MAINTAIN on public.favorite_places,public.place_settings,public.gemini_project_quota to service_role;`)
  privileges(true)
  assert.equal(sql(`select bool_and(not has_table_privilege('service_role',c.oid,p)) from pg_class c cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) p where c.oid in ${tables};`), 't')
  const before = sql(snapshot), aclBefore = sql(`select * from (${grants}) g order by 1,2,3,4;`)
  const migration = read('supabase/migrations/20261021130000_service_role_table_privileges.sql')
  sql(migration); privileges(false); assert.equal(sql(snapshot),before)
  sql(migration); privileges(false); assert.equal(sql(snapshot),before)
  // Real role switching: invoker RPC, column UPDATE, RLS isolation and FK action.
  sql(`begin;
insert into auth.users(id) values ('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
set local role authenticated;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
insert into public.favorite_places(id,name,latitude,longitude) values ('33333333-3333-4333-8333-333333333333','Test city',42,23);
update public.favorite_places set geoname_id=123 where id='33333333-3333-4333-8333-333333333333';
select public.set_my_default_place('33333333-3333-4333-8333-333333333333');
do $$ begin if not exists(select 1 from public.place_settings where default_place_id='33333333-3333-4333-8333-333333333333') then raise exception 'Default RPC failed'; end if; end $$;
set local request.jwt.claim.sub='22222222-2222-4222-8222-222222222222';
do $$ begin if exists(select 1 from public.favorite_places) then raise exception 'RLS isolation failed'; end if;
begin perform public.set_my_default_place('33333333-3333-4333-8333-333333333333'); raise exception 'Foreign default accepted'; exception when insufficient_privilege then null; end; end $$;
set local request.jwt.claim.sub='11111111-1111-4111-8111-111111111111';
delete from public.favorite_places;
do $$ begin if exists(select 1 from public.place_settings where default_place_id is not null) then raise exception 'FK SET NULL failed'; end if; end $$;
reset role;
set local role service_role;
select public.gemini_quota('reserve',20);
select public.gemini_quota('block',20);
do $$ begin if public.gemini_quota('reserve',20)->>'reason' <> 'cooldown' then raise exception 'Quota service role failed'; end if; end $$;
rollback;`)
  for (const file of ['admin-security','admin-favorites','admin-stage3','gemini-quota']) sql(read(`tests/sql/${file}.sql`))
  sql(read('supabase/rollbacks/20261021130000_service_role_table_privileges.sql'))
  privileges(true); assert.equal(sql(`select * from (${grants}) g order by 1,2,3,4;`),aclBefore)
  console.log('PASS: before/after effective privileges, exact ACL rollback, idempotence, unchanged CRUD/column ACL/RLS/RPC/FK/triggers, authenticated places/default/RLS, service-role quota, existing admin and quota SQL suites')
} finally { docker(['rm','-f',name],undefined,true) }
