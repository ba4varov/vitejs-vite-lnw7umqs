// Disposable local PostgreSQL only; no remote URL or credentials accepted.
import {spawnSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {setTimeout as delay} from 'node:timers/promises'
const name=`meteo-signup-consent-${process.pid}`
const environment={...process.env}
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete environment[key]
function docker(args,input){const r=spawnSync('docker',['--host=unix:///var/run/docker.sock',...args],{input,env:environment,encoding:'utf8',timeout:60000});if(r.status!==0)throw Error(r.stderr);return r.stdout}
const sql=s=>docker(['exec','-i',name,'psql','-h','127.0.0.1','-U','postgres','-v','ON_ERROR_STOP=1'],s)
try {
 docker(['run','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-bookworm'])
 let ready=false
 for(let i=0;i<100;i++){try{sql('select 1');ready=true;break}catch{await delay(250)}}
 if(!ready)throw Error(docker(['logs',name]))
 sql(readFileSync('tests/sql/admin-bootstrap.sql','utf8'))
 sql("alter table auth.users add column email_confirmed_at timestamptz; create function public.is_meteo_admin() returns boolean language sql as $$select false$$;")
 sql(readFileSync('supabase/migrations/20261008040000_user_activity.sql','utf8'))
 sql("insert into auth.users(id,email_confirmed_at) values('00000000-0000-0000-0000-000000000001',now());")
 sql(readFileSync('supabase/migrations/20261009060000_activity_signup_offer.sql','utf8'))
 sql(readFileSync('tests/sql/signup-activity.sql','utf8'))
 console.log('PASS: old accounts, unconfirmed email, enrollment, single offer, refusal, opt-in, withdrawal, stale answers, RLS and account isolation')
}finally{docker(['rm','-f',name])}
