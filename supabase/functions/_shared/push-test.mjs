import webpush from 'web-push'
import ipaddr from 'ipaddr.js'
import {createECDH, timingSafeEqual} from 'node:crypto'
import {lookup} from 'node:dns/promises'
import {connect as tlsConnect} from 'node:tls'
import {Buffer} from 'node:buffer'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const invalidHeaderText=value=>['\r','\n','\0'].some(char=>String(value).includes(char))
export function validEndpoint(endpoint) {
 if(typeof endpoint !== 'string' || endpoint.length > 2048)return false
 try {
  const u=new URL(endpoint)
  if(u.protocol!=='https:' || u.username || u.password || u.port || u.hash || u.href!==endpoint)return false
  return (u.hostname==='fcm.googleapis.com' && /^\/(fcm\/send|wp)\/[A-Za-z0-9_:-]+$/.test(u.pathname) && !u.search)
   || (u.hostname==='web.push.apple.com' && /^\/[A-Za-z0-9_-]+$/.test(u.pathname) && !u.search)
   || (/^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname) && u.pathname==='/w/' && /^\?token=[A-Za-z0-9_%.-]+$/.test(u.search))
   || (u.hostname==='updates.push.services.mozilla.com' && /^\/wpush\/v2\/[A-Za-z0-9_-]+$/.test(u.pathname) && !u.search)
 }catch{return false}
}
export function validVapid(publicKey, privateKey, subject) {
 try {
  if(!/^[A-Za-z0-9_-]{87}$/.test(publicKey || '') || !/^[A-Za-z0-9_-]{43}$/.test(privateKey || ''))return false
  const publicBytes=Buffer.from(publicKey,'base64url'), privateBytes=Buffer.from(privateKey,'base64url')
  if(publicBytes.toString('base64url')!==publicKey || privateBytes.toString('base64url')!==privateKey)return false
  const curve=createECDH('prime256v1');curve.setPrivateKey(privateBytes)
  if(!timingSafeEqual(curve.getPublicKey(),publicBytes))return false
  const contact=new URL(subject)
  if(!['mailto:','https:'].includes(contact.protocol) || contact.username || contact.password || contact.hash || subject.length>250)return false
  if(contact.protocol==='mailto:' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.pathname))return false
  webpush.getVapidHeaders('https://fcm.googleapis.com',subject,publicKey,privateKey,'aes128gcm')
  return true
 }catch{return false}
}
export function publicAddress(address) {
 try {
  const parsed=ipaddr.parse(address)
  return parsed.range()==='unicast' && (parsed.kind()==='ipv4' || parsed.match(ipaddr.parse('2000::'),3))
 }catch{return false}
}
export async function pinnedLookup(hostname, resolver=lookup) {
 let timer
 const addresses=await Promise.race([
  resolver(hostname,{all:true,verbatim:true}),
  new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('DNS_TIMEOUT')),3000)}),
 ]).finally(()=>clearTimeout(timer))
 if(!addresses.length || addresses.length>32 || addresses.some(a=>!publicAddress(a.address) || ![4,6].includes(a.family)))throw Error('UNSAFE_DNS')
 // No second DNS lookup: connect only to a validated address while preserving TLS hostname/SNI.
 return (_host,options,callback)=>{
  const family=typeof options==='number'?options:options?.family
  const eligible=addresses.filter(a=>!family || a.family===family)
  if(!eligible.length)return callback(Error('NO_ADDRESS'))
  if(options?.all)return callback(null,eligible)
  callback(null,eligible[0].address,eligible[0].family)
 }
}
export function retryDelay(value, now=Date.now()) {
 if(typeof value!=='string')return 900
 const seconds=/^\d+$/.test(value)?Number(value):Math.ceil((Date.parse(value)-now)/1000)
 // Unrepresentable/very long throttles disable the DB test gate; never shorten provider advice.
 return !Number.isFinite(seconds) || seconds>31536000 ? null : Math.max(60,seconds)
}
export function validateDevice(device, config, eventId) {
 if(!validEndpoint(device.endpoint) || device.publicKey!==config.publicKey || !uuid.test(eventId))throw Error('INVALID_SUBSCRIPTION')
 const p=device.p256dh,a=device.auth
 if(!/^[A-Za-z0-9_-]{87}$/.test(p || '') || !/^[A-Za-z0-9_-]{22}$/.test(a || '') || Buffer.from(a,'base64url').toString('base64url')!==a)throw Error('INVALID_SUBSCRIPTION')
 // Use the same supported ECDH primitive as web-push, including in Supabase Edge Runtime.
 if(Buffer.from(p,'base64url').toString('base64url')!==p || Buffer.from(p,'base64url')[0]!==4)throw Error('INVALID_SUBSCRIPTION')
 const validator=createECDH('prime256v1');validator.generateKeys()
 validator.computeSecret(Buffer.from(p,'base64url')) // Reject off-curve points; discard the ephemeral result.
}
export function preparePush(device, config, eventId) {
 validateDevice(device,config,eventId)
 const p=device.p256dh,a=device.auth
 return webpush.generateRequestDetails({endpoint:device.endpoint,keys:{p256dh:p,auth:a}},JSON.stringify({
  title:device.language==='en'?'Meteo Pulse — test':'Метео Пулс — тест',
  body:device.language==='en'?'This is your explicitly approved test notification.':'Това е изрично разрешеното тестово известие за твоето устройство.',
  eventId,
 }),{TTL:60,urgency:'very-low',contentEncoding:'aes128gcm',vapidDetails:{subject:config.subject,publicKey:config.publicKey,privateKey:config.privateKey}})
}
export async function connectNode(target,signal) {
 const socket=tlsConnect({host:target.address,port:target.port || 443,servername:target.hostname,rejectUnauthorized:true,ALPNProtocols:['http/1.1'],...(target.testCa?{ca:target.testCa}:{})})
 const close=()=>socket.destroy()
 signal.addEventListener('abort',close,{once:true})
 await new Promise((resolve,reject)=>{socket.once('secureConnect',resolve);socket.once('error',()=>reject(Error('TLS_FAILED')))})
 const iterator=socket[Symbol.asyncIterator]()
 return {
  write:bytes=>new Promise((resolve,reject)=>socket.write(bytes,error=>error?reject(Error('WRITE_FAILED')):resolve(bytes.length))),
  read:async buffer=>{const {value,done}=await iterator.next();if(done)return null;if(value.length>buffer.length)throw Error('RESPONSE_LIMIT');buffer.set(value);return value.length},
  close:()=>{signal.removeEventListener('abort',close);close()},
 }
}
export async function sendPinned(details, resolver=lookup, connector=connectNode) {
 if(!validEndpoint(details.endpoint))throw Error('INVALID_ENDPOINT')
 const endpoint=new URL(details.endpoint),host=endpoint.hostname
 const dns=await pinnedLookup(host,resolver)
 const target=await new Promise((resolve,reject)=>dns(host,{},(error,address,family)=>error?reject(error):resolve({address,family})))
 const controller=new AbortController();let timer,connection
 const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error('PROVIDER_UNCERTAIN'))},8000)})
 const deliver=async()=>{
  connection=await connector({...target,hostname:host},controller.signal)
  if(controller.signal.aborted)throw Error('TIMEOUT')
  const fields=Object.entries(details.headers).filter(([name])=>!['host','connection','content-length'].includes(name.toLowerCase()))
  fields.push(['Host',host],['Connection','close'],['Content-Length',String(details.body.length)])
  if(fields.some(([name,value])=>!/^[A-Za-z0-9-]{1,64}$/.test(name) || invalidHeaderText(value) || String(value).length>2048))throw Error('INVALID_HEADERS')
  const head=`POST ${endpoint.pathname}${endpoint.search} HTTP/1.1\r\n`+fields.map(([name,value])=>`${name}: ${value}\r\n`).join('')+'\r\n'
  if(Buffer.byteLength(head)>4096 || details.body.length>2048)throw Error('REQUEST_LIMIT')
  const bytes=Buffer.concat([Buffer.from(head),details.body]);let written=0
  while(written<bytes.length){const n=await connection.write(bytes.subarray(written));if(!Number.isInteger(n)||n<1||n>bytes.length-written)throw Error('WRITE_FAILED');written+=n}
  const response=new Uint8Array(4096);let used=0
  while(used<response.length){
   const n=await connection.read(response.subarray(used));if(!Number.isInteger(n)||n<1||n>response.length-used)throw Error('RESPONSE_FAILED');used+=n
   const end=Buffer.from(response.subarray(0,used)).indexOf('\r\n\r\n')
   if(end<0)continue
   const lines=Buffer.from(response.subarray(0,end)).toString('latin1').split('\r\n')
   const match=/^HTTP\/1\.[01] ([2-5][0-9]{2})(?: [^\r\n]*)?$/.exec(lines.shift())
   if(!match)throw Error('INVALID_RESPONSE')
   let retryAfter
   for(const line of lines){
    const colon=line.indexOf(':');if(colon<1 || invalidHeaderText(line))throw Error('INVALID_RESPONSE')
    if(line.slice(0,colon).toLowerCase()==='retry-after'){retryAfter=retryAfter===undefined?line.slice(colon+1).trim():'INVALID_RETRY_AFTER'}
   }
   return {status:Number(match[1]),retryAfter}
  }
  throw Error('RESPONSE_LIMIT')
 }
 try {return await Promise.race([deliver(),timeout])}catch{throw Error('PROVIDER_UNCERTAIN')}
 finally{clearTimeout(timer);controller.abort();connection?.close()}
}
const reply=(status,error)=>new Response(JSON.stringify({error,deliveryEnabled:false}),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}})
export function createTestHandler({env,rpc,send=sendPinned,prepare=preparePush,resolver=lookup}) {
 return async req=>{
  if(env.PUSH_TEST_DELIVERY_ENABLED!=='true')return reply(503,'PUSH_TEST_DISABLED')
  if(req.method!=='POST')return reply(405,'METHOD_NOT_ALLOWED')
  const token=env.PUSH_TEST_OPERATOR_TOKEN || '', supplied=req.headers.get('authorization') || ''
  if(!/^[A-Za-z0-9_-]{43,128}$/.test(token))return reply(503,'PUSH_TEST_UNCONFIGURED')
  const wanted=Buffer.from('Bearer '+token), got=Buffer.from(supplied)
  if(got.length!==wanted.length || !timingSafeEqual(got,wanted))return reply(401,'UNAUTHORIZED')
  if(req.headers.has('origin') || new URL(req.url).search)return reply(400,'INVALID_REQUEST')
  let body
  try {
   const reader=req.body?.getReader();if(!reader)return reply(400,'INVALID_REQUEST')
   let size=0,chunks=[]
   const deadline=AbortSignal.timeout(2000)
   while(true){
    const item=await Promise.race([reader.read(),new Promise((_,reject)=>deadline.addEventListener('abort',()=>reject(Error('BODY_TIMEOUT')),{once:true}))])
    if(item.done)break
    size+=item.value.length;if(size>512){await reader.cancel();return reply(413,'BODY_TOO_LARGE')}
    chunks.push(Buffer.from(item.value))
   }
   body=JSON.parse(Buffer.concat(chunks).toString('utf8'))
   if(!body || Array.isArray(body) || Object.keys(body).length!==1 || typeof body.permitId!=='string' || !uuid.test(body.permitId))return reply(400,'INVALID_REQUEST')
  }catch{return reply(400,'INVALID_REQUEST')}
  const config={publicKey:env.PUSH_VAPID_PUBLIC_KEY,privateKey:env.PUSH_VAPID_PRIVATE_KEY,subject:env.PUSH_VAPID_SUBJECT}
  if(!validVapid(config.publicKey,config.privateKey,config.subject))return reply(503,'PUSH_TEST_UNCONFIGURED')
  let claim
  try {
   claim=await rpc('claim_push_test',{permit_id:body.permitId,key_public:config.publicKey})
   if(!claim)return reply(409,'PUSH_TEST_NOT_ALLOWED')
   try {validateDevice(claim,config,body.permitId)}catch{
    await rpc('finish_push_test',{permit_id:body.permitId,claim_id:claim.claimId,outcome:'invalid',retry_seconds:0})
    return reply(409,'INVALID_SUBSCRIPTION')
   }
   const details=prepare(claim,config,body.permitId)
   // DNS resolution occurs before final DB authorization, to minimize the consent race window.
   const dns=await pinnedLookup(new URL(details.endpoint).hostname,resolver)
   const authorized=await rpc('authorize_push_test',{permit_id:body.permitId,claim_id:claim.claimId,key_public:config.publicKey})
   if(!authorized)return reply(409,'PUSH_TEST_NOT_ALLOWED')
   const result=await send(details,async()=>new Promise((resolve,reject)=>dns('',{all:true},(e,a)=>e?reject(e):resolve(a))))
   const outcome=result.status>=200 && result.status<300?'sent':[404,410].includes(result.status)?'expired':result.status===429?'throttled':'failed'
   await rpc('finish_push_test',{permit_id:body.permitId,claim_id:claim.claimId,outcome,retry_seconds:outcome==='throttled'?retryDelay(result.retryAfter):0})
   return reply(outcome==='sent'?200:502,outcome==='sent'?'PUSH_TEST_ACCEPTED':'PUSH_TEST_NOT_CONFIRMED')
  }catch{
   // Reservations are never replayed. Unknown provider/DB outcomes stay uncertain.
   return reply(503,'PUSH_TEST_UNCERTAIN')
  }
 }
}
