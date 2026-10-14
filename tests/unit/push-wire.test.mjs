import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer,Agent} from 'node:https'
import {connect} from 'node:tls'
import {createRequire} from 'node:module'
import {createECDH,createDecipheriv,hkdfSync,createPublicKey,verify} from 'node:crypto'
import {execFileSync,execFile} from 'node:child_process'
import {promisify} from 'node:util'
import {mkdtempSync,readFileSync,rmSync,mkdirSync,writeFileSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {fixtureKeys} from './push-fixtures.mjs'
import {preparePush,sendPinned,connectNode,createTestHandler} from '../../supabase/functions/_shared/push-test.mjs'

const WebPushLib=createRequire(import.meta.url)('web-push/src/web-push-lib.js')
const exec=promisify(execFile),keys=fixtureKeys(),receiverKeys=fixtureKeys(2),auth=Buffer.alloc(16,1)
const id='b0000000-0000-0000-0000-000000000001',config={...keys,subject:'mailto:test@example.invalid'}
const device={endpoint:'https://fcm.googleapis.com/wp/isolated',publicKey:keys.publicKey,p256dh:receiverKeys.publicKey,auth:auth.toString('base64url'),language:'bg',claimId:id}
const resolver=async()=>[{address:'8.8.8.8',family:4}]
const privateText='private endpoint subscription token key must never escape'
const htmlRejection='<HTML><HEAD><TITLE>UnauthorizedRegistration</TITLE></HEAD><BODY><H1>UnauthorizedRegistration</H1><H2>Error 400</H2><!--'+privateText+'--></BODY></HTML>'
const rejection=JSON.stringify({error:{code:400,status:'INVALID_ARGUMENT',message:privateText,details:[{fieldViolations:[{description:privateText}]}]}})

function validate(req,body){
 assert.equal(req.method,'POST');assert.ok(['/wp/isolated','/fcm/send/isolated'].includes(req.url));assert.equal(req.headers.host,'fcm.googleapis.com')
 assert.equal(req.socket.servername,'fcm.googleapis.com');assert.equal(req.socket.alpnProtocol,'http/1.1')
 assert.equal(req.headers['content-type'],'application/octet-stream');assert.equal(req.headers['content-encoding'],'aes128gcm')
 assert.equal(req.headers['content-length'],String(body.length));assert.equal(req.headers['transfer-encoding'],undefined)
 assert.equal(req.headers.ttl,'60');assert.equal(req.headers.urgency,'very-low')
 assert.equal(req.headers.encryption,undefined);assert.equal(req.headers['crypto-key'],undefined)
 assert.equal(req.rawHeaders.filter((v,i)=>i%2===0&&v.toLowerCase()==='content-length').length,1)
 const match=/^vapid t=([^,]+), k=(.+)$/.exec(req.headers.authorization)
 assert.ok(match);assert.equal(match[2],keys.publicKey)
 const [head,payload,signature]=match[1].split('.'),claims=JSON.parse(Buffer.from(payload,'base64url'))
 assert.deepEqual(JSON.parse(Buffer.from(head,'base64url')),{typ:'JWT',alg:'ES256'})
 assert.equal(claims.aud,'https://fcm.googleapis.com');assert.equal(claims.sub,config.subject)
 assert.ok(claims.exp>Date.now()/1000&&claims.exp<Date.now()/1000+86400)
 const publicBytes=Buffer.from(keys.publicKey,'base64url')
 const publicKey=createPublicKey({format:'jwk',key:{kty:'EC',crv:'P-256',x:publicBytes.subarray(1,33).toString('base64url'),y:publicBytes.subarray(33).toString('base64url')}})
 assert.ok(verify('sha256',Buffer.from(head+'.'+payload),{key:publicKey,dsaEncoding:'ieee-p1363'},Buffer.from(signature,'base64url')))
 assert.equal(body.readUInt32BE(16),4096);assert.equal(body[20],65)
 const sender=body.subarray(21,86),receiver=createECDH('prime256v1');receiver.setPrivateKey(Buffer.from(receiverKeys.privateKey,'base64url'))
 const ikm=Buffer.from(hkdfSync('sha256',receiver.computeSecret(sender),auth,Buffer.concat([Buffer.from('WebPush: info\0'),receiver.getPublicKey(),sender]),32))
 const cek=Buffer.from(hkdfSync('sha256',ikm,body.subarray(0,16),Buffer.from('Content-Encoding: aes128gcm\0'),16))
 const nonce=Buffer.from(hkdfSync('sha256',ikm,body.subarray(0,16),Buffer.from('Content-Encoding: nonce\0'),12))
 const decrypt=createDecipheriv('aes-128-gcm',cek,nonce);decrypt.setAuthTag(body.subarray(-16))
 const plain=Buffer.concat([decrypt.update(body.subarray(86,-16)),decrypt.final()])
 assert.equal(plain.at(-1),2)
 assert.deepEqual(JSON.parse(plain.subarray(0,-1)),{title:'Метео Пулс — тест',body:'Това е изрично разрешеното тестово известие за твоето устройство.',eventId:id})
}
async function fixture(run){
 mkdirSync('work',{recursive:true});const root=mkdtempSync(join(resolve('work'),'push-wire-'))
 const openssl=args=>execFileSync('openssl',args,{stdio:'ignore'})
 openssl(['req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',join(root,'ca-key.pem'),'-out',join(root,'ca.pem'),'-days','1','-subj','/CN=Isolated Push Test CA','-addext','basicConstraints=critical,CA:TRUE','-addext','keyUsage=critical,keyCertSign,cRLSign'])
 openssl(['req','-new','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-nodes','-keyout',join(root,'key.pem'),'-out',join(root,'cert.csr'),'-subj','/CN=fcm.googleapis.com'])
 writeFileSync(join(root,'extensions.cnf'),'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:fcm.googleapis.com\n')
 openssl(['x509','-req','-in',join(root,'cert.csr'),'-CA',join(root,'ca.pem'),'-CAkey',join(root,'ca-key.pem'),'-CAcreateserial','-out',join(root,'cert.pem'),'-days','1','-extfile',join(root,'extensions.cnf')])
 const cert=readFileSync(join(root,'ca.pem')),requests=[],failures=[]
 const server=createServer({key:readFileSync(join(root,'key.pem')),cert:readFileSync(join(root,'cert.pem')),ALPNProtocols:['http/1.1']},(req,res)=>{
  const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
   const body=Buffer.concat(chunks)
   try{validate(req,body)}catch(error){failures.push(error)}
   requests.push({headers:req.headers,body})
   const mode=req.headers['x-fixture-mode']||'accepted'
   if(mode==='accepted'){res.writeHead(201);res.end();return}
   if(mode==='json'){res.writeHead(400,{'content-type':'application/json','content-length':Buffer.byteLength(rejection)});res.end(rejection);return}
   if(mode==='html'){res.writeHead(400,{'content-type':'text/html; charset=UTF-8'});res.end(htmlRejection);return}
   if(mode==='empty'){res.writeHead(400,{'content-length':0});res.end();return}
   if(mode==='jwt'){res.writeHead(403,{'content-type':'text/plain; charset=utf-8'});res.end('invalid JWT provided\n');return}
   if(mode==='jwt-permission'){res.writeHead(403,{'content-type':'text/plain; charset=utf-8','content-length':40});res.end('permission denied: invalid JWT provided\n');return}
   if(mode==='unknown'){res.writeHead(400,{'content-type':'text/html'});res.end('<p>'+privateText+'</p>');return}
   if(mode==='incomplete'){res.writeHead(400,{'content-type':'text/plain','content-length':100});res.end('short');return}
   if(mode==='timeout'){res.writeHead(400,{'content-type':'text/plain','content-length':100});res.flushHeaders();return}
   if(mode==='chunked'){res.writeHead(400,{'content-type':'application/json'});res.write(rejection.slice(0,29));res.end(rejection.slice(29));return}
  })
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 const connector=(target,signal)=>{
  assert.equal(target.address,'8.8.8.8');assert.equal(target.hostname,'fcm.googleapis.com')
  return connectNode({...target,address:'127.0.0.1',port:server.address().port,testCa:cert},signal)
 }
 try{await run({connector,requests,root,port:server.address().port,cert});assert.deepEqual(failures,[])}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));rmSync(root,{recursive:true,force:true})}
}
test('pinned wire request matches web-push@3.6.7 standard sender byte-for-byte in body and semantically in headers',async()=>fixture(async({connector,requests,port,cert})=>{
 for(const path of ['/wp/isolated','/fcm/send/isolated']){
 const endpoint='https://fcm.googleapis.com'+path
 const details=preparePush({...device,endpoint},config,id),standard=new WebPushLib(),agent=new Agent({keepAlive:false})
 // Replay the identical generated details: encryption uses a fresh salt/ephemeral key otherwise.
 agent.createConnection=options=>connect({...options,host:'127.0.0.1',port,servername:'fcm.googleapis.com',ca:cert,ALPNProtocols:['http/1.1']})
 standard.generateRequestDetails=()=>({...details,agent})
 try{
  assert.equal((await standard.sendNotification({endpoint})).statusCode,201)
  assert.equal((await sendPinned({...details,headers:{...details.headers,'Content-Length':1}},resolver,connector)).status,201)
  assert.deepEqual(requests.at(-2),requests.at(-1))
 }finally{agent.destroy()}
 }
 assert.equal(requests.length,4)
}))
test('one authorized attempt reads safe 400 diagnostics from local content-length/chunked provider, then closes gate',async()=>fixture(async({connector,requests})=>{
 for(const mode of ['json','chunked','html','empty','unknown','incomplete','timeout']){
  const calls=[],logs=[]
  const env={PUSH_TEST_DELIVERY_ENABLED:'true',PUSH_TEST_OPERATOR_TOKEN:'a'.repeat(43),PUSH_VAPID_PUBLIC_KEY:keys.publicKey,PUSH_VAPID_PRIVATE_KEY:keys.privateKey,PUSH_VAPID_SUBJECT:config.subject}
  const handler=createTestHandler({env,resolver,diagnose:d=>logs.push(d),rpc:async(name,args)=>{calls.push([name,args]);return name==='claim_push_test'?device:true},send:(details,dns)=>sendPinned({...details,headers:{...details.headers,'X-Fixture-Mode':mode}},dns,connector)})
  const response=await handler(new Request('https://edge.example.invalid/',{method:'POST',headers:{authorization:'Bearer '+env.PUSH_TEST_OPERATOR_TOKEN},body:JSON.stringify({permitId:id})}))
  assert.equal(response.status,502)
  const body=await response.json()
  const providerReason=['json','chunked'].includes(mode)?'fcm_invalid_argument':mode==='html'?'fcm_unauthorized_registration':undefined
  const providerBodyStatus=providerReason?'recognized':mode==='unknown'?'unknown_format':mode
  assert.deepEqual(body.diagnostic,{category:'request_rejected',providerStatus:400,...(providerReason?{providerReason}:{}),providerBodyStatus})
  assert.deepEqual(calls.map(c=>c[0]),['claim_push_test','authorize_push_test','finish_push_test','close_push_operator'])
  assert.equal(calls[2][1].outcome,'failed')
  const output=JSON.stringify([body,logs]);for(const secret of [privateText,device.endpoint,device.auth,keys.privateKey,id])assert.ok(!output.includes(secret))
 }
 assert.equal(requests.length,7)
}))
test('native Deno TLS writes valid encrypted FCM wire requests and reads bounded rejection diagnostics',{skip:!process.env.DENO_BINARY},async()=>fixture(async({requests,root,port})=>{
 const {stdout}=await exec(process.env.DENO_BINARY,['run','--frozen','--cached-only','--config','supabase/functions/push-test/deno.json','--allow-net=127.0.0.1','--allow-env=ECE_KEYLOG,DEBUG,NODE_DEBUG','--allow-read='+root,'tests/edge-push/wire-client.mjs',join(root,'ca.pem'),String(port)],{env:{...process.env,DENO_DIR:resolve('work/deno-cache'),ECE_KEYLOG:'',DEBUG:'',NODE_DEBUG:''},timeout:15000})
 assert.deepEqual(JSON.parse(stdout),{results:[{status:201},{status:400,providerReason:'fcm_invalid_argument',providerBodyStatus:'recognized'},{status:400,providerReason:'fcm_invalid_argument',providerBodyStatus:'recognized'},{status:400,providerReason:'fcm_unauthorized_registration',providerBodyStatus:'recognized'},{status:400,providerBodyStatus:'empty'},{status:403,providerReason:'fcm_invalid_jwt',providerBodyStatus:'recognized'},{status:403,providerReason:'fcm_invalid_jwt',providerBodyStatus:'recognized'},{status:400,providerBodyStatus:'unknown_format'}],wrongNameRejected:true})
 assert.equal(requests.length,8)
}))
