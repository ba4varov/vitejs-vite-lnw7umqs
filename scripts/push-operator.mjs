import {spawn} from 'node:child_process'
import {pathToFileURL} from 'node:url'

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
export function options(args) {
 if(args.length!==5 || !/^[a-z]{20}$/.test(args[0]) || !args.slice(1,4).every(v=>uuid.test(v)) || !['rain','storm','wind','cold','heat','walk','garden','sport'].includes(args[4]))throw Error('INVALID_SELECTION')
 return {project:args[0],user:args[1],device:args[2],approver:args[3],category:args[4]}
}
export async function runOperator(o,{db,edge,confirm,output}) {
 let permit
 const cleanup=async()=>{
  if(!permit || !uuid.test(permit))return
  try{await db(`select public.close_push_operator('${permit}');`);output('DB gate за този тест: затворен.')}catch{
   output('DB cleanup: непотвърден. Срокът блокира нови опити след максимум 60 секунди; DB owner трябва да провери gate.')
   throw Error('CLEANUP_UNCONFIRMED')
  }
 }
 try {
  const preflight=await edge({operation:'preflight'})
  if(preflight.error!=='PUSH_TEST_READY'){
   output('Edge проверка: '+(['PUSH_TEST_DISABLED','PUSH_TEST_UNCONFIGURED','UNAUTHORIZED','PUSH_TEST_NOT_READY'].includes(preflight.error)?preflight.error:'unknown'))
   throw Error('EDGE_NOT_READY')
  }
  permit=await db(`select public.prepare_push_operator('${o.user}','${o.device}','${o.approver}','${o.category}');`)
  if(!uuid.test(permit))throw Error('DB_NOT_READY')
  if((await edge({preflightPermitId:permit})).error!=='PUSH_TEST_READY')throw Error('DEVICE_NOT_READY')
  output(`Проект ${o.project}; акаунт ${o.user}; устройство ${o.device}; категория ${o.category}. Проверете, че това е Note 13 Pro в изолиран тестов проект.`)
  if(!await confirm(`SEND ONE ${o.project} ${o.user} ${o.device}`))return output('Отказано. Няма опит за изпращане.')
  await db(`select public.arm_push_operator('${permit}');`)
  // A single invocation, no redirect/retry/replay even after an unknown result.
  const result=await edge({permitId:permit})
  const categories=['accepted','subscription_expired','provider_auth_rejected','rate_limited','provider_unavailable','redirect_refused','request_rejected','provider_rejected','tls_failed','connect_failed','write_failed','response_failed','response_limit','invalid_response','invalid_headers','request_limit','timeout','transport_failed','transport_uncertain','dns_failed','preparation_failed','database_uncertain']
  output(JSON.stringify({category:categories.includes(result.diagnostic?.category)?result.diagnostic.category:'unknown',providerStatus:Number.isInteger(result.diagnostic?.providerStatus)&&result.diagnostic.providerStatus>=200&&result.diagnostic.providerStatus<=599?result.diagnostic.providerStatus:null}))
 }finally{
  await cleanup()
 }
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
   if(c>=' '&&c<='~'&&value.length<256){value+=c;if(!hidden)process.stdout.write(c)}
  }}
  process.stdin.on('data',read)
 })
}
async function main() {
 const o=options(process.argv.slice(2))
 // libpq service credentials are configured externally, never created by this tool.
 if(!process.env.PGSERVICE || !process.env.PGSSLROOTCERT || process.env.PGPASSWORD)throw Error('EXTERNAL_DB_AUTH_REQUIRED')
 let token=await prompt('Съществуващ операторски token (скрит; само в паметта):',true)
 if(!/^[A-Za-z0-9_-]{43,128}$/.test(token))throw Error('INVALID_TOKEN')
 const db=sql=>new Promise((resolve,reject)=>{
  const child=spawn('psql',['-X','-w','-qAt','-v','ON_ERROR_STOP=1','--host',`db.${o.project}.supabase.co`,'--dbname','postgres'],{env:{...process.env,PGSSLMODE:'verify-full',PGCONNECT_TIMEOUT:'5',PGOPTIONS:'-c statement_timeout=5000 -c lock_timeout=3000'},stdio:['pipe','pipe','ignore']})
  let data='';const timer=setTimeout(()=>child.kill('SIGKILL'),10000)
  child.stdout.on('data',c=>{data+=c;if(data.length>512)child.kill('SIGKILL')})
  child.on('error',()=>{clearTimeout(timer);reject(Error('DB_FAILED'))})
  child.on('close',code=>{clearTimeout(timer);if(code===0)resolve(data.trim());else reject(Error('DB_FAILED'))})
  child.stdin.on('error',()=>{});child.stdin.end(sql)
 })
 const edge=async body=>{
  const response=await fetch(`https://${o.project}.supabase.co/functions/v1/push-test`,{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify(body)})
  const reader=response.body.getReader();let text='',size=0
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>2048)throw Error('EDGE_FAILED');text+=new TextDecoder().decode(value)}}finally{await reader.cancel()}
  return JSON.parse(text)
 }
 try{await runOperator(o,{db,edge,confirm:async phrase=>(await prompt('За максимум един опит въведете точно: '+phrase))===phrase,output:console.log})}finally{token=''}
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{
 const messages={INVALID_SELECTION:'Употреба: node scripts/push-operator.mjs PROJECT_REF USER_UUID DEVICE_UUID APPROVER_UUID CATEGORY',EXTERNAL_DB_AUTH_REQUIRED:'Нужни са външни PGSERVICE и PGSSLROOTCERT; PGPASSWORD не се приема.',TTY_REQUIRED:'Нужен е интерактивен terminal.',INVALID_TOKEN:'Невалиден формат на операторския token.',DB_FAILED:'DB проверката/операцията не е потвърдена. Проверете достъпа, правата и текущите условия.',DEVICE_NOT_READY:'Избраната регистрация не премина Edge проверката.',EDGE_NOT_READY:'Edge конфигурацията не е готова.'}
 if(Object.hasOwn(messages,error?.message))console.error(messages[error.message])
 console.error('Операцията спря. Не повтаряйте при неизвестен резултат.');process.exitCode=1
})
