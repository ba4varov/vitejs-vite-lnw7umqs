import test from 'node:test'
import assert from 'node:assert/strict'
import {forecastRisks,activityAlerts,alertKey} from '../../server/alerts-logic.js'
import {calculatePlanner} from '../../server/planner-logic.js'
import {handleAlerts,validAlertScope} from '../../server/alerts-core.js'
const now=Date.parse('2026-10-09T00:00Z')
const forecast=(extra={})=>({timeZone:'UTC',hours:Array.from({length:72},(_,i)=>({time:new Date(now+i*3600000).toISOString().slice(0,16),feelsLike:20,rainProbability:0,rain:0,wind:10,code:0,...extra}))})
test('all five conservative risks, bounded periods and evidence; no official codes',()=>{
 for(const [extra,kind,value] of [[{rain:10},'rain',10],[{code:95},'storm',95],[{wind:60},'wind',60],[{feelsLike:-15},'cold',-15],[{feelsLike:40},'heat',40]]) {
 const risks=forecastRisks(forecast(extra),now);assert.equal(risks.length,1);assert.equal(risks[0].kind,kind);assert.equal(risks[0].min,value);assert.equal(risks[0].end-now,72*3600000)
 }
 assert.equal(forecastRisks(forecast({rain:9.99,wind:59.99,feelsLike:39.99}),now).length,0)
})
test('missing, invalid, incomplete and stale data cannot fabricate risk',()=>{
 for(const value of [null,{},forecast({rain:NaN}),forecast({wind:Infinity}),forecast({code:4}),forecast({feelsLike:null,wind:null,rain:null,code:null})])assert.deepEqual(forecastRisks(value,now),[])
 assert.deepEqual(forecastRisks(forecast({wind:60}),now+100*3600000),[])
})
test('city zone, midnight, DST ambiguity; repeated refresh keys stable',()=>{
 const f={timeZone:'Europe/Sofia',hours:[{time:'2026-10-09T00:00',feelsLike:null,rainProbability:null,rain:12,wind:null,code:null}]}
 const a=forecastRisks(f,now-4*3600000)[0];assert.equal(a.start,Date.parse('2026-10-08T21:00Z'))
 assert.equal(alertKey('Sofia',f.timeZone,a),alertKey('Sofia',f.timeZone,forecastRisks(f,now-3.75*3600000)[0]))
 assert.notEqual(alertKey('Sofia',f.timeZone,a),alertKey('Varna',f.timeZone,a))
 const ambiguous={...f,hours:[{...f.hours[0],time:'2026-10-25T03:00'}]};assert.deepEqual(forecastRisks(ambiguous,Date.parse('2026-10-24')),[])
})
test('personal activity events use exactly the existing planner windows',()=>{
 for(const activity of ['walk','garden','sport'])assert.deepEqual(activityAlerts(forecast(),[activity],now),calculatePlanner({...forecast(),activity},now).windows.map(w=>({kind:activity,...w})))
 assert.deepEqual(activityAlerts(forecast(),[],now),[])
})
const env={SUPABASE_URL:'https://isolated.invalid',SUPABASE_ANON_KEY:'anon'}
async function run(method='GET',body,auth=true,rpc=true,query={},contractVersion=2) {
 const calls=[],res={code:0,setHeader(){},status(code){this.code=code;return this},json(data){this.data=data;return this}}
 await handleAlerts({method,body,query,headers:{authorization:'Bearer isolated'}},res,env,async(url,opts)=>{calls.push([url,opts]);return {ok:url.endsWith('/user')?auth:rpc,status:auth?500:401,json:async()=>url.endsWith('/user')?{id:'owner'}:{contractVersion,pro:false,enabled:['rain'],alerts:[]}}},now)
 return {...res,calls}
}
test('auth failures, database failures and strict payloads fail closed',async()=>{
 assert.equal((await run('GET',undefined,false)).code,401)
 assert.equal((await run('GET',undefined,true,false)).code,503)
 for(const body of [{enabled:['unknown']},{enabled:['walk'],user_id:'victim'},{readKey:'x',hideKey:'x'},{enabled:['rain','rain']}])assert.equal((await run('PATCH',body)).code,400)
 assert.equal((await run('POST',{city:'City',locationKey:'432:279',forecast:forecast({wind:Infinity})})).code,400)
 assert.equal((await run('POST',{city:'City',locationKey:'432:279',forecast:forecast(),user_id:'victim'})).code,400)
 assert.equal((await run('PUT')).code,405)
})
test('Free generation passes own forecast risks only through user JWT; no service role',async()=>{
 const r=await run('POST',{city:'City',locationKey:'432:279',forecast:forecast({rain:10})});assert.equal(r.code,200)
 const rpc=r.calls.at(-1);const payload=JSON.parse(rpc[1].body).payload
 assert.equal(payload.events.length,1);assert.equal(payload.events[0].kind,'rain');assert.equal(payload.user_id,undefined)
 assert.equal(rpc[1].headers.Authorization,'Bearer isolated');assert.equal(rpc[1].headers.apikey,'anon')
})

