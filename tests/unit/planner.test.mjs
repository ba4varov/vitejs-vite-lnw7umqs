import test from 'node:test'
import assert from 'node:assert/strict'
import {calculatePlanner,localHourEpoch,validatePlannerInput} from '../../server/planner-logic.js'
import {handlePlanner} from '../../server/planner-core.js'
const now=Date.parse('2026-10-09T00:00Z')
const body=(overrides={})=>({activity:'walk',timeZone:'Europe/Sofia',hours:Array.from({length:72},(_,i)=>({time:new Date(now+i*3600000).toISOString().slice(0,16),feelsLike:20,rainProbability:10,rain:0,wind:5,code:1})),...overrides})
const env={SUPABASE_URL:'https://auth.example.invalid',SUPABASE_ANON_KEY:'anon',SUPABASE_SERVICE_ROLE_KEY:'MUST_NOT_USE'}
const run=async({input=body(),authorization='Bearer test-session',method='POST',plan='pro',permissions=['planner:advanced'],auth=true,rpc=200,fail=false,headers={}}={})=>{
 const calls=[], res={code:0,payload:null,headers:{},setHeader(k,v){this.headers[k]=v},status(c){this.code=c;return this},json(p){this.payload=p;return this}}
 await handlePlanner({method,body:input,headers:{authorization,...headers}},res,env,async(url,options)=>{
  calls.push({url,options});if(fail)throw Error('offline')
  return url.endsWith('/user')?{ok:auth,json:async()=>({id:'isolated-user'})}:{ok:rpc===200,status:rpc,json:async()=>[{plan,permissions}]}
 },now)
 return {...res,calls}
}
test('deterministic, bounded, nonoverlapping two-hour windows for all activities',()=>{
 for(const activity of ['walk','garden','sport']) {
  const a=calculatePlanner(body({activity}),now)
  assert.deepEqual(a,calculatePlanner(body({activity}),now));assert.equal(a.status,'ok');assert.equal(a.windows.length,3)
  a.windows.forEach((w,i)=>{assert.ok(w.start>=now && w.end<=now+72*3600000);assert.equal(w.end-w.start,2*3600000);if(i)assert.ok(w.start>=a.windows[i-1].end)})
 }
})
test('bad weather, missing values, gaps, stale data and absent data cannot fabricate windows',()=>{
 for(const bad of [{code:95},{rainProbability:99},{rain:12},{wind:90},{feelsLike:50}]) {
  assert.equal(calculatePlanner(body({hours:body().hours.map(h=>({...h,...bad}))}),now).status,'unsuitable')
 }
 for(const hours of [[],body().hours.map(h=>({...h,wind:null})),[body().hours[10]],body().hours.filter((_,i)=>i%2===0)]) assert.equal(calculatePlanner(body({hours}),now).windows.length,0)
 assert.equal(calculatePlanner(body(),now+100*3600000).status,'insufficient')
})
test('city time zones, fractional offsets, date changes and DST gaps/folds',()=>{
 assert.equal(localHourEpoch('2026-10-09T08:00','Europe/Sofia'),Date.parse('2026-10-09T05:00Z'))
 assert.equal(localHourEpoch('2026-10-09T08:00','Asia/Kathmandu'),Date.parse('2026-10-09T02:15Z'))
 assert.equal(localHourEpoch('2026-10-09T00:00','Pacific/Kiritimati'),Date.parse('2026-10-08T10:00Z'))
 assert.equal(localHourEpoch('2026-03-08T02:00','America/New_York'),null)
 assert.equal(localHourEpoch('2026-11-01T01:00','America/New_York'),null)
 assert.equal(localHourEpoch('2026-10-25T03:00','Europe/Sofia'),null)
})
test('strict input schema, sizes, calendar dates and finite ranges',()=>{
 for(const input of [null,[],{},body({activity:'__proto__'}),body({timeZone:'bad/zone'}),body({plan:'pro'}),body({url:'https://attacker.invalid'}),body({hours:Array(73).fill(body().hours[0])}),body({hours:[{...body().hours[0],time:'2026-02-30T08:00'}]}),body({hours:[{...body().hours[0],wind:Infinity}]}),body({hours:[{...body().hours[0],rain:-1}]}),body({hours:[{...body().hours[0],code:4}]}),body({hours:[{...body().hours[0],wind:undefined}]}),body({hours:[body().hours[1],body().hours[0]]})]) assert.equal(validatePlannerInput(input),false)
 assert.equal(validatePlannerInput(body()),true)
})
test('guests, invalid, expired and forged JWTs never reach entitlement RPC',async()=>{
 assert.equal((await run({authorization:''})).code,401)
 for(const authorization of ['invalid','Bearer expired','Bearer forged']) {
  const r=await run({authorization,auth:false});assert.equal(r.code,401);assert.ok(r.calls.length<=1)
 }
})
test('Free and missing migration deny access; forged browser plan cannot bypass',async()=>{
 for(const options of [{plan:'free'},{permissions:['future:premium']},{plan:'free',permissions:['planner:advanced']},{permissions:[]}]) assert.equal((await run(options)).code,403)
 assert.equal((await run({plan:'free',input:body({plan:'pro',permissions:['planner:advanced']})})).code,403)
 assert.equal((await run({rpc:404})).code,503)
})
test('Pro revoke takes effect on next request using the same session token',async()=>{
 assert.equal((await run()).code,200)
 assert.equal((await run({plan:'free',permissions:[]})).code,403)
})
test('verified user JWT and anon key only; no external weather calls or storage',async()=>{
 const r=await run();assert.equal(r.code,200);assert.equal(r.calls.length,2)
 assert.equal(r.headers['Cache-Control'],'private, no-store')
 for(const call of r.calls){assert.equal(call.options.headers.apikey,'anon');assert.equal(call.options.headers.Authorization,'Bearer test-session');assert.ok(call.options.signal)}
 assert.equal(r.calls[1].url,'https://auth.example.invalid/rest/v1/rpc/get_my_entitlements')
 assert.equal(r.calls[1].options.body,'{}');assert.equal(r.payload.source,'client-supplied-forecast')
})
test('validation, failures, unsupported method and payload limits',async()=>{
 assert.equal((await run({input:body({activity:'swim'})})).code,400)
 assert.equal((await run({headers:{'content-length':'25000'}})).code,413)
 assert.equal((await run({fail:true})).code,503)
 assert.equal((await run({method:'GET'})).code,405)
 assert.equal((await run({rpc:401})).code,401)
})
