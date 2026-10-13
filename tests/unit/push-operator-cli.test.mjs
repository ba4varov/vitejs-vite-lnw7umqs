import test from 'node:test'
import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import {createHmac} from 'node:crypto'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'

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
output=b'';stage=0;deadline=time.monotonic()+10
try:
 while time.monotonic()<deadline:
  if select.select([master],[],[],0.05)[0]:
   try: chunk=os.read(master,65536)
   except OSError: break
   if not chunk: break
   output+=chunk
   prompts=output.count(b'> ')
   if prompts>stage:
    answer=[case['operator'],case['jwt'],'CANCEL'][stage]
    os.write(master,(answer+chr(13)).encode());stage+=1
  elif child.poll() is not None: break
 if child.poll() is None: child.wait(timeout=2)
 print(json.dumps({'code':child.returncode,'output':output.decode(),'prompts':stage}))
finally:
 if child.poll() is None: child.kill();child.wait()
 os.close(master)
`
function cli(session,valid){
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
 assert.ok(body.operation==='prepare'||body.operation==='cancel','No send is permitted in this test')
 return new Response(JSON.stringify(body.operation==='prepare'?{error:'PUSH_TEST_READY',permitId:'${id}',userId:'${id}',deviceId:'${id}',category:'wind'}:{error:'PUSH_TEST_CLOSED'}))
}
process.on('exit',()=>{assert.deepEqual(calls,${JSON.stringify(valid?['prepare','cancel']:[])});console.log('CLI_FIXTURE_OK')})
`)
  const result=spawnSync('python3',['-c',harness,JSON.stringify({cmd:[process.execPath,'--import',preload,'scripts/push-operator.mjs','a'.repeat(20),id,id],operator,jwt:session})],{encoding:'utf8',timeout:15000})
  assert.equal(result.status,0,'PTY harness must complete')
  const observed=JSON.parse(result.stdout)
  assert.ok(!observed.output.includes(operator)&&!observed.output.includes(session),'Hidden credentials must not echo')
  assert.match(observed.output,/CLI_FIXTURE_OK/)
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
