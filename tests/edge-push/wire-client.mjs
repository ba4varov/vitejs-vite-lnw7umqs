// Local TLS fixture only. Permissions and the adapter prohibit a provider connection.
import {Buffer} from 'node:buffer'
import {readFileSync} from 'node:fs'
import {preparePush,sendPinned} from '../../supabase/functions/_shared/push-test.mjs'
import {denoConnector} from '../../supabase/functions/_shared/push-deno.ts'
import {fixtureKeys} from '../unit/push-fixtures.mjs'

const [certPath,portText]=Deno.args,port=Number(portText),keys=fixtureKeys(),receiver=fixtureKeys(2)
if(!Number.isInteger(port)||port<1||port>65535)throw Error('INVALID_FIXTURE_PORT')
const details=preparePush({endpoint:'https://fcm.googleapis.com/wp/isolated',publicKey:keys.publicKey,p256dh:receiver.publicKey,auth:Buffer.alloc(16,1).toString('base64url'),language:'bg'},{...keys,subject:'mailto:test@example.invalid'},'b0000000-0000-0000-0000-000000000001')
const cert=readFileSync(certPath,'utf8'),resolver=async()=>[{address:'8.8.8.8',family:4}]
const nativeConnector=denoConnector({
 ...Deno,
 connect:options=>{
  if(options.hostname!=='8.8.8.8'||options.port!==443)throw Error('UNPINNED')
  return Deno.connect({hostname:'127.0.0.1',port})
 },
 startTls:(tcp,options)=>Deno.startTls(tcp,{...options,caCerts:[cert]}),
})
const connector=async(target,signal)=>{
 const connection=await nativeConnector(target,signal)
 return {...connection,write:bytes=>connection.write(bytes.subarray(0,31))}
}
const results=[]
for(const mode of ['accepted','json','chunked','html','empty','jwt','jwt-permission','unknown']){
 results.push(await sendPinned({...details,headers:{...details.headers,'X-Fixture-Mode':mode}},resolver,connector))
}
const wrongConnector=denoConnector({
 ...Deno,
 connect:()=>Deno.connect({hostname:'127.0.0.1',port}),
 startTls:(tcp,options)=>Deno.startTls(tcp,{...options,hostname:'wrong.example.invalid',caCerts:[cert]}),
})
let wrongNameRejected=false
try{await sendPinned(details,resolver,wrongConnector)}catch(error){wrongNameRejected=error.diagnosticCode==='tls_failed'}
console.log(JSON.stringify({results,wrongNameRejected}))
