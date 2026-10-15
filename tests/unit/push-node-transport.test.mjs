import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer,Agent} from 'node:https'
import {execFileSync} from 'node:child_process'
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises'
import {resolve} from 'node:path'
import {tmpdir} from 'node:os'
import webpush from 'web-push'
import WebPushLib from 'web-push/src/web-push-lib.js'
import {isFcmEndpoint,isPublicAddress,prepareNodeAttempt,createNodeTransport} from '../../server/push-node-transport.js'
import {createNodeOperatorHandler} from '../../server/push-node-operator.js'
test('native HTTPS transport, synthetic keys and local TLS only',async t=>{
const temp=await mkdtemp(resolve(tmpdir(),'meteo-node-tls-')),servers=[]
const check=(name,run)=>t.test(name,run)
let mode='accepted',observed,expected
const privateSentinel='SYNTHETIC_PRIVATE_RESPONSE_MUST_NOT_ESCAPE'
const count=()=>({selected:0,decoy:0,decoyConnections:0,wrongCert:0,redirectConnections:0,wire:true,sni:true})
const reset=next=>{mode=next;observed=count()}
const openssl=args=>execFileSync('openssl',args,{stdio:'ignore'})
try{
 assert.match(process.version,/^v24\./);assert.equal(JSON.parse(await readFile(new URL('../../node_modules/web-push/package.json',import.meta.url))).version,'3.6.7')
 openssl(['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',`${temp}/ca-key.pem`,'-out',`${temp}/ca.pem`,'-days','1','-subj','/CN=Node Synthetic CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign'])
 for(const kind of ['good','wrong']){
  openssl(['req','-new','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',`${temp}/${kind}-key.pem`,'-out',`${temp}/${kind}.csr`,'-subj',`/CN=${kind==='good'?'push':'wrong'}.fixture.invalid`])
  await writeFile(`${temp}/${kind}.cnf`,`basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:${kind==='good'?'push.fixture.invalid,DNS:redirect.fixture.invalid':'wrong.fixture.invalid'}\n`)
  openssl(['x509','-req','-in',`${temp}/${kind}.csr`,'-CA',`${temp}/ca.pem`,'-CAkey',`${temp}/ca-key.pem`,'-CAcreateserial','-out',`${temp}/${kind}-cert.pem`,'-days','1','-extfile',`${temp}/${kind}.cnf`])
 }
 const ca=await readFile(`${temp}/ca.pem`)
 const vapid=webpush.generateVAPIDKeys(),subscriber=webpush.generateVAPIDKeys()
 const subscription={endpoint:'https://push.fixture.invalid/wp/synthetic',keys:{p256dh:subscriber.publicKey,auth:Buffer.alloc(16,9).toString('base64url')}}
 const payload=JSON.stringify({title:'Синтетичен Node PoC',body:'Local TLS only'})
 const options={TTL:60,urgency:'very-low',contentEncoding:'aes128gcm',vapidDetails:{...vapid,subject:'mailto:fixture@example.invalid'}}
 const details=webpush.generateRequestDetails(subscription,payload,options)
 expected=details
 let port
 reset('accepted')
 for(const [label,ip,kind] of [['selected','127.0.0.1','good'],['decoy','127.0.0.2','good'],['wrongCert','127.0.0.3','wrong'],['redirect','127.0.0.4','good']]){
  const server=createServer({key:await readFile(`${temp}/${kind}-key.pem`),cert:await readFile(`${temp}/${kind}-cert.pem`),ALPNProtocols:['http/1.1']},(req,res)=>{
   observed[label]=(observed[label]??0)+1
   const record=observed,scenario=mode,expectedCopy=expected,chunks=[]
   req.on('data',c=>chunks.push(c));req.on('end',()=>{
    const bytes=Buffer.concat(chunks)
    record.wire&&=req.method==='POST'&&req.url==='/wp/synthetic'&&req.headers.host==='push.fixture.invalid'&&bytes.equals(expectedCopy.body)&&Object.entries(expectedCopy.headers).every(([k,v])=>req.headers[k.toLowerCase()]===String(v))&&!req.headers['transfer-encoding']&&req.rawHeaders.filter((v,i)=>i%2===0&&v.toLowerCase()==='content-length').length===1
    record.sni&&=req.socket.servername==='push.fixture.invalid'&&req.socket.alpnProtocol==='http/1.1'
    if(scenario==='disconnect'){req.socket.destroy();return}
    if(scenario==='hang')return
    if(scenario==='redirect'){res.writeHead(307,{location:`https://redirect.fixture.invalid:${port}/wp/synthetic`});res.end();return}
    if(scenario==='headers-large'){res.writeHead(400,{'x-large':'A'.repeat(8192)});res.end();return}
    if(scenario==='many-interim'){for(let i=0;i<5;i++)res.writeContinue();res.writeHead(201);res.end();return}
    if(scenario==='body-hang'){res.writeHead(400,{'content-length':100});res.flushHeaders();res.write('I');return}
    if(scenario==='incomplete'){res.writeHead(400,{'content-length':100});res.flushHeaders();res.write('I');setTimeout(()=>res.destroy(),10);return}
    if(scenario==='large'){res.writeHead(400,{'content-length':65536});res.end(Buffer.alloc(65536,65));return}
    if(scenario==='chunked-large'){res.writeHead(400);res.write(Buffer.alloc(800,65));res.end(Buffer.alloc(800,65));return}
    if(scenario==='encoded'){res.writeHead(400,{'content-encoding':'gzip'});res.end('not decoded');return}
    if(scenario==='private'){res.writeHead(400);res.end(privateSentinel);return}
    if(scenario==='rejected'){res.writeHead(400,{'content-type':'text/plain'});res.end('INVALID_ARGUMENT');return}
    if(scenario==='throttled'){res.writeHead(429,{'retry-after':'120'});res.end();return}
    if(scenario==='throttled-date'){res.writeHead(429,{'retry-after':new Date(Date.now()+3600000).toUTCString()});res.end();return}
    if(scenario==='throttled-invalid'){res.writeHead(429,{'retry-after':privateSentinel});res.end();return}
    res.writeHead(201);res.end()
   })
  })
  server.on('tlsClientError',()=>{})
  if(label==='redirect')server.on('connection',()=>observed.redirectConnections++)
  if(label==='decoy')server.on('connection',()=>observed.decoyConnections++)
  await new Promise(resolve=>server.listen(port??0,ip,resolve));port??=server.address().port;servers.push(server)
 }
 const resolver=async()=>[{address:'127.0.0.1',family:4}]
 const prepare=createNodeTransport({port,ca,deadlineMs:600,bodyDeadlineMs:100,validEndpoint:value=>value==='https://push.fixture.invalid/wp/synthetic',allowedAddress:(ip,family)=>family===4&&/^127\.0\.0\.[1-4]$/.test(ip)})
 const attempt=async scenario=>{reset(scenario);expected=details;const once=await prepare(details,resolver);const start=performance.now();try{return {result:await once(),elapsed:performance.now()-start}}catch(error){return {error:error.diagnosticCode,elapsed:performance.now()-start}}}

 await check('FCM endpoint and public DNS policies fail closed before any request',async()=>{
  assert.equal(isFcmEndpoint('https://fcm.googleapis.com/wp/synthetic'),true)
  assert.equal(isFcmEndpoint('https://fcm.googleapis.com/fcm/send/synthetic'),true)
  for(const endpoint of ['http://fcm.googleapis.com/wp/synthetic','https://fcm.googleapis.com:443/wp/synthetic','https://evil.invalid/wp/synthetic','https://user@fcm.googleapis.com/wp/synthetic','https://fcm.googleapis.com/wp/synthetic?x=1','https://fcm.googleapis.com/wp/synthetic#x','https://fcm.googleapis.com/wp/../synthetic','https://fcm.googleapis.com.evil.invalid/wp/synthetic'])assert.equal(isFcmEndpoint(endpoint),false)
  for(const [address,family] of [['127.0.0.1',4],['10.1.1.1',4],['169.254.169.254',4],['0.0.0.0',4],['::1',6],['::ffff:8.8.8.8',6],['8.8.8.8',6]])assert.equal(isPublicAddress(address,family),false)
  let dns=0
  await assert.rejects(prepareNodeAttempt(details,async()=>{dns++;return []}));assert.equal(dns,0)
  const fcm=webpush.generateRequestDetails({...subscription,endpoint:'https://fcm.googleapis.com/wp/synthetic'},payload,options)
  for(const addresses of [[],[{address:'127.0.0.1',family:4}],[{address:'8.8.8.8',family:4},{address:'10.0.0.1',family:4}],[{address:'8.8.8.8',family:6}]])await assert.rejects(prepareNodeAttempt(fcm,async()=>addresses),/UNSAFE_DNS/)
 })
 await check('headers/body/options cannot add arbitrary targets, proxy or framing',async()=>{
  for(const changed of [{...details,proxy:'https://evil.invalid'},{...details,agent:{}},{...details,method:'GET'},{...details,headers:{...details.headers,'Content-Length':1}},{...details,headers:{...details.headers,Authorization:'x\r\nHost: evil'}},{...details,headers:{...details.headers,Host:'evil.invalid'}},{...details,headers:{...details.headers,authorization:'duplicate'}},{...details,body:Buffer.alloc(2049)}])await assert.rejects(prepare(changed,resolver))
 })
 await check('actual Node Agent pins one prechecked IP, preserves SNI/headers/body, never re-resolves',async()=>{
  reset('accepted');let resolutions=0
  const once=await prepare(details,async()=>{resolutions++;return [{address:resolutions===1?'127.0.0.1':'127.0.0.2',family:4}]})
  assert.equal((await once()).status,201)
  assert.equal(resolutions,1);assert.equal(observed.selected,1);assert.equal(observed.decoy,0);assert.equal(observed.wire,true);assert.equal(observed.sni,true)
  await assert.rejects(once(),/ATTEMPT_ALREADY_CONSUMED/);assert.equal(observed.selected,1)
 })
 await check('prepared DNS/body/header snapshots resist mutation across authorization wait',async()=>{
  reset('accepted');const original=Buffer.from(details.body),mutable={...details,headers:{...details.headers},body:Buffer.from(original)}
  const rows=[{address:'127.0.0.1',family:4}]
  const once=await prepare(mutable,async()=>rows)
  mutable.endpoint='https://evil.invalid/';mutable.body.fill(0);mutable.headers.Authorization='changed';rows[0].address='127.0.0.2'
  assert.equal((await once()).status,201);assert.equal(observed.selected,1);assert.equal(observed.decoy,0);assert.equal(observed.wire,true)
 })
 await check('reference web-push.sendNotification uses same generated request bytes and headers',async()=>{
  reset('accepted');let pins=0
  const agent=new Agent({ca,keepAlive:false,lookup:(_h,o,cb)=>{pins++;if(o?.all)cb(null,[{address:'127.0.0.1',family:4}]);else cb(null,'127.0.0.1',4)}})
  const library=new WebPushLib();library.generateRequestDetails=()=>({...details,agent})
  // Reference endpoint may contain the local port; explicit Host retains the generated wire value.
  library.generateRequestDetails=()=>({...details,endpoint:`https://push.fixture.invalid:${port}/wp/synthetic`,headers:{...details.headers,Host:'push.fixture.invalid'},agent})
  try{assert.equal((await library.sendNotification(subscription)).statusCode,201);assert.equal(pins,1);assert.equal(observed.wire,true);assert.equal(observed.selected,1)}finally{agent.destroy()}
  assert.equal((await attempt('accepted')).result.status,201);assert.equal(observed.wire,true)
 })
 await check('trusted CA with wrong certificate name fails before HTTP',async()=>{
  reset('accepted');const once=await prepare(details,async()=>[{address:'127.0.0.3',family:4}])
  await assert.rejects(once(),error=>error.diagnosticCode==='tls_failed');assert.equal(observed.wrongCert,0)
 })
 await check('forced connection to another valid-cert IP is refused before HTTP headers/body',async()=>{
  reset('accepted');const once=await prepare(details,resolver)
  const original=Agent.prototype.createConnection
  // Adversarial fixture: emulate a platform replacing the DNS hook, still with a valid TLS name.
  Agent.prototype.createConnection=function(options,cb){return original.call(this,{...options,lookup:(_h,o,callback)=>o?.all?callback(null,[{address:'127.0.0.2',family:4}]):callback(null,'127.0.0.2',4)},cb)}
  try{await assert.rejects(once(),error=>error.diagnosticCode==='tls_failed')}finally{Agent.prototype.createConnection=original}
  assert.equal(observed.selected,0);assert.equal(observed.decoy,0);assert.equal(observed.decoyConnections,1)
 })
 await check('redirect to another address creates zero target connections and no second request',async()=>{
  assert.equal((await attempt('redirect')).result.status,307);assert.equal(observed.selected,1);assert.equal(observed.redirectConnections,0)
 })
 await check('bounded provider diagnostics retain known status and expose fixed fields only',async()=>{
  for(const [scenario,bodyStatus] of [['large','too_large'],['chunked-large','too_large'],['encoded','unsupported_encoding'],['body-hang','timeout'],['incomplete','incomplete'],['private','unknown_format'],['rejected','recognized']]){
   const value=await attempt(scenario)
   assert.equal(value.result.status,400);assert.equal(value.result.providerBodyStatus,bodyStatus);assert.equal(observed.selected,1)
   assert.equal(JSON.stringify(value).includes(privateSentinel),false)
   if(scenario==='rejected')assert.equal(value.result.providerReason,'fcm_invalid_argument')
  }
  const throttle=await attempt('throttled');assert.equal(throttle.result.status,429);assert.equal(throttle.result.retryAfter,'120')
  const date=await attempt('throttled-date');assert.equal(date.result.status,429);assert.match(date.result.retryAfter,/^\d+$/);assert.ok(Number(date.result.retryAfter)>=3590)
  const invalid=await attempt('throttled-invalid');assert.equal(invalid.result.retryAfter,'INVALID_RETRY_AFTER');assert.equal(JSON.stringify(invalid).includes(privateSentinel),false)
 })
 await check('oversized response headers and missing headers terminate without retry',async()=>{
  assert.equal((await attempt('headers-large')).error,'response_limit');assert.equal(observed.selected,1)
  assert.equal((await attempt('many-interim')).error,'response_limit');assert.equal(observed.selected,1)
  const value=await attempt('hang');assert.equal(value.error,'timeout');assert.ok(value.elapsed<1500);assert.equal(observed.selected,1)
 })
 await check('a prepared capability permits one concurrent caller only',async()=>{
  reset('accepted');const once=await prepare(details,resolver)
  const results=await Promise.allSettled([once(),once(),once()])
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(observed.selected,1)
 })


 await check('provider disconnect never creates a second connection',async()=>{
  assert.equal((await attempt('disconnect')).error,'transport_failed');assert.equal(observed.selected,1)
 })
 await check('caller cancellation closes TLS and leaves the attempt consumed',async()=>{
  reset('hang');const controller=new AbortController()
  const once=await prepare(details,resolver,controller.signal)
  const sending=once();setTimeout(()=>controller.abort(),80)
  await assert.rejects(sending,e=>e.diagnosticCode==='transport_failed')
  await assert.rejects(once(),/ATTEMPT_ALREADY_CONSUMED/);assert.equal(observed.selected,1)
  const aborted=AbortSignal.abort();await assert.rejects(prepare(details,resolver,aborted));assert.equal(observed.selected,1)
 })
 await check('complete Node operator with fake RPCs produces one real local TLS request under concurrency and HTTP 400',async()=>{
  const id='b0000000-0000-0000-0000-000000000001'
  const env={VERCEL:'1',VERCEL_ENV:'production',PUSH_NODE_OPERATOR_ENABLED:'true',SUPABASE_URL:`https://${'a'.repeat(20)}.supabase.co`,SUPABASE_SERVICE_ROLE_KEY:'synthetic_service_key_do_not_use',PUSH_TEST_OPERATOR_TOKEN:'A'.repeat(43),PUSH_VAPID_PUBLIC_KEY:vapid.publicKey,PUSH_NODE_VAPID_PRIVATE_KEY:vapid.privateKey,PUSH_VAPID_SUBJECT:options.vapidDetails.subject}
  for(const scenario of ['accepted','rejected','disconnect']){
   reset(scenario);let armed=false,claimed=false,burned=false,dns=0
   const calls=[],claim={claimId:id,endpoint:'https://fcm.googleapis.com/wp/SYNTHETIC',publicKey:vapid.publicKey,...subscription.keys}
   const fetcher=async(url,init)=>{
    const name=new URL(url).pathname.split('/').pop();calls.push(name);let result
    if(name==='user')result={id}
    else if(name==='push_operator_access')result=true
    else if(name==='arm_push_operator'){result=!armed&&!burned;if(result)armed=true}
    else if(name==='claim_push_test'){result=!claimed&&armed?claim:null;if(result)claimed=true}
    else if(name==='authorize_push_test'){result=!burned&&claimed;if(result)burned=true}
    else if(name==='finish_push_test'){assert.equal(burned,true);return new Response(null,{status:204})}
    else if(name==='close_push_operator')result=true
    else throw Error('UNEXPECTED_RPC')
    assert.equal(init.redirect,'error');return Response.json(result)
   }
   const handler=()=>createNodeOperatorHandler({env,fetcher,resolver:async()=>{dns++;return [{address:'8.8.8.8',family:4}]},
    prepareTransport:async(generated,cached,signal)=>{
     assert.equal(burned,true);assert.equal(generated.endpoint,claim.endpoint)
     assert.deepEqual(await cached(),[{address:'8.8.8.8',family:4}])
     // Trusted test-only mapping: generated bytes stay exact; only the fixture TLS destination changes.
     expected={...generated,endpoint:subscription.endpoint}
     return prepare(expected,resolver,signal)
    }})
   const request=()=>new Request('https://weather.fixture.invalid/api/push-operator',{method:'POST',headers:{authorization:`Bearer ${env.PUSH_TEST_OPERATOR_TOKEN}.synthetic.jwt.signature`},body:JSON.stringify({operation:'send',permitId:id,confirmation:`SEND ONE ${id} ${id}`})})
   const responses=await Promise.all([handler()(request()),handler()(request())])
   assert.deepEqual(responses.map(r=>r.status).sort(),scenario==='accepted'?[200,409]:scenario==='rejected'?[409,502]:[409,503])
   assert.equal(observed.selected,1);assert.equal(observed.wire,true);assert.equal(observed.sni,true);assert.equal(dns,1)
   assert.ok(calls.includes('close_push_operator'))
   assert.equal((await handler()(request())).status,409);assert.equal(observed.selected,1)
  }
  expected=details
 })
}finally{
 for(const server of servers){server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
 await rm(temp,{recursive:true,force:true})
}
})
