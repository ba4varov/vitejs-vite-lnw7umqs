// Local, network-isolated runtime harness ONLY. Never deploy this test service.
// In-memory fixture permissions + mocked RPC/provider; no real subscription or DB.
import webpush from 'web-push'
import {Buffer} from 'node:buffer'
import {readFileSync} from 'node:fs'
import {createTestHandler,validVapid,sendPinned} from '../../supabase/functions/_shared/push-test.mjs'
import {denoConnector} from '../../supabase/functions/_shared/push-deno.ts'
Deno.serve(async()=>{
 const key=webpush.generateVAPIDKeys(),receiver=webpush.generateVAPIDKeys(),permitId='b0000000-0000-0000-0000-000000000001'
 const env={PUSH_TEST_DELIVERY_ENABLED:'true',PUSH_TEST_OPERATOR_TOKEN:'A'.repeat(43),PUSH_VAPID_PUBLIC_KEY:key.publicKey,PUSH_VAPID_PRIVATE_KEY:key.privateKey,PUSH_VAPID_SUBJECT:'mailto:test@example.invalid'}
 let claimed=false,sent=0,encrypted=false,prepared
 const handler=createTestHandler({env,resolver:async()=>[{address:'8.8.8.8',family:4}],
  rpc:async(name)=>{if(name!=='claim_push_test')return true;if(claimed)return null;claimed=true;return {claimId:permitId,endpoint:'https://fcm.googleapis.com/wp/isolated',publicKey:key.publicKey,p256dh:receiver.publicKey,auth:Buffer.alloc(16,1).toString('base64url'),language:'bg'}},
  send:async(details)=>{prepared=details;sent++;encrypted=details.body.length>0 && details.headers['Content-Encoding']==='aes128gcm' && details.headers.Authorization.startsWith('vapid ');return {status:201}},
 })
 const req=()=>new Request('https://local.example.invalid/test',{method:'POST',headers:{Authorization:'Bearer '+env.PUSH_TEST_OPERATOR_TOKEN},body:JSON.stringify({permitId})})
 const accepted=(await handler(req())).status,duplicate=(await handler(req())).status
 const cryptoReady=validVapid(key.publicKey,key.privateKey,env.PUSH_VAPID_SUBJECT)
 let tlsReady=false,redirectRefused=false,wrongNameRejected=false,mode=201,tlsError='NONE'
 const cert=readFileSync('/fixtures/ca.pem').toString('utf8')
 const connector=denoConnector({
  ...Deno,
  connect:options=>{if(options.hostname!=='8.8.8.8')throw Error('UNPINNED');return Deno.connect({...options,hostname:'127.0.0.1',port:9443})},
  startTls:(tcp,options)=>Deno.startTls(tcp,{...options,caCerts:[cert]}),
 })
 try {
  tlsReady=(await sendPinned({...prepared,headers:{...prepared.headers,'X-Test-Status':String(mode)}},async()=>[{address:'8.8.8.8',family:4}],connector)).status===201
  mode=302
  redirectRefused=(await sendPinned({...prepared,headers:{...prepared.headers,'X-Test-Status':String(mode)}},async()=>[{address:'8.8.8.8',family:4}],connector)).status===302
  const wrongConnector=denoConnector({
   ...Deno,
   connect:options=>Deno.connect({...options,hostname:'127.0.0.1',port:9443}),
   startTls:(tcp,options)=>Deno.startTls(tcp,{...options,hostname:'wrong.example.invalid',caCerts:[cert]}),
  })
  try{await sendPinned(prepared,async()=>[{address:'8.8.8.8',family:4}],wrongConnector)}catch{wrongNameRejected=true}
 }catch{tlsError='TRANSPORT_FAILED'}
 return Response.json({cryptoReady,accepted,duplicate,sent,encrypted,tlsReady,redirectRefused,wrongNameRejected,tlsError},{status:cryptoReady && accepted===200 && duplicate===409 && sent===1 && encrypted && tlsReady && redirectRefused && wrongNameRejected?200:500})
})
