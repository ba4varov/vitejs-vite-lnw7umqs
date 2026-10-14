// Local disposable PostgreSQL only: no DB URL, host networking, secrets or Push.
import {spawnSync} from 'node:child_process'
import {readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {setTimeout as delay} from 'node:timers/promises'
const name=`meteo-key-diagnostic-${process.pid}`,environment={...process.env}
for(const k of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete environment[k]
const docker=(args,input,allowFailure=false)=>{
 const r=spawnSync('docker',['--host=unix:///var/run/docker.sock',...args],{env:environment,input,encoding:'utf8',timeout:60000})
 if(!allowFailure)assert.equal(r.status,0,r.error?.message||r.stderr)
 return r
}
try {
 docker(['run','-d','--pull','never','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','postgres:17-bookworm'])
 let ready=false
 for(let i=0;i<40;i++){if(docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres'],undefined,true).status===0){ready=true;break}await delay(250)}
 assert.ok(ready,'Local PostgreSQL startup timeout')
 const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
 // Exact production table/policy DDL; unrelated my_push RPC dependencies omitted.
 const tables=read('supabase/migrations/20261009040000_web_push_preparation.sql').split('create function public.my_push')[0]+'\ncommit;'
 const input=read('tests/sql/admin-bootstrap.sql')+'\n'+tables+'\n'+read('supabase/migrations/20261014060000_push_key_diagnostics.sql')+'\n'+read('tests/sql/push-key-diagnostics.sql')
 const r=docker(['exec','-i',name,'psql','-U','postgres','-v','ON_ERROR_STOP=1'],input)
 console.log(r.stdout)
}finally{docker(['rm','-f',name],undefined,true)}
