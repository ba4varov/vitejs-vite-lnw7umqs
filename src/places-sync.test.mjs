import test from 'node:test'
import assert from 'node:assert/strict'
import { placesRequest, placesSnapshot, PlacesSyncError, reportPlacesFailure, placesErrorText, placesFailure } from './places-sync.js'
const session = { user: { id: 'account' }, access_token: 'private-token' }
const row = { id: 'place', name: 'Sofia', latitude: 42.7, longitude: 23.3 }
const response = (data, status = 200) => ({ status, ok: status < 400, json: async () => data })
const request = (extra = {}) => placesRequest({ base: 'https://test.invalid', anon: 'anon', session, path: 'favorite_places?select=id', accountSession: async () => session, fetcher: async () => response([row]), ...extra })
test('valid snapshots preserve favorites, identity and default; empty is valid', () => {
  assert.equal(placesSnapshot([row], [{ default_place_id: 'place' }]).defaultPlaceId, 'place')
  assert.deepEqual(placesSnapshot([], []), { places: [], defaultPlaceId: null })
  assert.equal(placesSnapshot([row], []).places[0].id, 'place')
})
for (const rows of [null, {}, [{ ...row, latitude: null }], [{ ...row, name: '' }], [{ name: 'Sofia', latitude: 42, longitude: 23 }]]) test(`reject incomplete favorites ${JSON.stringify(rows)}`, () => {
  assert.throws(() => placesSnapshot(rows, []), e => e.diagnostic.source === 'favorite_places' && e.diagnostic.category === 'response')
})
for (const settings of [null, {}, [{}], [{ default_place_id: '' }], [{ default_place_id: 42 }], [{default_place_id:null},{default_place_id:null}]]) test(`reject incomplete settings ${JSON.stringify(settings)}`, () => {
  assert.throws(() => placesSnapshot([row], settings), e => e.diagnostic.source === 'place_settings')
})
for (const source of ['favorite_places', 'place_settings']) for (const [status, code, category] of [[401,'PGRST301','session'],[403,'42501','permission'],[404,'PGRST205','schema'],[400,'42703','schema'],[400,'PGRST204','schema'],[406,'PGRST116','response'],[503,null,'server'],[409,'private-value','request']]) test(`${source} ${status} ${code}`, async () => {
  await assert.rejects(request({ path: source, fetcher: async () => response({ code, message: 'secret email token' }, status), accountSession: async (_id, rejected) => rejected ? null : session }), e => e.diagnostic.source === source && e.diagnostic.category === category && !JSON.stringify(e).includes('secret'))
})
test('one 401 retry uses refreshed token; second 401 fails', async () => {
  const tokens = []
  const refresh = async (_id, rejected) => rejected ? {...session, access_token:'new'} : session
  await request({accountSession:refresh,fetcher:async (_url, init) => { tokens.push(init.headers.Authorization); return response([], tokens.length === 1 ? 401 : 200) }})
  assert.deepEqual(tokens,['Bearer private-token','Bearer new'])
  let calls = 0
  await assert.rejects(request({accountSession:refresh,fetcher:async () => { calls++; return response({},401) }}), e => e.diagnostic.category === 'session')
  assert.equal(calls,2)
})
test('writes do not retry; session mismatch makes no REST call', async () => {
  let calls=0
  await assert.rejects(request({init:{method:'POST'},fetcher:async()=>{calls++;return response({},401)}}))
  assert.equal(calls,1)
  await assert.rejects(request({accountSession:async()=>null,fetcher:async()=>{calls++}}))
  assert.equal(calls,1)
})
for (const [name,category] of [['TypeError','network'],['TimeoutError','timeout']]) test(`${name} safely categorized`,async()=>{
  await assert.rejects(request({fetcher:async()=>{const e=new Error('sensitive');e.name=name;throw e}}),e=>e.diagnostic.category===category)
})
test('invalid JSON is not an empty list; void RPC remains valid', async()=>{
  await assert.rejects(request({fetcher:async()=>({ok:true,status:200,json:async()=>{throw new Error('private')}})}),e=>e.diagnostic.category==='response')
  assert.equal(await request({path:'rpc/set_my_default_place',init:{method:'POST'},fetcher:async()=>response(null,204)}),null)
})
test('diagnostics contain only safe fields and BG/EN retain the error', t=>{
  const log=t.mock.method(console,'warn',()=>{})
  reportPlacesFailure(new PlacesSyncError('favorite_places','schema',400,'42703'))
  assert.equal(placesFailure(new Error('private email token')), 'unknown')
  assert.deepEqual(log.mock.calls[0].arguments,['places_sync',{source:'favorite_places',category:'schema',status:400,code:'42703'}])
  assert.ok(!JSON.stringify(log.mock.calls).includes('private'))
  for(const category of ['session','permission','schema','configuration','network','timeout','response','server','unknown']) {
    assert.match(placesErrorText(category,'bg'),/Местата не можаха/)
    assert.match(placesErrorText(category,'en'),/Places could not/)
  }
})
