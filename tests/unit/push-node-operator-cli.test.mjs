import test from 'node:test'
import assert from 'node:assert/strict'
import {failureDiagnostic,options,createNodeClient,runNodeOperator,PRODUCTION_URL,SELECTED_DEVICE} from '../../scripts/push-node-operator.mjs'
const user='b0000000-0000-0000-0000-000000000001',permit='c0000000-0000-0000-0000-000000000002'
const selection=options([user,SELECTED_DEVICE])
const ready={error:'PUSH_TEST_READY',permitId:permit,userId:user,deviceId:SELECTED_DEVICE,category:'wind'}
const accepted={error:'PUSH_TEST_ACCEPTED',diagnostic:{category:'accepted',providerStatus:201}}
const secret='SYNTHETIC_SECRET_NEVER_OUTPUT',token='A'.repeat(43),session='synthetic.jwt.signature'
function fixture({prepare=ready,send=accepted,confirmation='SEND ONE',failure}={}){
 const calls=[],logs=[]
 const node=createNodeClient(token,session,async(url,init)=>{
  assert.equal(url,PRODUCTION_URL);assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.ok(init.signal)
  assert.equal(init.headers.authorization,`Bearer ${token}.${session}`)
  const body=JSON.parse(init.body);calls.push(body)
  if(body.operation===failure)throw Error(secret)
  return Response.json(body.operation==='prepare'?prepare:body.operation==='send'?send:{error:'PUSH_TEST_CLOSED'})
 })
 return {calls,logs,run:()=>runNodeOperator(selection,{node,confirm:async phrase=>{assert.equal(phrase,'SEND ONE');return confirmation},output:s=>logs.push(s)})}
}
test('requires explicit selected device and rejects endpoint/project/argument overrides',()=>{
 for(const args of [[],[user],[user,permit],[user,SELECTED_DEVICE,'bad'],[user,SELECTED_DEVICE,'wind',PRODUCTION_URL]])assert.throws(()=>options(args))
 assert.throws(()=>createNodeClient('bad',session));assert.throws(()=>createNodeClient(token,'bad'))
})
test('prepare → one confirmed send → cancel uses selected account/device and server phrase',async()=>{
 const f=fixture();await f.run();assert.deepEqual(f.calls.map(x=>x.operation),['prepare','send','cancel'])
 assert.equal(f.calls[0].deviceId,SELECTED_DEVICE);assert.equal(f.calls[0].userId,user)
 assert.deepEqual(f.calls[1],{operation:'send',permitId:permit,confirmation:`SEND ONE ${user} ${SELECTED_DEVICE}`})
})
test('only exact SEND ONE confirms; rejected or mismatched prepare never sends',async()=>{
 for(const confirmation of ['','send one','SEND ONE ','SEND ONE\n']){const f=fixture({confirmation});await f.run();assert.deepEqual(f.calls.map(x=>x.operation),['prepare','cancel'])}
 for(const prepare of [{error:'PUSH_NODE_DISABLED'}, {...ready,userId:permit},{...ready,deviceId:permit},{...ready,category:'rain'}]){
  const f=fixture({prepare});await assert.rejects(f.run());assert.equal(f.calls.some(x=>x.operation==='send'),false)
 }
})
test('disabled flag, invalid session, wrong permissions, redirects and HTTP failures stop after one request',async()=>{
 for(const [status,error] of [[503,'PUSH_NODE_DISABLED'],[401,'INVALID_SESSION'],[403,'FORBIDDEN'],[307,secret],[429,secret],[500,secret]]){
  let calls=0
  const node=createNodeClient(token,session,async()=>{calls++;return Response.json({error},{status})})
  await assert.rejects(runNodeOperator(selection,{node,confirm:()=>assert.fail('must not prompt'),output:()=>assert.fail('must not output response')}),/NODE_REQUEST_STOPPED/)
  assert.equal(calls,1)
 }
})
test('lost or unknown send stops without retry and only cancels; untrusted data never printed',async()=>{
 for(const config of [{failure:'send'},{send:{error:secret,endpoint:secret}},{send:{...accepted,diagnostic:{category:secret,providerStatus:201}}}]){
  const f=fixture(config);await assert.rejects(f.run());assert.deepEqual(f.calls.map(x=>x.operation),['prepare','send','cancel'])
  for(const value of [secret,token,session])assert.equal(f.logs.join('').includes(value),false)
 }
 const f=fixture({send:{...accepted,endpoint:secret,diagnostic:{...accepted.diagnostic,raw:secret}}});await f.run();assert.equal(f.logs.join('').includes(secret),false)
})
test('malformed, oversized, empty and redirected responses fail closed',async()=>{
 for(const response of [new Response('not-json'),new Response('x'.repeat(2049)),new Response(null),Response.json([])]){
  await assert.rejects(createNodeClient(token,session,async()=>response)({operation:'prepare'}),/NODE_REQUEST_STOPPED/)
 }
 const response=Response.json(ready);Object.defineProperty(response,'redirected',{value:true})
 await assert.rejects(createNodeClient(token,session,async()=>response)({operation:'prepare'}))
})
test('concurrent clients sharing one atomic synthetic permit never replay a denied send',async()=>{
 let burned=false,sends=0;const counts=[]
 const runs=Array.from({length:16},()=>{
  const calls=[];counts.push(calls)
  const node=createNodeClient(token,session,async(_url,init)=>{
   const body=JSON.parse(init.body);calls.push(body.operation)
   if(body.operation==='prepare')return Response.json(ready)
   if(body.operation==='cancel')return Response.json({error:'PUSH_TEST_CLOSED'})
   if(burned)return Response.json({error:'PUSH_TEST_NOT_ALLOWED'},{status:409})
   burned=true;sends++;return Response.json(accepted)
  })
  return runNodeOperator(selection,{node,confirm:async()=> 'SEND ONE',output:()=>{}})
 })
 const results=await Promise.allSettled(runs)
 assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal(sends,1)
 for(const calls of counts)assert.deepEqual(calls,['prepare','send','cancel'])
 // Cross-instance DB authority is tested separately by push-node-operator.test.mjs.
})
test('cleanup failure is not silently treated as success and is never retried',async()=>{
 const f=fixture({failure:'cancel'});await assert.rejects(f.run(),/CANCEL_UNCONFIRMED/)
 assert.deepEqual(f.calls.map(x=>x.operation),['prepare','send','cancel'])
})

