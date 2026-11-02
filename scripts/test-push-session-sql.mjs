// Local disposable PostgreSQL only: no DB URL, host networking, secrets or Push.
import {spawnSync} from 'node:child_process'
import {readFileSync,readdirSync} from 'node:fs'
import assert from 'node:assert/strict'
import {setTimeout as delay} from 'node:timers/promises'
const name=`meteo-session-target-${process.pid}`,environment={...process.env}
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
 const input=read('tests/sql/admin-bootstrap.sql')+'\n'+readdirSync(new URL('../supabase/migrations',import.meta.url)).filter(f=>f.endsWith('.sql')).sort().map(f=>read('supabase/migrations/'+f)).join('\n')+'\n'+read('tests/sql/push-session-target.sql')
 docker(['exec','-i',name,'psql','-U','postgres','-v','ON_ERROR_STOP=1'],input)
 console.log('PASS: all migrations + session target grants/defaults/scope/account/revision/expiry/claim/burn/replay (isolated PostgreSQL 17)')
}finally{docker(['rm','-f',name],undefined,true)}
