// GitHub Actions/local Docker ONLY. No Supabase CLI, database or project credentials.
import {spawnSync} from 'node:child_process'
import {resolve} from 'node:path'
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,existsSync} from 'node:fs'
import assert from 'node:assert/strict'
import {setTimeout as delay} from 'node:timers/promises'
import webpush from 'web-push'

const root=process.cwd(),cache=resolve('work/transport-compat-cache'),output=resolve('work/transport-compat-report.json')
const image='supabase/edge-runtime:v1.76.2@sha256:edd22bef4477b900d5c300e287ce9b18bff9b81a0291bee14ee0b7c7b71a2899'
const nodeImage='node:24.14.0-bookworm-slim',prefix=`meteo-transport-compat-${process.pid}`
mkdirSync('work',{recursive:true})
const fixtures=mkdtempSync(resolve('work/transport-compat-fixtures-'))
const report={schema:1,image,expectedEdgeVersion:'1.76.2',reproduced:false,isolation:{network:'none',externalEndpoints:0,syntheticOnly:true},productionIntegration:false}
const environment={...process.env}
let phase='offline_cache'
for(const name of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete environment[name]
function docker(args,{allowFailure=false,timeout=60000}={}){
 const result=spawnSync('docker',['--host=unix:///var/run/docker.sock',...args],{env:environment,encoding:'utf8',timeout,maxBuffer:2*1024*1024})
 if(!allowFailure)assert.ok(!result.error && result.status===0,`Local Docker operation failed: ${args[0]}`)
 return result
}
function openssl(args){assert.equal(spawnSync('openssl',args,{stdio:'ignore'}).status,0,'Synthetic certificate generation failed')}
try{
 assert.ok(existsSync(cache),'Missing offline dependency cache; run the documented Deno cache step')
 phase='docker_and_images'
 docker(['info'])
 docker(['pull',image],{timeout:180000})
 docker(['pull',nodeImage],{timeout:180000})
 phase='edge_version'
 const version=docker(['run','--rm','--network','none',image,'--version'])
 report.edgeVersionOutput=(version.stdout+version.stderr).trim()
 // Release images can embed the generic Cargo package version 0.1.0.
 // Verify release identity by independently resolving its tag to the exact same image.
 const releaseTag='supabase/edge-runtime:v1.76.2'
 docker(['pull',releaseTag],{timeout:180000})
 report.imageId=docker(['image','inspect',image,'--format','{{.Id}}']).stdout.trim()
 report.releaseTagImageId=docker(['image','inspect',releaseTag,'--format','{{.Id}}']).stdout.trim()
 assert.equal(report.imageId,report.releaseTagImageId,'Release tag differs from pinned image; no substitute allowed')
 assert.match(report.edgeVersionOutput,/^edge-runtime (?:0\.1\.0|1\.76\.2)\ndeno 2\.1\.4 /,'Unexpected embedded binary version')
 report.versionVerification='release_tag_equals_pinned_image_id_and_repo_digest'
 report.repoDigests=JSON.parse(docker(['image','inspect',image,'--format','{{json .RepoDigests}}']).stdout)
 assert.ok(report.repoDigests.some(d=>d.endsWith(image.split('@')[1])),'Image digest mismatch')
 phase='synthetic_fixtures'
 openssl(['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',`${fixtures}/ca-key.pem`,'-out',`${fixtures}/ca.pem`,'-days','1','-subj','/CN=Synthetic Transport CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign'])
 openssl(['req','-new','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',`${fixtures}/key.pem`,'-out',`${fixtures}/cert.csr`,'-subj','/CN=push.test.invalid'])
 writeFileSync(`${fixtures}/extensions.cnf`,'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:push.test.invalid,DNS:redirect.test.invalid\n')
 openssl(['x509','-req','-in',`${fixtures}/cert.csr`,'-CA',`${fixtures}/ca.pem`,'-CAkey',`${fixtures}/ca-key.pem`,'-CAcreateserial','-out',`${fixtures}/cert.pem`,'-days','1','-extfile',`${fixtures}/extensions.cnf`])
 const vapid=webpush.generateVAPIDKeys(),receiver=webpush.generateVAPIDKeys()
 const details=webpush.generateRequestDetails({endpoint:'https://push.test.invalid:9443/wp/synthetic',keys:{p256dh:receiver.publicKey,auth:Buffer.alloc(16,7).toString('base64url')}},JSON.stringify({title:'Синтетичен тест',body:'Local fixture only',eventId:'b0000000-0000-0000-0000-000000000001'}),{TTL:60,urgency:'very-low',contentEncoding:'aes128gcm',vapidDetails:{...vapid,subject:'mailto:synthetic@example.invalid'}})
 writeFileSync(`${fixtures}/request.json`,JSON.stringify({...details,body:details.body.toString('base64')}),{mode:0o600})
 // Only the leaf key/cert, test CA and synthetic request enter the containers.
 // The generated VAPID private key is never saved or mounted.
 const mounts=['--mount',`type=bind,src=${root}/tests/transport-compat,dst=/app/tests/transport-compat,readonly`,
  '--mount',`type=bind,src=${root}/node_modules,dst=/app/node_modules,readonly`]
 for(const file of ['key.pem','cert.pem','ca.pem','request.json'])mounts.push('--mount',`type=bind,src=${fixtures}/${file},dst=/fixtures/${file},readonly`)
 docker(['run','-d','--pull','never','--name',`${prefix}-edge`,'--network','none',
  '--add-host','push.test.invalid:127.0.0.2','--add-host','wrong.test.invalid:127.0.0.2','--add-host','redirect.test.invalid:127.0.0.3',
  ...mounts,'--mount',`type=bind,src=${cache},dst=/cache`,
  '-e','DENO_DIR=/cache','-e','DENO_CERT=/fixtures/ca.pem','-e','DENO_TLS_CA_STORE=system',
  // Ensure no inherited proxy settings are injected into this isolated experiment.
  '-e','HTTP_PROXY=','-e','HTTPS_PROXY=','-e','ALL_PROXY=','-e','http_proxy=','-e','https_proxy=','-e','all_proxy=',
  image,'start','--main-service','/app/tests/transport-compat','--static','/fixtures/*'])
 docker(['run','-d','--pull','never','--name',`${prefix}-provider`,'--network',`container:${prefix}-edge`,...mounts,
  '-e','HTTP_PROXY=','-e','HTTPS_PROXY=','-e','ALL_PROXY=','-e','http_proxy=','-e','https_proxy=','-e','all_proxy=',
  nodeImage,'node','/app/tests/transport-compat/provider.mjs'])
 phase='provider_startup'
 let ready=false
 for(let i=0;i<40;i++){
  const logs=docker(['logs',`${prefix}-provider`],{allowFailure:true})
  if(logs.stdout.includes('synthetic-provider-ready')){ready=true;break}
  await delay(250)
 }
 assert.ok(ready,'Synthetic TLS provider could not start')
 const request=(url,method='GET',timeout=40000)=>docker(['exec',`${prefix}-provider`,'node','--input-type=module','-e',
  `const r=await fetch(${JSON.stringify(url)},{method:${JSON.stringify(method)},signal:AbortSignal.timeout(${timeout})}); process.stdout.write(JSON.stringify({status:r.status,body:await r.json()}));`],{allowFailure:true,timeout:timeout+5000})
 phase='node_reference'
 const reference=request('http://127.0.0.1:9080/baseline','POST',5000)
 assert.equal(reference.status,0,'Standard library reference request failed')
 report.reference=JSON.parse(reference.stdout).body
 assert.equal(report.reference.status,201)
 assert.equal(report.reference.selected,1)
 assert.equal(report.reference.decoy,0)
 assert.equal(report.reference.lookups,1)
 assert.equal(report.reference.wireMatches,true)
 assert.equal(report.reference.sniMatches,true)
 // Wait only for the service to accept TCP; the experiment itself is invoked exactly once.
 phase='edge_startup'
 let listening=false
 for(let i=0;i<40;i++){
  const probe=docker(['exec',`${prefix}-provider`,'node','--input-type=module','-e',"import{connect}from'node:net';const s=connect(9000,'127.0.0.1',()=>{s.end();process.exit(0)});s.on('error',()=>process.exit(1));setTimeout(()=>process.exit(1),500);"],{allowFailure:true,timeout:2000})
  if(probe.status===0){listening=true;break}await delay(250)
 }
 assert.ok(listening,'Actual Edge service could not start; ordinary Deno is not a substitute')
 phase='edge_experiment'
 const result=request('http://127.0.0.1:9000/')
 assert.equal(result.status,0,'Actual Edge experiment failed to return JSON')
 const response=JSON.parse(result.stdout)
 report.experiment=response.body
 assert.equal(response.status,200,'Actual Edge compatibility assertion failed')
 assert.ok(report.experiment.runtime?.deno,'Missing in-runtime Deno version')
 assert.equal(report.experiment.library,'web-push@3.6.7')
 report.reproduced=true
 // Every probe is one attempt. Failed pinning/TLS must not be called a safe transport.
 for(const row of report.experiment.observations){
  assert.ok(row.observed.selected+row.observed.decoy+row.observed.redirect<=1,'Multiple HTTP requests in a single probe')
 }
 report.complete=true
}catch{
 report.complete=false
 report.failure='COMPATIBILITY_HARNESS_FAILED_NO_RUNTIME_SUBSTITUTION'
 report.failureStage=phase
 process.exitCode=1
}finally{
 for(const suffix of ['provider','edge'])docker(['rm','-f',`${prefix}-${suffix}`],{allowFailure:true})
 rmSync(fixtures,{recursive:true,force:true})
 writeFileSync(output,JSON.stringify(report,null,2)+'\n')
 console.log(JSON.stringify(report,null,2)) // Fixed fields, counters, versions; no raw responses or keys.
}
