// Only disposable containers on the local daemon, with no Internet or project secrets.
import {spawnSync} from 'node:child_process'
import {resolve} from 'node:path'
import {existsSync,mkdirSync,mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs'
import assert from 'node:assert/strict'
import {setTimeout as delay} from 'node:timers/promises'
const root=process.cwd(),cache=resolve(process.env.PUSH_TEST_DENO_CACHE || 'work/deno-cache')
assert.ok(existsSync(cache),'First cache the test dependencies with DENO_DIR=work/deno-cache deno cache --config tests/edge-push/deno.json tests/edge-push/index.ts')
const environment={...process.env}
for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete environment[key]
const image='supabase/edge-runtime:v1.76.2@sha256:edd22bef4477b900d5c300e287ce9b18bff9b81a0291bee14ee0b7c7b71a2899'
const prefix=`meteo-push-edge-${process.pid}`
mkdirSync('work',{recursive:true})
const fixtures=mkdtempSync(resolve('work/edge-tls-'))
const openssl=args=>assert.equal(spawnSync('openssl',args,{stdio:'ignore'}).status,0,'Local test TLS certificate generation failed')
openssl(['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',`${fixtures}/ca-key.pem`,'-out',`${fixtures}/ca.pem`,'-days','1','-subj','/CN=Isolated Push Test CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign'])
openssl(['req','-new','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',`${fixtures}/key.pem`,'-out',`${fixtures}/cert.csr`,'-subj','/CN=fcm.googleapis.com'])
writeFileSync(`${fixtures}/extensions.cnf`,'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:fcm.googleapis.com\n')
openssl(['x509','-req','-in',`${fixtures}/cert.csr`,'-CA',`${fixtures}/ca.pem`,'-CAkey',`${fixtures}/ca-key.pem`,'-CAcreateserial','-out',`${fixtures}/cert.pem`,'-days','1','-extfile',`${fixtures}/extensions.cnf`])
writeFileSync(`${fixtures}/ca-bundle.pem`,Buffer.concat([readFileSync('/etc/ssl/certs/ca-certificates.crt'),readFileSync(`${fixtures}/ca.pem`)]))
const docker=(args,allowFailure=false)=>{
 const result=spawnSync('docker',['--host=unix:///var/run/docker.sock',...args],{env:environment,encoding:'utf8',timeout:60000})
 if(!allowFailure && (result.error || result.status!==0))throw Error(`Local Docker ${args[0]} failed`)
 return result
}
const probe=name=>docker(['run','--rm','--pull','never','--network',`container:${name}`,'postgres:17-bookworm','timeout','30','bash','-c','exec 3<>/dev/tcp/127.0.0.1/9000; printf "POST / HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\nContent-Length: 0\\r\\n\\r\\n" >&3; cat <&3'],true)
try {
 for(const [suffix,service,expected] of [['disabled','/app/supabase/functions/push-test',503],['fixture','/app/tests/edge-push',200]]){
  const name=`${prefix}-${suffix}`
  docker(['run','-d','--pull','never','--name',name,'--network','none',
   '--mount',`type=bind,src=${root}/supabase/functions,dst=/app/supabase/functions,readonly`,
   '--mount',`type=bind,src=${root}/tests/edge-push,dst=/app/tests/edge-push,readonly`,
   '--mount',`type=bind,src=${cache},dst=/cache`,'--mount',`type=bind,src=${fixtures},dst=/fixtures,readonly`,
   '-e','DENO_DIR=/cache','-e','DENO_CERT=/fixtures/ca.pem','-e','DENO_TLS_CA_STORE=system',
   '-e','SSL_CERT_FILE=/fixtures/ca-bundle.pem',image,'start','--main-service',service,'--static','/fixtures/*'])
  if(suffix==='fixture'){
   docker(['run','-d','--pull','never','--name',`${prefix}-provider`,'--network',`container:${name}`,
    '--mount',`type=bind,src=${root}/tests/edge-push,dst=/tests,readonly`,
    '--mount',`type=bind,src=${fixtures},dst=/fixtures,readonly`,'node:24-bookworm-slim','node','/tests/provider.mjs'])
   let ready=false
   for(let i=0;i<20;i++){if(docker(['logs',`${prefix}-provider`]).stdout.includes('fixture-ready')){ready=true;break}await delay(250)}
   assert.ok(ready,'Isolated TLS provider startup failed')
  }
  let result
  for(let i=0;i<20;i++){
   result=probe(name)
   if(result.status===0 && result.stdout.startsWith('HTTP/1.1 '))break
   await delay(250)
  }
  assert.match(result.stdout,new RegExp(`^HTTP/1.1 ${expected} `))
  const body=JSON.parse(result.stdout.slice(result.stdout.indexOf('\r\n\r\n')+4))
  if(suffix==='disabled')assert.deepEqual(body,{error:'PUSH_TEST_DISABLED',deliveryEnabled:false})
  else assert.deepEqual(body,{cryptoReady:true,accepted:200,duplicate:409,sent:1,encrypted:true,tlsReady:true,redirectRefused:true,wrongNameRejected:true,tlsError:'NONE'})
  console.log(`PASS: Supabase Edge Runtime ${suffix} (${expected}); network none, no project secrets`)
  docker(['rm','-f',name])
 }
}finally{for(const suffix of ['provider','disabled','fixture'])docker(['rm','-f',`${prefix}-${suffix}`],true);rmSync(fixtures,{recursive:true,force:true})}