test('frequent alternating risks do not suppress later cold or heat categories',()=>{
 const f=forecast();f.hours=f.hours.map((h,i)=>({...h,rain:i%2?0:12,wind:i%2?0:65,code:i%2?0:95,feelsLike:i%2?45:-20}))
 const risks=forecastRisks(f,now);assert.equal(risks.length,180);assert.deepEqual([...new Set(risks.map(e=>e.kind))],['rain','storm','wind','cold','heat'])
})

test('scope schema requires both a location and a valid IANA zone',()=>{
 for(const bad of [{locationKey:'432:279'},{zone:'UTC'},{locationKey:['432:279'],zone:'UTC'},{locationKey:'432:279',zone:'invalid'},{locationKey:'432:279',zone:'UTC',user_id:'victim'}])assert.equal(validAlertScope(bad),false)
 assert.equal(validAlertScope({locationKey:'432:279',zone:'Europe/Sofia'}),true)
})
test('load, read, hide and clear are scoped; unscoped load is settings-only',async()=>{
 const scope={locationKey:'432:279',zone:'Europe/Sofia'}
 for(const [method,body,operation] of [['GET',undefined,'load'],['PATCH',{readKey:'event'},'read'],['PATCH',{hideKey:'event'},'hide'],['DELETE',undefined,'clear']]){
  const r=await run(method,body,true,true,scope);assert.equal(r.code,200)
  assert.deepEqual(JSON.parse(r.calls.at(-1)[1].body).payload,{operation,...(body?{key:'event'}:{}),...scope})
 }
 for(const [method,body] of [['DELETE',undefined],['PATCH',{readKey:'event'}],['PATCH',{hideKey:'event'}]])assert.equal((await run(method,body)).code,400)
 assert.equal((await run('GET',undefined,true,true,{locationKey:'432:279'})).code,400)
})
test('old SQL contract cannot perform cross-city writes during deployment',async()=>{
 for(const [method,body,query] of [['DELETE',undefined,{locationKey:'432:279',zone:'UTC'}],['PATCH',{readKey:'event'},{locationKey:'432:279',zone:'UTC'}],['POST',{city:'City',locationKey:'432:279',forecast:forecast()},{}]]){
  const r=await run(method,body,true,true,query,1);assert.equal(r.code,503);assert.equal(r.calls.filter(([url])=>url.includes('/rpc/')).length,1);assert.equal(JSON.parse(r.calls.at(-1)[1].body).payload.operation,'load')
 }
})

test('generation budget denial is a retryable HTTP 429, without an extra write',async()=>{
 const res={code:0,headers:{},setHeader(k,v){this.headers[k]=v},status(code){this.code=code;return this},json(data){this.data=data;return this}}
 let rpc=0
 await handleAlerts({method:'POST',headers:{authorization:'Bearer isolated'},body:{city:'City',locationKey:'432:279',forecast:forecast()}},res,env,async(url)=>{
  if(url.endsWith('/user'))return {ok:true,json:async()=>({id:'owner'})}
  rpc++;return rpc===1?{ok:true,json:async()=>({contractVersion:2,pro:false,enabled:[],alerts:[]})}:{ok:false,status:400,json:async()=>({message:'ALERTS_RATE_LIMITED'})}
 },now)
 assert.equal(res.code,429);assert.equal(res.headers['Retry-After'],'3');assert.equal(rpc,2)
})
