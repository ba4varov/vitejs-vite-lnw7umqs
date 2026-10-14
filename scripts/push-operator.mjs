import {randomUUID} from 'node:crypto'
import {pathToFileURL} from 'node:url'
import {safeProviderReason,safeProviderBodyStatus} from '../supabase/functions/_shared/push-provider.mjs'
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v)
export function options(args) {
 if(![3,4].includes(args.length)||!/^[a-z]{20}$/.test(args[0])||!args.slice(1,3).every(uuid)||!['rain','storm','wind','cold','heat','walk','garden','sport'].includes(args[3]||'wind'))throw Error('INVALID_SELECTION')
 return {project:args[0],user:args[1],device:args[2],category:args[3]||'wind'}
}
export async function runOperator(o,{edge,confirm,output,requestId=randomUUID()}) {
 let permit
 const cleanup=async()=>{
  if(!permit)return
  try{const result=await edge({operation:'cancel',permitId:permit});if(result.error!=='PUSH_TEST_CLOSED')throw Error('CANCEL_FAILED');output('Разрешението за този тест е отнето.')}
  catch{output('Отнемането не е потвърдено. Не повтаряйте; server-side разрешението изтича автоматично.')}
 }
 try {
  const result=await edge({operation:'prepare',userId:o.user,deviceId:o.device,category:o.category,requestId})
  if(result.error!=='PUSH_TEST_READY'||!uuid(result.permitId)||result.userId!==o.user||result.deviceId!==o.device||result.category!==o.category)throw Error('NOT_READY')
  permit=result.permitId
  output(`Production проект: ${o.project}\nИзбран акаунт (USER_UUID): ${o.user}\nИзбрано устройство (DEVICE_UUID): ${o.device}\nКатегория: ${o.category}`)
  const phrase=`SEND ONE ${o.user} ${o.device}`
  if(await confirm('SEND ONE')!=='SEND ONE')return output('Отказано. Няма опит за изпращане.')
  const sent=await edge({operation:'send',permitId:permit,confirmation:phrase})
  const categories=['accepted','subscription_expired','provider_auth_rejected','rate_limited','provider_unavailable','redirect_refused','request_rejected','provider_rejected','tls_failed','connect_failed','write_failed','response_failed','response_limit','invalid_response','invalid_headers','request_limit','timeout','transport_failed','transport_uncertain','dns_failed','preparation_failed','database_uncertain']
  const providerReason=safeProviderReason(sent.diagnostic?.providerReason)
  const providerBodyStatus=safeProviderBodyStatus(sent.diagnostic?.providerBodyStatus)
  output(JSON.stringify({...(providerBodyStatus?{providerBodyStatus}:{}),...(providerReason?{providerReason}:{}),category:categories.includes(sent.diagnostic?.category)?sent.diagnostic.category:'unknown',providerStatus:Number.isInteger(sent.diagnostic?.providerStatus)&&sent.diagnostic.providerStatus>=200&&sent.diagnostic.providerStatus<=599?sent.diagnostic.providerStatus:null}))
 }finally{await cleanup()}
}
function prompt(text,hidden=false) {
 if(!process.stdin.isTTY || !process.stdout.isTTY)throw Error('TTY_REQUIRED')
 return new Promise((resolve,reject)=>{
  const input=process.stdin,output=process.stdout,wasRaw=input.isRaw
  let value='',escape='',pasting=false,invalid=false,finished=false
  input.setRawMode(true);input.resume()
  // Bracketed paste keeps pasted newlines from acting as Enter.
  output.write('\u001b[?2004h'+text+'\n> ')
  const done=(error)=>{
   if(finished)return
   finished=true
   input.off('data',read);input.off('end',closed);input.off('error',failed)
   input.setRawMode(Boolean(wasRaw));input.pause()
   output.write('\u001b[?2004l\n')
   if(error)reject(error);else resolve(invalid?'':value)
  }
  const closed=()=>done(Error('CANCELLED'))
  const failed=()=>done(Error('INPUT_FAILED'))
  const append=c=>{
   if(c<' '||c>'~'||value.length>=8192){invalid=true;return}
   value+=c;if(!hidden)output.write(c)
  }
  const read=chunk=>{
   const chars=chunk.toString()
   for(let i=0;i<chars.length;i++){
    const c=chars[i]
    if(c==='\u0003'){done(Error('CANCELLED'));return}
    if(escape||c==='\u001b'){
     escape+=c
     if(escape==='\u001b[200~'){pasting=true;escape='';continue}
     if(escape==='\u001b[201~'){pasting=false;escape='';continue}
     if(['\u001b[200~','\u001b[201~'].some(marker=>marker.startsWith(escape)))continue
     invalid=true;escape='';continue
    }
    if(pasting){append(c);continue}
    if(c==='\r'||c==='\n'){
     // A pasted Enter must not confirm, even without bracketed paste support.
     if(!hidden&&i>0)invalid=true
     if(chars.slice(i+1).replace(/^\n$/,'')!=='')invalid=true
     done();return
    }
    if(c==='\u007f'||c==='\b'){
     if(value.length){value=value.slice(0,-1);if(!hidden)output.write('\b \b')}
     continue
    }
    append(c)
   }
  }
  input.on('data',read);input.once('end',closed);input.once('error',failed)
 })
}
async function main() {
 const o=options(process.argv.slice(2))
 let token=await prompt('Съществуващ операторски token (скрит; само в паметта):',true)
 if(!/^[A-Za-z0-9_-]{43,128}$/.test(token))throw Error('INVALID_TOKEN')
 let session=await prompt('Текущ access token от входа на избрания администратор (скрит):',true)
 if(!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(session))throw Error('INVALID_SESSION')
 const edge=async body=>{
  const response=await fetch(`https://${o.project}.supabase.co/functions/v1/push-test`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:'Bearer '+token+'.'+session,'content-type':'application/json'},body:JSON.stringify(body)})
  const reader=response.body.getReader();let text='',size=0
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2048)throw Error('EDGE_FAILED');text+=new TextDecoder().decode(value)}}finally{await reader.cancel()}
  return JSON.parse(text)
 }
 try{await runOperator(o,{edge,confirm:phrase=>prompt('За един-единствен опит въведете точно: '+phrase),output:console.log})}finally{token='';session=''}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{
 const messages={INVALID_SELECTION:'Употреба: node scripts/push-operator.mjs PROJECT_REF USER_UUID DEVICE_UUID [wind]',TTY_REQUIRED:'Нужен е интерактивен terminal.',INVALID_TOKEN:'Невалиден формат на операторския token.',INVALID_SESSION:'Невалиден формат на access token.',NOT_READY:'Production preflight отказа: проверете избрания администратор, устройството, съгласието, cooldown и server конфигурацията.'}
 if(Object.hasOwn(messages,error?.message))console.error(messages[error.message])
 console.error('Операцията спря. Не повтаряйте при неизвестен резултат.');process.exitCode=1
})
