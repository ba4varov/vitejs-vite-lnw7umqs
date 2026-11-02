import test from 'node:test'
import assert from 'node:assert/strict'
import {readProviderDiagnostic} from '../../supabase/functions/_shared/push-provider.mjs'

const phrase='UnauthorizedRegistration'
const recognized={providerBodyStatus:'recognized',providerReason:'fcm_unauthorized_registration'}
const html='<html><head><title>UnauthorizedRegistration</title></head><body bgcolor="#FFFFFF" text="#000000"><h1>UnauthorizedRegistration</h1><h2>Error 400</h2></body></html>'
const json=JSON.stringify({error:{code:400,status:'INVALID_ARGUMENT',message:'SYNTHETIC_PRIVATE',details:[{'@type':'type.googleapis.com/google.rpc.BadRequest',fieldViolations:[{description:'SYNTHETIC_PRIVATE'}]}]}})
async function read(wire,headers,{split=4096,error=false}={}){
 const bytes=Buffer.from(wire);let offset=0
 return readProviderDiagnostic({read:async buffer=>{
  if(error)throw Error('SYNTHETIC_PRIVATE')
  if(offset===bytes.length)return null
  const n=Math.min(split,buffer.length,bytes.length-offset)
  buffer.set(bytes.subarray(offset,offset+n));offset+=n;return n
 }},Buffer.alloc(0),headers)
}
const chunk=(body,extension='',trailers='')=>`${Buffer.byteLength(body).toString(16)}${extension}\r\n${body}\r\n0${extension}\r\n${trailers}\r\n`
const headers=['Content-Type: text/plain','Transfer-Encoding: chunked']

test('RFC 9112 chunk extensions and trailers preserve exact allowlisted body diagnostics',async()=>{
 for(const split of [1,7,4096]){
  for(const extension of ['', ';fixture=yes', ';flag;quoted="a; b\\\"c"', ' \t; name = "value"']){
   for(const trailers of ['', 'X-Fixture: SYNTHETIC_PRIVATE\r\n', 'Content-Type: application/json\r\nX-Fixture: INVALID_ARGUMENT\r\n']){
    assert.deepEqual(await read(chunk(phrase,extension,trailers),headers,{split}),recognized)
   }
  }
 }
})
test('multiple chunks, zero chunk and fragmented trailer completion',async()=>{
 const wire='c;first=yes\r\nUnauthorized\r\nc;second=yes\r\nRegistration\r\n0000;end=yes\r\nX-Fixture: ignored\r\n\r\n'
 for(const split of [1,7,4096])assert.deepEqual(await read(wire,headers,{split}),recognized)
 assert.deepEqual(await read('0;empty\r\nX-Fixture: ignored\r\n\r\n',headers),{providerBodyStatus:'empty'})
})
test('malformed extensions and trailers fail closed',async()=>{
 for(const extension of [';', ';=value', ';name=', ';name="unterminated', ';name="bad\0"', ';name=bad value', ';name=bad\x80', ';name="bad\\\x7f"']){
  assert.deepEqual(await read(chunk(phrase,extension),headers),{providerBodyStatus:'invalid_framing'})
 }
 for(const trailers of ['missing-colon\r\n', ' Folded: no\r\n', 'X: bad\0\r\n']){
  assert.deepEqual(await read(chunk(phrase,'',trailers),headers),{providerBodyStatus:'invalid_framing'})
 }
})
test('incomplete framing, bounds, ambiguous length and encoding remain enforced',async()=>{
 for(const wire of ['0\r\n','0;end=yes\r\nX-Fixture: pending\r\n','1;fixture=yes\r\nx','1\r\nx\r\n']){
  assert.deepEqual(await read(wire,headers),{providerBodyStatus:'incomplete'})
 }
 for(const wire of [chunk('x'.repeat(1025)),chunk(phrase,';fixture="'+'x'.repeat(2048)+'"'),chunk(phrase,'','X-Fixture: '+'x'.repeat(2048)+'\r\n')]){
  assert.deepEqual(await read(wire,headers),{providerBodyStatus:'too_large'})
 }
 assert.deepEqual(await read(chunk(phrase),[...headers,'Content-Length: 24']),{providerBodyStatus:'invalid_framing'})
 assert.deepEqual(await read(chunk(phrase),[...headers,'Content-Encoding: gzip']),{providerBodyStatus:'unsupported_encoding'})
 assert.deepEqual(await read('',headers,{error:true}),{providerBodyStatus:'read_failed'})
})
test('documented HTML and JSON, plaintext, charset and framing characterization',async()=>{
 for(const [body,type,result] of [[html,'text/html',recognized],[phrase,'text/plain',recognized],[json,'application/json',{providerBodyStatus:'recognized',providerReason:'fcm_invalid_argument'}]]){
  for(const charset of ['', '; charset=UTF-8', '; charset=iso-8859-1']){
   const contentType=`Content-Type: ${type.toUpperCase()}${charset}`
   for(const split of [1,7,4096]){
    for(const [wire,framing] of [[body,[]],[body,[`Content-Length: ${Buffer.byteLength(body)}`]],[chunk(body,';fixture=yes','X-Fixture: ignored\r\n'),['Transfer-Encoding: chunked']]]){
     assert.deepEqual(await read(wire,[contentType,...framing],{split}),result)
    }
   }
  }
  // No MIME sniffing: absent/mismatched media types intentionally remain unknown.
  assert.deepEqual(await read(body,[]),{providerBodyStatus:'unknown_format'})
  assert.deepEqual(await read(body,['Content-Type: application/octet-stream']),{providerBodyStatus:'unknown_format'})
 }
})
test('only exact known formats escape, never private values from bodies or trailers',async()=>{
 for(const body of ['SYNTHETIC_PRIVATE',phrase+' SYNTHETIC_PRIVATE','<p>'+phrase+'</p>',html.replace('<h1>UnauthorizedRegistration','<h1>InvalidTTL'),JSON.stringify({error:{message:'INVALID_ARGUMENT',status:'SYNTHETIC_PRIVATE'}})]){
  for(const type of ['text/plain','text/html','application/json']){
   const result=await read(chunk(body,';private="SYNTHETIC_PRIVATE"','X-Fixture: UnauthorizedRegistration\r\n'),[`Content-Type: ${type}`,'Transfer-Encoding: chunked'])
   assert.deepEqual(result,{providerBodyStatus:'unknown_format'})
   assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE'),false)
  }
 }
})

test('initial buffered chunks, exact limits and the 300 ms deadline remain enforced',async t=>{
 assert.deepEqual(await readProviderDiagnostic({read:async()=>null},Buffer.from(chunk(phrase,';fixture=yes','X-Fixture: ignored\r\n')),headers),recognized)
 assert.deepEqual(await read(chunk('x'.repeat(1024)),headers),{providerBodyStatus:'unknown_format'})
 t.mock.timers.enable({apis:['setTimeout']})
 const pending=readProviderDiagnostic({read:async()=>new Promise(()=>{})},Buffer.from('0\r\nX-Fixture: pending'),headers)
 t.mock.timers.tick(300)
 assert.deepEqual(await pending,{providerBodyStatus:'timeout'})
})
