import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {createHmac} from 'node:crypto'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

const device='c0000000-0000-0000-0000-000000000002'
const id='b0000000-0000-0000-0000-000000000001',operator='a'.repeat(43)
const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url')
const payload=Buffer.from(JSON.stringify({sub:id,role:'authenticated',exp:4102444800})).toString('base64url')
const signed=header+'.'+payload
// Public test-only signing material; no real login, endpoint or credentials.
const jwt=signed+'.'+createHmac('sha256','public-cli-fixture').update(signed).digest('base64url')
const harness=String.raw`
import json,os,pty,select,subprocess,sys,time
case=json.loads(sys.argv[1])
master,slave=pty.openpty()
child=subprocess.Popen(case['cmd'],stdin=slave,stdout=slave,stderr=slave)
os.close(slave)
output=b'';stage=0;deadline=time.monotonic()+10;pending=[];next_at=0
try:
 while time.monotonic()<deadline:
  if pending and time.monotonic()>=next_at:
   os.write(master,pending.pop(0).encode());next_at=time.monotonic()+0.15
  if select.select([master],[],[],0.05)[0]:
   try: chunk=os.read(master,65536)
   except OSError: break
   if not chunk: break
   output+=chunk
   prompts=output.count(b'> ')
   if prompts>stage:
    if stage<2:
     answer=[case['operator'],case['jwt']][stage]
     os.write(master,(answer+chr(13)).encode())
    else:
     pending=case['confirmation'][:];next_at=time.monotonic()+0.15
    stage+=1
  elif child.poll() is not None: break
 if child.poll() is None: child.wait(timeout=2)
 print(json.dumps({'code':child.returncode,'output':output.decode(),'prompts':stage,'pending':len(pending)}))
finally:
 if child.poll() is None: child.kill();child.wait()
 os.close(master)
`
function cli(session,valid,{confirmation=['CANCEL\r'],send=false,inputSession=session}={}){
 const dir=mkdtempSync(join(tmpdir(),'meteo-cli-'))
 try{
  const preload=join(dir,'mock-fetch.mjs')
  writeFileSync(preload,`
import assert from 'node:assert/strict'
const calls=[]
globalThis.fetch=async(url,options)=>{
 assert.ok(url==='https://${'a'.repeat(20)}.supabase.co/functions/v1/push-test')
 assert.ok(options.headers.authorization===${JSON.stringify('Bearer '+operator+'.'+session)},'CLI must preserve the entered JWT')
 assert.equal(options.redirect,'error')
 const body=JSON.parse(options.body);calls.push(body.operation)
 assert.ok(body.operation==='prepare'||body.operation==='cancel'||(${send}&&body.operation==='send'),'Unexpected send')
 if(body.operation==='send')assert.deepEqual(body,{operation:'send',permitId:'${id}',confirmation:'SEND ONE ${id} ${device}'})
 return new Response(JSON.stringify(body.operation==='prepare'?{error:'PUSH_TEST_READY',permitId:'${id}',userId:'${id}',deviceId:'${device}',category:'wind'}:body.operation==='send'?{diagnostic:{category:'accepted',providerStatus:201}}:{error:'PUSH_TEST_CLOSED'}))
}
process.on('exit',()=>{assert.deepEqual(calls,${JSON.stringify(valid?(send?['prepare','send','cancel']:['prepare','cancel']):[])});console.log('CLI_FIXTURE_OK')})
`)
  const result=spawnSync('python3',['-c',harness,JSON.stringify({cmd:[process.execPath,'--import',preload,'scripts/push-operator.mjs','a'.repeat(20),id,device],operator,jwt:inputSession,confirmation})],{encoding:'utf8',timeout:15000})
  assert.equal(result.status,0,'PTY harness must complete')
  const observed=JSON.parse(result.stdout)
  assert.ok(!observed.output.includes(operator)&&!observed.output.includes(session),'Hidden credentials must not echo')
  assert.match(observed.output,/CLI_FIXTURE_OK/)
  assert.equal(observed.pending,0,'Input must wait for the explicit final Enter or Ctrl+C')
  return observed
 }finally{rmSync(dir,{recursive:true,force:true})}
}
test('actual CLI accepts a signed three-part JWT, reaches mocked preparation, and cancels before send',()=>{
 const result=cli(jwt,true)
 assert.equal(result.code,0);assert.equal(result.prompts,3)
 assert.match(result.output,/Няма опит за изпращане/)
 assert.doesNotMatch(result.output,/Невалиден формат на access token/)
})
test('actual CLI rejects malformed JWT separators/component counts before any fetch',()=>{
 for(const malformed of ['header.payload','header.payload.signature.extra','header..signature','header\\xpayload\\ysignature']){
  const result=cli(malformed,false)
  assert.equal(result.code,1);assert.equal(result.prompts,2)
  assert.match(result.output,/Невалиден формат на access token/)
 }
})

test('CLI displays distinct selections and sends the full server phrase after short confirmation',()=>{
 const result=cli(jwt,true,{confirmation:['SEND ONE','\r'],send:true})
 assert.equal(result.code,0)
 assert.ok(result.output.includes('Избран акаунт (USER_UUID): '+id))
 assert.ok(result.output.includes('Избрано устройство (DEVICE_UUID): '+device))
 assert.ok(result.output.includes('въведете точно: SEND ONE\r\n> '))
})
test('visible Backspace edits and hidden Backspace preserves credentials',()=>{
 for(const backspace of ['\x7f','\b']){
  const result=cli(jwt,true,{confirmation:['SEND ONX'+backspace+'E','\r'],send:true})
  assert.equal(result.code,0);assert.ok(result.output.includes('\b \b'))
  assert.equal(cli(jwt,true,{inputSession:jwt+'x'+backspace}).code,0)
 }
})
test('bracketed paste waits for Enter, including split markers',()=>{
 const result=cli(jwt,true,{confirmation:['\x1b[20','0~SEND ONE','\x1b[201~','\r'],send:true})
 assert.equal(result.code,0)
 assert.ok(result.output.includes('\x1b[?2004h'))
 assert.ok(result.output.includes('\x1b[?2004l'))
})
test('invalid, multiline and control-character paste never sends',()=>{
 for(const text of ['SEND ONE\r','send one\r','SEND ONE extra\r','SEND ONE \r','SEND ONE\rgarbage','\x1b[200~SEND ONE\nextra\x1b[201~\r','\x1b[200~SEND ONE\n\x1b[201~\r','\x1b[200~SEND ONX\x7fE\x1b[201~\r','SEND\t ONE\r']){
  const result=cli(jwt,true,{confirmation:[text]})
  assert.equal(result.code,0);assert.match(result.output,/Няма опит за изпращане/)
 }
})
test('Ctrl+C cancels and cleans up the prepared permit without sending',()=>{
 const result=cli(jwt,true,{confirmation:['SEND ONE','\x03']})
 assert.equal(result.code,1)
 assert.match(result.output,/Разрешението за този тест е отнето/)
 assert.ok(result.output.includes('\x1b[?2004l'))
})
