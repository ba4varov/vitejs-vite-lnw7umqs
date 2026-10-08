import test from 'node:test'
import assert from 'node:assert/strict'
import { handleAdmin } from '../../server/admin-core.js'
const env = { SUPABASE_URL: 'https://test.invalid', SUPABASE_ANON_KEY: 'anon' }
async function run({ token = 'Bearer valid', authorized = true, valid = true, query = {}, method = 'GET', failure = 0, membershipFailure = 0, temperature = 17, openMeteoFailure = false } = {}) {
  const calls = []
  const res = { headers: {}, setHeader(k,v) { this.headers[k]=v }, status(code) { this.code=code; return this }, json(body) { this.body=body; return this } }
  let memberships = 0
  const fetcher = async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith('/user')) return { ok: valid, json: async () => ({ id:'owner-id', email:'owner@example.invalid' }) }
    if (url.endsWith('is_meteo_admin')) { memberships++; return { ok:memberships===1 || !membershipFailure,status:membershipFailure,json:async () => authorized } }
    if (url.includes('open-meteo')) { if(openMeteoFailure) throw new Error('timeout or network failure'); return {ok:true,json:async()=>({current:{temperature_2m:temperature}})} }
    return { ok:!failure, status:failure, json:async () => url.endsWith('admin_statistics') ? { total: 42, registrations: [] } : { users:[], total:0 } }
  }
  await handleAdmin({ method, headers: { authorization:token }, query }, res, env, fetcher)
  return { res, calls }
}
test('administrator access uses verified user and no service key', async () => {
  const {res,calls}=await run(); assert.equal(res.code,200); assert.equal(res.body.authorized,true)
  assert.equal(res.headers['Cache-Control'],'private, no-store'); assert.equal(calls[1].options.headers.Authorization,'Bearer valid')
})
test('ordinary user denied before data fetch', async () => { const {res,calls}=await run({authorized:false,query:{action:'stats'}}); assert.equal(res.code,403); assert.equal(calls.length,2) })
test('missing bearer and expired session receive 401', async () => {
  for (const settings of [{token:''},{valid:false}]) { const {res,calls}=await run(settings); assert.equal(res.code,401); assert.ok(calls.length<=1) }
})
test('statistics are returned from database without substitutes', async () => { const {res}=await run({query:{action:'stats'}}); assert.equal(res.body.total,42) })
test('email search and pagination are bound RPC parameters', async () => { const {res,calls}=await run({query:{action:'users',search:'a%_@b',page:'2'}}); assert.equal(res.code,200); assert.deepEqual(JSON.parse(calls[2].options.body),{search_email:'a%_@b',page_number:2,selected_id:null}) })
test('invalid queries and writes denied', async () => {
  for (const query of [{action:'users',page:'0'},{action:'users',page:'1.5'},{action:'users',id:'invalid'},{action:'unknown'}]) assert.equal((await run({query})).res.code,400)
  assert.equal((await run({method:'DELETE'})).res.code,405)
})
test('revoked access and JWT expiration during RPC preserve 403/401',async()=> { for(const failure of [401,403]) assert.equal((await run({failure,query:{action:'stats'}})).res.code,failure) })
test('database failure never produces sample statistics',async()=> { const {res}=await run({failure:500,query:{action:'stats'}}); assert.equal(res.code,503); assert.equal(res.body.total,undefined) })
test('favorites require UUID and verified administrator, forwarding the caller JWT', async () => {
  const id = '00000000-0000-0000-0000-000000000002'
  const {res,calls} = await run({query:{action:'favorites',id}})
  assert.equal(res.code,200)
  assert.ok(calls[2].url.endsWith('/rpc/admin_user_favorites'))
  assert.deepEqual(JSON.parse(calls[2].options.body),{selected_id:id})
  assert.equal(calls[2].options.headers.Authorization,'Bearer valid')
  for (const query of [{action:'favorites'}, {action:'favorites',id:'invalid'}, {action:'favorites',id:['bad']}]) assert.equal((await run({query})).res.code,400)
  assert.equal((await run({authorized:false,query:{action:'favorites',id}})).calls.length,2)
  for (const failure of [401,403]) assert.equal((await run({failure,query:{action:'favorites',id}})).res.code,failure)
})
test('system probes report separate failures without fabricating availability', async () => {
  const {res,calls} = await run({query:{action:'system'},failure:500,openMeteoFailure:true})
  assert.equal(res.code,200)
  assert.deepEqual(res.body.checks.map(check=>check.available),[true,false,false])
  for (const check of res.body.checks) {
    assert.ok(check.responseMs>=0); assert.ok(Number.isFinite(Date.parse(check.checkedAt)))
    assert.equal(check.problem,check.available?null:'CHECK_FAILED')
  }
  assert.equal(calls.filter(call=>call.url.includes('open-meteo')).length,1)
})
test('system revocation and expiration never return administrative health data', async () => {
  for(const failure of [401,403]) {
    const {res}=await run({query:{action:'system'},failure})
    assert.equal(res.code,failure); assert.equal(res.body.checks,undefined)
  }
})
test('system success checks actual temperature schema and bounded RPC requests', async () => {
  const {res,calls}=await run({query:{action:'system'}})
  assert.deepEqual(res.body.checks.map(check=>check.available),[true,true,true])
  assert.ok(calls.every(call=>call.options.signal instanceof AbortSignal))
  for(const temperature of [null,'17',undefined]) {
    const {res}=await run({query:{action:'system'},temperature:temperature===undefined?'bad':temperature})
    assert.equal(res.body.checks[2].available,false)
  }
})
test('Supabase probe failure is not reported as connected', async () => {
  const {res}=await run({query:{action:'system'},membershipFailure:503})
  assert.equal(res.code,200);assert.equal(res.body.checks[0].available,false)
  for(const membershipFailure of [401,403]) assert.equal((await run({query:{action:'system'},membershipFailure})).res.code,membershipFailure)
})
test('stage 3 parameters are bounded and server constructs RPC payloads', async () => {
  for (const action of ['analytics','audit']) {
    const {res,calls}=await run({query:{action,period:'12m',filter:'user_details_view',page:'2',admin_id:'spoof'}})
    assert.equal(res.code,200)
    assert.deepEqual(JSON.parse(calls[2].options.body),action==='analytics'?{period:'12m'}:{period:'12m',selected_action:'user_details_view',page_number:2})
    for(const query of [{action,period:'365'},{action,period:['7']},{action,page:'0'},{action,page:['1']},{action,filter:'invented'}]) assert.equal((await run({query})).res.code,400)
    assert.equal((await run({query:{action},authorized:false})).calls.length,2)
    for(const failure of [401,403]) assert.equal((await run({query:{action},failure})).res.code,failure)
  }
})
test('missing migration is identified without returning fake data', async () => {
  const res={setHeader(){},status(code){this.code=code;return this},json(body){this.body=body;return this}}
  await handleAdmin({method:'GET',headers:{authorization:'Bearer valid'},query:{action:'analytics'}},res,env,async url=>
    url.endsWith('/user')?{ok:true,json:async()=>({id:'owner'})}:url.endsWith('is_meteo_admin')?{ok:true,json:async()=>true}:{ok:false,status:404,json:async()=>({code:'PGRST202'})})
  assert.equal(res.code,503);assert.equal(res.body.error,'ADMIN_CONFIGURATION_MISSING')
})