const failureText=async fetcher=>{
 let error
 try{await runNodeOperator(selection,{node:createNodeClient(token,session,fetcher),confirm:()=>assert.fail('must not prompt'),output:()=>assert.fail('must not output')})}
 catch(caught){error=caught}
 assert.ok(error)
 return failureDiagnostic(error)
}
test('preflight diagnostics distinguish HTTP statuses and allow only exact server codes',async()=>{
 for(const [status,code] of [[401,'UNAUTHORIZED'],[401,'INVALID_SESSION'],[403,'FORBIDDEN'],[409,'PUSH_TEST_NOT_READY'],[409,'PUSH_TEST_NOT_ALLOWED'],[503,'PUSH_NODE_DISABLED'],[503,'PUSH_NODE_UNCONFIGURED'],[503,'OPERATOR_UNAVAILABLE'],[503,'PUSH_TEST_DISABLED'],[503,'PUSH_TEST_UNCONFIGURED'],[503,'PUSH_TEST_UNCERTAIN']]){
  let calls=0
  const text=await failureText(async()=>{calls++;return Response.json({error:code,endpoint:secret,permitId:permit,token,session,stack:secret},{status})})
  assert.ok(text.includes(`HTTP ${status}:`));assert.ok(text.includes(`Код: ${code}.`));assert.equal(calls,1)
  for(const value of [secret,token,session,permit,PRODUCTION_URL])assert.ok(!text.includes(value))
 }
 for(const error of [secret,'FORBIDDEN\n'+secret,'constructor','__proto__',{code:'FORBIDDEN'},null]){
  const text=await failureText(async()=>Response.json({error,message:secret},{status:403}))
  assert.equal(text,'HTTP 403: отказан достъп.')
 }
})
test('HTTP status survives malformed, empty, oversized or non-object error bodies',async()=>{
 for(const status of [401,403,409,503]){
  for(const body of [secret,'x'.repeat(2049),'','[]','null']){
   const text=await failureText(async()=>new Response(body,{status}))
   assert.ok(text.startsWith(`HTTP ${status}:`));assert.ok(!text.includes('Код:'))
  }
 }
 for(const status of [307,429,500])assert.equal(await failureText(async()=>Response.json({error:secret},{status})),'HTTP отказ: неочакван статус.')
})
test('network errors and invalid responses have distinct safe diagnostics',async()=>{
 for(const error of [Error(secret),new DOMException(secret,'TimeoutError')]){
  let calls=0
  assert.equal(await failureText(async()=>{calls++;throw error}),'Мрежова грешка: заявката не е потвърдена.')
  assert.equal(calls,1)
 }
 for(const response of [new Response(secret),new Response('x'.repeat(2049)),new Response(null),Response.json([]),Response.json(null)]){
  assert.equal(await failureText(async()=>response),'Невалиден отговор от сървъра.')
 }
 const response=Response.json(ready);Object.defineProperty(response,'redirected',{value:true})
 assert.equal(await failureText(async()=>response),'Невалиден отговор от сървъра.')
 const broken=new Response(new ReadableStream({start(controller){controller.error(Error(secret))}}))
 assert.equal(await failureText(async()=>broken),'Невалиден отговор от сървъра.')
})
test('invalid prepare echo is diagnosed without confirmation and still cancels a known permit',async()=>{
 const f=fixture({prepare:{...ready,userId:permit}})
 await assert.rejects(f.run(),error=>failureDiagnostic(error)==='Невалиден отговор при предварителната проверка.')
 assert.deepEqual(f.calls.map(x=>x.operation),['prepare','cancel'])
 for(const error of ['PUSH_NODE_DISABLED',secret]){
  const text=await failureText(async()=>Response.json({error,permit:secret}))
  assert.equal(text,'Невалиден отговор при предварителната проверка.'+(error==='PUSH_NODE_DISABLED'?' Код: PUSH_NODE_DISABLED.':''))
 }
 assert.equal(failureDiagnostic(Error(secret)),'Операцията спря: непотвърден резултат.')
 assert.equal(failureDiagnostic(Error('HTTP 401: '+secret)),'Операцията спря: непотвърден резултат.')
})
