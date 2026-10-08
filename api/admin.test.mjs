import test from 'node:test'
import assert from 'node:assert/strict'
import { handleAdmin } from './admin-core.js'
const env = { SUPABASE_URL: 'https://test.invalid', SUPABASE_ANON_KEY: 'anon' }
async function run({ token = 'Bearer valid', authorized = true, valid = true, query = {}, method = 'GET', failure = 0 } = {}) {
  const calls = []
  const res = { headers: {}, setHeader(k,v) { this.headers[k]=v }, status(code) { this.code=code; return this }, json(body) { this.body=body; return this } }
  const fetcher = async (url, options) => {
    calls.push({ url, options })
    if (url.endsWith('/user')) return { ok: valid, json: async () => ({ id:'owner-id', email:'owner@example.invalid' }) }
    if (url.endsWith('is_meteo_admin')) return { ok:true, json:async () => authorized }
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
