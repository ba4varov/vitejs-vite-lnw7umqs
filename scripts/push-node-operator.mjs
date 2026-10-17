import {randomUUID} from 'node:crypto'
import {pathToFileURL} from 'node:url'

export const PRODUCTION_URL='https://ba4varov-wheater.vercel.app/api/push-operator'
export const SELECTED_DEVICE='5ff76543-ea64-4721-9846-3859621e954f'
const uuid=v=>typeof v==='string'&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/.test(v)
export function options(args){
 if(![2,3].includes(args.length)||!uuid(args[0])||args[1]!==SELECTED_DEVICE||!['rain','storm','wind','cold','heat','walk','garden','sport'].includes(args[2]||'wind'))throw Error('INVALID_SELECTION')
 return Object.freeze({user:args[0],device:args[1],category:args[2]||'wind'})
}

// Only locally constructed diagnostics can reach stderr; exception messages are untrusted.
const diagnostics=new WeakMap()
const serverCodes=new Set(['UNAUTHORIZED','INVALID_SESSION','FORBIDDEN','OPERATOR_UNAVAILABLE','PUSH_NODE_DISABLED','PUSH_NODE_UNCONFIGURED','PUSH_TEST_DISABLED','PUSH_TEST_UNCONFIGURED','PUSH_TEST_UNCERTAIN','PUSH_TEST_NOT_READY','PUSH_TEST_NOT_ALLOWED'])
const httpMessages=new Map([[401,'HTTP 401: неуспешно удостоверяване.'],[403,'HTTP 403: отказан достъп.'],[409,'HTTP 409: конфликт или отказана подготовка.'],[503,'HTTP 503: услугата е недостъпна или не е активирана.']])
function stopped(message){
 const error=Error('NODE_REQUEST_STOPPED');diagnostics.set(error,message);return error
}
export function failureDiagnostic(error){
 return diagnostics.get(error)||'Операцията спря: непотвърден резултат.'
}

// Credentials only enter through the hidden TTY prompts, never argv, env or files.
export function createNodeClient(token,session,fetcher=fetch){
 if(!/^[A-Za-z0-9_-]{43,128}$/.test(token)||!/^([A-Za-z0-9_-]+\.){2}[A-Za-z0-9_-]+$/.test(session))throw Error('INVALID_CREDENTIALS')
 return async body=>{
  const signal=AbortSignal.timeout(55000)
  let reader,timer,response
  try{
   try{response=await fetcher(PRODUCTION_URL,{method:'POST',redirect:'error',cache:'no-store',signal,headers:{authorization:`Bearer ${token}.${session}`,'content-type':'application/json'},body:JSON.stringify(body)})}
   catch{throw stopped('Мрежова грешка: заявката не е потвърдена.')}
   if(response.redirected)throw stopped('Невалиден отговор от сървъра.')
   const httpFailure=response.status!==200
   const httpMessage=httpMessages.get(response.status)||'HTTP отказ: неочакван статус.'
   let result
   try{
    reader=response.body?.getReader();if(!reader)throw Error('INVALID_RESPONSE')
    const aborted=new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('TIMEOUT')),Math.max(1,55000))})
    const chunks=[];let size=0
    while(true){const part=await Promise.race([reader.read(),aborted]);if(part.done)break;size+=part.value.length;if(size>2048)throw Error('RESPONSE_LIMIT');chunks.push(Buffer.from(part.value))}
    result=JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if(!result||typeof result!=='object'||Array.isArray(result))throw Error('INVALID_RESPONSE')
   }catch{throw stopped(httpFailure?httpMessage:'Невалиден отговор от сървъра.')}
   if(httpFailure)throw stopped(httpMessage+(serverCodes.has(result.error)?` Код: ${result.error}.`:''))
   return result
  }catch(error){throw diagnostics.has(error)?error:stopped('Невалиден отговор от сървъра.')}
  finally{clearTimeout(timer);if(reader)void reader.cancel().catch(()=>{})}
 }
}

export async function runNodeOperator(selection,{node,confirm,output,requestId=randomUUID()}){
 const o=options([selection.user,selection.device,selection.category||'wind'])
 if(!uuid(requestId))throw Error('INVALID_SELECTION')
 let permit
 try{
  const ready=await node({operation:'prepare',userId:o.user,deviceId:o.device,category:o.category,requestId})
  // Retain a returned permit for cancellation even if the selection echo is invalid.
  if(uuid(ready?.permitId))permit=ready.permitId
  if(ready?.error!=='PUSH_TEST_READY'||!permit||ready.userId!==o.user||ready.deviceId!==o.device||ready.category!==o.category)throw stopped('Невалиден отговор при предварителната проверка.'+ (serverCodes.has(ready?.error)?` Код: ${ready.error}.`:''))
  output(`USER_UUID: ${o.user}\nDEVICE_UUID: ${o.device}\nКатегория: ${o.category}`)
  if(await confirm('SEND ONE')!=='SEND ONE'){output('Отказано. Няма опит за изпращане.');return}
  const result=await node({operation:'send',permitId:permit,confirmation:`SEND ONE ${o.user} ${o.device}`})
  if(result?.error!=='PUSH_TEST_ACCEPTED'||result.diagnostic?.category!=='accepted'||!Number.isInteger(result.diagnostic?.providerStatus)||result.diagnostic.providerStatus<200||result.diagnostic.providerStatus>299)throw Error('SEND_UNCONFIRMED')
  output('Доставчикът прие единствения опит. Доставката до телефона не е потвърдена.')
 }finally{
  // Cancellation is cleanup, never another prepare/send attempt.
  if(permit){
   try{if((await node({operation:'cancel',permitId:permit})).error!=='PUSH_TEST_CLOSED')throw Error('CANCEL_FAILED');output('Разрешението е затворено.')}
   catch{output('Отнемането не е потвърдено. Не повтаряйте; permit изтича в DB.');throw Error('CANCEL_UNCONFIRMED')}
  }
 }
}

// TTY input handling retained from scripts/push-operator.mjs.
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
async function main(){
 const o=options(process.argv.slice(2))
 let token='',session=''
 try{
  token=await prompt('Съществуващ операторски token (скрит; само в паметта):',true)
  session=await prompt('Текущ access token на избрания администратор (скрит):',true)
  await runNodeOperator(o,{node:createNodeClient(token,session),confirm:phrase=>prompt('За един-единствен опит въведете точно: '+phrase),output:console.log})
 }finally{token='';session=''}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)main().catch(error=>{
 console.error(failureDiagnostic(error))
 console.error('Операцията спря. Не повтаряйте при грешка или неизвестен резултат.')
 console.error('Употреба: node scripts/push-node-operator.mjs USER_UUID DEVICE_UUID [wind]')
 process.exitCode=1
})
