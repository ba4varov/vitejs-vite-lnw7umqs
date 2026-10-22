import test from 'node:test'
import assert from 'node:assert/strict'
import {webcrypto,createECDH,createHash} from 'node:crypto'
import {checkPushKeys,pushKeyMessages} from '../../src/push-key-diagnostics.js'
import {requestPushKeyCheck} from '../../src/push-key-request.js'
import {handlePushKeyDiagnostics} from '../../server/push-key-diagnostics.js'
const id='a0000000-0000-0000-0000-000000000001',other='a0000000-0000-0000-0000-000000000002'
const curve=createECDH('prime256v1');curve.generateKeys()
const p=curve.getPublicKey(),a=Buffer.alloc(16,7),endpoint='https://fcm.googleapis.com/wp/synthetic-only'
const fingerprint=createHash('sha256').update(endpoint).digest('hex'),key=p.toString('base64url')
const unavailable={p256dh:'unavailable',auth:'unavailable'}
function fixture(){
 const forbidden=()=>{throw Error('Unexpected mutation or raw serialization')}
 const calls=[],sub={endpoint,options:{applicationServerKey:p},getKey:name=>Uint8Array.from(name==='p256dh'?p:a).buffer,toJSON:forbidden,unsubscribe:forbidden}
 const registration={scope:'https://meteo.invalid/',active:{scriptURL:'https://meteo.invalid/push-sw.js'},pushManager:{getSubscription:async()=>sub,subscribe:forbidden}}
 const scope={isSecureContext:true,location:{origin:'https://meteo.invalid'},crypto:webcrypto,navigator:{serviceWorker:{getRegistration:async()=>registration,register:forbidden}},Notification:{requestPermission:forbidden},fetch:forbidden,localStorage:{setItem:forbidden}}
 const verify=async body=>{calls.push(body);const context=`meteo-pulse:push-key:v1\n${id}\n${fingerprint}\n${body.nonce}\n`;return Object.fromEntries(['p256dh','auth'].map(name=>[name,['missing','unavailable'].includes(body[name])?body[name]:createHash('sha256').update(context+name+'\n').update(name==='p256dh'?p:a).digest('hex')===body[name]?'match':'mismatch']))}
 return {scope,sub,registration,calls,verify,device:{id,fingerprint},key,authorize:async()=>true}
}
test('matching decoded keys send fresh nonce-bound proofs only, never raw subscription material',async()=>{
 const f=fixture();assert.deepEqual(await checkPushKeys(f),{p256dh:'match',auth:'match'});assert.deepEqual(await checkPushKeys(f),{p256dh:'match',auth:'match'})
 assert.notEqual(f.calls[0].nonce,f.calls[1].nonce);assert.notEqual(f.calls[0].auth,f.calls[1].auth)
 const wire=JSON.stringify(f.calls);for(const raw of [endpoint,key,a.toString('base64url')])assert.ok(!wire.includes(raw))
 assert.deepEqual(Object.keys(f.calls[0]).sort(),['auth','deviceId','fingerprint','nonce','p256dh'])
})
test('valid but different p256dh/auth yield independent mismatch statuses',async()=>{
 for(const name of ['p256dh','auth']){const f=fixture(),original=f.sub.getKey;f.sub.getKey=k=>{const b=new Uint8Array(original(k));if(k===name){if(k==='p256dh'){const c=createECDH('prime256v1');return Uint8Array.from(c.generateKeys()).buffer}b[b.length-1]^=1}return b.buffer};assert.deepEqual(await checkPushKeys(f),{p256dh:name==='p256dh'?'mismatch':'match',auth:name==='auth'?'mismatch':'match'})}
})
test('missing and unreadable browser keys remain distinct',async()=>{
 const f=fixture();f.sub.getKey=name=>{if(name==='p256dh')return null;throw Error(a.toString('base64url'))};assert.deepEqual(await checkPushKeys(f),{p256dh:'missing',auth:'unavailable'})
})
test('wrong fingerprint/VAPID or missing session never reads keys or calls diagnostic API',async()=>{
 for(const kind of ['fingerprint','vapid','session']){const f=fixture();if(kind==='fingerprint')f.device.fingerprint='0'.repeat(64);if(kind==='vapid')f.key=Buffer.concat([Buffer.from([4]),Buffer.alloc(64)]).toString('base64url');if(kind==='session')f.authorize=async()=>false;f.sub.getKey=()=>{throw Error('must not read')};assert.deepEqual(await checkPushKeys(f),unavailable);assert.equal(f.calls.length,0)}
})
test('subscription changes between checks cannot bypass fingerprint gate',async()=>{
 const f=fixture();let n=0;f.registration.pushManager.getSubscription=async()=>++n===1?f.sub:{...f.sub,endpoint:endpoint+'-other'};assert.deepEqual(await checkPushKeys(f),unavailable);assert.equal(f.calls.length,0)
})
test('changed session while diagnostic is pending discards its response',async()=>{
 const f=fixture();let active=true;f.authorize=async()=>active;f.verify=async()=>{active=false;return {p256dh:'match',auth:'match'}};assert.deepEqual(await checkPushKeys(f),unavailable)
})
const session={user:{id},access_token:'synthetic-token'}
test('request rejects wrong/missing sessions before fetch and rechecks after fetch',async()=>{
 for(const current of [null,{user:{id:other}}])await assert.rejects(requestPushKeyCheck(session,{}, {getSession:async()=>current,fetcher:()=>{throw Error('must not fetch')}}),/SESSION_CHANGED/)
 let n=0;await assert.rejects(requestPushKeyCheck(session,{}, {getSession:async()=>++n===1?session:{user:{id:other}},fetcher:async()=>Response.json({keys:{p256dh:'match',auth:'match'}})}),/SESSION_CHANGED/)
 const result=await requestPushKeyCheck(session,{}, {getSession:async()=>session,fetcher:async(url,o)=>{assert.equal(url,'/api/push-key-diagnostics');assert.equal(o.cache,'no-store');assert.equal(o.headers.Authorization,'Bearer synthetic-token');return Response.json({keys:{p256dh:'match',auth:'missing'}})}})
 assert.deepEqual(result,{p256dh:'match',auth:'missing'})
})
const proofBody={deviceId:id,fingerprint,nonce:'1'.repeat(64),p256dh:'2'.repeat(64),auth:'3'.repeat(64)}
async function api({body=proofBody,authStatus=200,rpc={p256dh:'match',auth:'mismatch'},rpcStatus=200,method='POST',authorization='Bearer synthetic-token'}={}){
 const calls=[],res={headers:{},setHeader(k,v){this.headers[k]=v},status(n){this.code=n;return this},json(v){this.data=v;return this}}
 await handlePushKeyDiagnostics({method,body,headers:{authorization},query:{}},res,{SUPABASE_URL:'https://db.invalid',SUPABASE_ANON_KEY:'anon'},async(url,o)=>{calls.push({url,o});return url.endsWith('/auth/v1/user')?Response.json(authStatus===200?{id}:{},{status:authStatus}):Response.json(rpc,{status:rpcStatus})})
 return {res,calls}
}
test('API authenticates before RPC and passes only proofs using user JWT',async()=>{
 const {res,calls}=await api();assert.equal(res.code,200);assert.deepEqual(res.data,{keys:{p256dh:'match',auth:'mismatch'},diagnostic:'rpc:complete'});assert.equal(calls.length,2);assert.equal(calls[1].o.headers.Authorization,'Bearer synthetic-token');assert.match(calls[1].url,/\/rpc\/check_my_push_keys$/);assert.equal(res.headers['Cache-Control'],'private, no-store');assert.equal(res.headers.Vary,'Authorization')
})
test('invalid/expired/missing session never reaches SQL RPC',async()=>{
 for(const authorization of [null,'Bearer expired']){const {res,calls}=await api({authorization,authStatus:401});assert.equal(res.code,401);assert.ok(calls.length<=1)}
})
test('foreign or stale device result stays unavailable without exposing identifiers',async()=>{
 const {res}=await api({rpc:unavailable});assert.deepEqual(res.data,{keys:unavailable,diagnostic:'rpc:result-unavailable'});assert.ok(!JSON.stringify(res.data).includes(id))
})
test('raw keys, extra fields and malformed proofs are rejected before RPC',async()=>{
 for(const body of [{...proofBody,auth:a.toString('base64url')},{...proofBody,p256dh:key},{...proofBody,endpoint},{...proofBody,nonce:'short'}]){const {res,calls}=await api({body});assert.equal(res.code,400);assert.equal(calls.length,1)}
})
test('unknown RPC fields, migration absence and private error text never leak',async()=>{
 for(const options of [{rpc:{p256dh:'match',auth:'match',secret:key}},{rpc:{message:a.toString('base64url')},rpcStatus:404}]){const {res}=await api(options);assert.equal(res.code,503);assert.deepEqual(res.data,{keys:unavailable,diagnostic:options.rpcStatus===404?'rpc:not-found':'rpc:response'})}
 for(const lang of ['bg','en'])for(const status of ['match','mismatch','missing','unavailable'])assert.equal(typeof pushKeyMessages[lang][status],'string')
})
test('RPC HTTP and allowlisted SQL failures stay distinct without private error text',async()=>{
 for(const [status,code,expected] of [[401,'x','rpc:unauthorized'],[403,'x','rpc:forbidden'],[404,'x','rpc:not-found'],[500,'x','rpc:rejected'],[404,'PGRST202','rpc:schema-cache'],[403,'42501','rpc:sql-permission'],[400,'42702','rpc:sql-ambiguous'],[404,'42883','rpc:sql-function'],[500,'toString','rpc:rejected']]){
  const {res}=await api({rpcStatus:status,rpc:{code,message:endpoint,details:key,hint:id}})
  assert.deepEqual(res.data,{keys:unavailable,diagnostic:expected})
 }
})
test('browser reports fixed stages, preserves result statuses and never echoes exceptions',async()=>{
 for(const [kind,expected] of [['session','session:before'],['identity','browser:identity'],['read','browser:key-read'],['format','browser:key-format'],['transport','request:transport'],['rpc','rpc:sql-permission']]){
  const f=fixture(),stages=[];f.onDiagnostic=s=>stages.push(s)
  if(kind==='session')f.authorize=async()=>false
  if(kind==='identity')f.device.id='invalid'
  if(kind==='read')f.sub.getKey=()=>{throw Error(endpoint)}
  if(kind==='format')f.sub.getKey=()=>new Uint8Array(1).buffer
  if(kind==='transport')f.verify=async()=>{throw Error(endpoint)}
  if(kind==='rpc')f.verify=async()=>{throw Object.assign(Error(key),{diagnostic:'rpc:sql-permission'})}
  await checkPushKeys(f);assert.deepEqual(stages,[expected])
 }
})
test('client preserves safe API errors and blocks arbitrary diagnostics and HTML',async()=>{
 for(const [response,expected] of [[Response.json({diagnostic:'rpc:schema-cache',message:endpoint},{status:503}),'rpc:schema-cache'],[Response.json({diagnostic:endpoint},{status:503}),'request:http'],[new Response('<html>'+endpoint,{status:502}),'request:http'],[Response.json({keys:unavailable,diagnostic:endpoint}),'request:response']]){
  await assert.rejects(requestPushKeyCheck(session,{}, {getSession:async()=>session,fetcher:async()=>response}),e=>e.diagnostic===expected&&!e.message.includes(endpoint))
 }
})
test('client classifies timeout and transport failures without copying messages',async()=>{
 for(const name of ['TimeoutError','AbortError','TypeError'])await assert.rejects(requestPushKeyCheck(session,{}, {getSession:async()=>session,fetcher:async()=>{throw Object.assign(Error(endpoint),{name})}}),e=>e.diagnostic===(name==='TypeError'?'request:transport':'request:timeout'))
})
test('server distinguishes auth/RPC transport, timeout and malformed responses',async()=>{
 for(const stage of ['auth','rpc'])for(const kind of ['transport','timeout','response']){
  const res={setHeader(){},status(n){this.code=n;return this},json(data){this.data=data;return this}}
  await handlePushKeyDiagnostics({method:'POST',body:proofBody,headers:{authorization:'Bearer synthetic'},query:{}},res,{SUPABASE_URL:'https://db.invalid',SUPABASE_ANON_KEY:'anon'},async url=>{
   if((stage==='auth')===url.endsWith('/auth/v1/user')){
    if(kind==='response')return new Response(endpoint,{status:200})
    throw Object.assign(Error(endpoint),{name:kind==='timeout'?'TimeoutError':'TypeError'})
   }
   return Response.json({id})
  })
  assert.deepEqual(res.data,{keys:unavailable,diagnostic:`${stage}:${kind}`})
 }
})
test('end to end RPC failure reaches browser stage and no sensitive fields reach UI result',async()=>{
 const f=fixture(),stages=[];f.onDiagnostic=s=>stages.push(s)
 f.verify=body=>requestPushKeyCheck(session,body,{getSession:async()=>session,fetcher:async()=>{
  const {res}=await api({rpcStatus:403,rpc:{code:'42501',message:endpoint,details:key}})
  return Response.json(res.data,{status:res.code})
 }})
 assert.deepEqual(await checkPushKeys(f),unavailable);assert.deepEqual(stages,['rpc:sql-permission'])
})
test('session provider failures retain the correct boundary',async()=>{
 for(const after of [false,true]){
  let calls=0
  await assert.rejects(requestPushKeyCheck(session,{}, {getSession:async()=>{if(++calls>(after?1:0))throw Error(endpoint);return session},fetcher:async()=>Response.json({keys:unavailable})}),e=>e.diagnostic===(after?'session:after-request':'session:before-request'))
 }
})
test('browser rejects unknown verify response fields instead of silently trusting them',async()=>{
 const f=fixture(),stages=[];f.onDiagnostic=s=>stages.push(s);f.verify=async()=>({p256dh:'match',auth:'match',secret:endpoint})
 assert.deepEqual(await checkPushKeys(f),unavailable);assert.deepEqual(stages,['request:response'])
})
