import {randomUUID} from 'node:crypto'
import {pathToFileURL} from 'node:url'
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
  output(`Production проект ${o.project}; акаунт ${o.user}; устройство ${o.device}; категория ${o.category}.`)
  const phrase=`SEND ONE ${o.user} ${o.device}`
  if(!await confirm(phrase))return output('Отказано. Няма опит за изпращане.')
  const sent=await edge({operation:'send',permitId:permit,confirmation:phrase})
  const categories=['accepted','subscription_expired','provider_auth_rejected','rate_limited','provider_unavailable','redirect_refused','request_rejected','provider_rejected','tls_failed','connect_failed','write_failed','response_failed','response_limit','invalid_response','invalid_headers','request_limit','timeout','transport_failed','transport_uncertain','dns_failed','preparation_failed','database_uncertain']
  output(JSON.stringify({category:categories.includes(sent.diagnostic?.category)?sent.diagnostic.category:'unknown',providerStatus:Number.isInteger(sent.diagnostic?.providerStatus)&&sent.diagnostic.providerStatus>=200&&sent.diagnostic.providerStatus<=599?sent.diagnostic.providerStatus:null}))
 }finally{await cleanup()}
}
function prompt(text,hidden=false) {
 if(!process.stdin.isTTY || !process.stdout.isTTY)throw Error('TTY_REQUIRED')
 process.stdout.write(text+'\n> ')
 return new Promise((resolve,reject)=>{
  let value='';process.stdin.setRawMode(true);process.stdin.resume()
  const done=()=>{process.stdin.off('data',read);process.stdin.setRawMode(false);process.stdin.pause();process.stdout.write('\n')}
  const read=chunk=>{for(const c of chunk.toString()){
   if(c==='\u0003'){done();reject(Error('CANCELLED'));return}
   if(c==='\r'||c==='\n'){done();resolve(value);return}
   if(c==='\u007f'){value=value.slice(0,-1);continue}
   if(c>=' '&&c<='~'&&value.length<8192){value+=c;if(!hidden)process.stdout.write(c)}
  }}
  process.stdin.on('data',read)
 })
}
async function main() {
 const o=options(process.argv.slice(2))
 let token=await prompt('Съществуващ операторски token (скрит; само в паметта):',true)
 if(!/^[A-Za-z0-9_-]{43,128}$/.test(token))throw Error('INVALID_TOKEN')
 let session=await prompt('Текущ access token от входа на избрания администратор (скрит):',true)
 if(!/^[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]+$/.test(session))throw Error('INVALID_SESSION')
 const edge=async body=>{
  const response=await fetch(`https://${o.project}.supabase.co/functions/v1/push-test`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:'Bearer '+token+'.'+session,'content-type':'application/json'},body:JSON.stringify(body)})
  const reader=response.body.getReader();let text='',size=0
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2048)throw Error('EDGE_FAILED');text+=new TextDecoder().decode(value)}}finally{await reader.cancel()}
  return JSON.parse(text)
 }
 try{await runOperator(o,{edge,confirm:async phrase=>(await prompt('За един-единствен опит въведете точно: '+phrase))===phrase,output:console.log})}finally{token='';session=''}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{
 const messages={INVALID_SELECTION:'Употреба: node scripts/push-operator.mjs PROJECT_REF USER_UUID DEVICE_UUID [wind]',TTY_REQUIRED:'Нужен е интерактивен terminal.',INVALID_TOKEN:'Невалиден формат на операторския token.',INVALID_SESSION:'Невалиден формат на access token.',NOT_READY:'Production preflight отказа: проверете избрания администратор, устройството, съгласието, cooldown и server конфигурацията.'}
 if(Object.hasOwn(messages,error?.message))console.error(messages[error.message])
 console.error('Операцията спря. Не повтаряйте при неизвестен резултат.');process.exitCode=1
})
