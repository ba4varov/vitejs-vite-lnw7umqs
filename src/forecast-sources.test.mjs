import test from 'node:test'
import assert from 'node:assert/strict'
import { createForecastRequests, enrichForecast } from './forecast-sources.js'
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b }); return { promise, resolve, reject } }
const response = data => ({ ok: true, json: async () => data })
const urls = {weather:'weather',marine:'marine',aqi:'aqi'}
const flush = () => new Promise(resolve => setImmediate(resolve))
function setup() {
 const pending = {}, events = [], signals = []
 const loader = createForecastRequests((url, options) => { signals.push(options.signal); const job = deferred(); (pending[url] ||= []).push(job); return job.promise })
 return { pending, events, signals, loader, start: (current = () => true) => loader.start(urls, current, (source,data) => events.push({source,data})) }
}
test('starts all sources together and main resolves without supplementary completion', async () => {
 const s=setup(), r=s.start(); assert.deepEqual(Object.keys(s.pending),Object.keys(urls))
 s.pending.weather[0].resolve(response({main:true})); assert.deepEqual(await r.main,{main:true}); assert.deepEqual(s.events,[])
 s.pending.aqi[0].resolve(response({current:{european_aqi:0}})); s.pending.marine[0].resolve(response({current:{sea_surface_temperature:0}})); await flush(); assert.equal(s.events.length,2)
})
test('supplementary data can arrive before main', async () => {
 const s=setup(), r=s.start(); s.pending.marine[0].resolve(response({current:{sea_surface_temperature:20}})); await flush(); assert.equal(s.events.length,1)
 s.pending.weather[0].resolve(response({main:true})); await r.main
})
for (const failure of ['http','network','json','incomplete']) test(`supplementary ${failure} failure is handled without blocking main`,async()=>{
 const s=setup(), r=s.start()
 for(const source of ['marine','aqi']) {
  const job=s.pending[source][0]
  if(failure==='network')job.reject(new Error('offline'))
  else job.resolve(failure==='http'?{ok:false}:failure==='json'?{ok:true,json:async()=>{throw new Error('bad JSON')}}:response({current:{}}))
 }
 s.pending.weather[0].resolve(response({main:true})); await r.main; await flush(); assert.deepEqual(s.events,[{source:'marine',data:null},{source:'aqi',data:null}])
})
test('new generation discards old supplemental JSON and main even when fetch ignores abort', async()=>{
 const s=setup(), old=s.start(), parsed=deferred()
 s.pending.marine[0].resolve({ok:true,json:()=>parsed.promise}); await flush()
 const next=s.start(); assert.equal(s.signals[0].aborted,true); assert.equal(old.current(),false)
 parsed.resolve({current:{sea_surface_temperature:99}}); s.pending.aqi[0].resolve(response({current:{european_aqi:99}})); s.pending.weather[0].resolve(response({old:true})); await old.main; await flush(); assert.deepEqual(s.events,[])
 s.pending.weather[1].resolve(response({new:true})); await next.main; assert.equal(next.current(),true)
})
test('location changes invalidate responses before another request starts; cancel invalidates everything',async()=>{
 const s=setup();let current=true;const r=s.start(()=>current);current=false
 s.pending.aqi[0].resolve(response({current:{european_aqi:10}})); await flush();assert.deepEqual(s.events,[]);assert.equal(r.current(),false)
 s.loader.cancel();assert.equal(s.signals[0].aborted,true);s.pending.weather[0].resolve(response({}));await r.main
})
test('main failure rejects independently; retry succeeds', async()=>{
 const s=setup(), first=s.start();s.pending.weather[0].reject(new Error('offline'));await assert.rejects(first.main,/offline/)
 const retry=s.start();s.pending.weather[1].resolve(response({ok:true}));assert.deepEqual(await retry.main,{ok:true})
})
test('enrichment uses timestamp joins and original day hours, preserves zero/null and precision',()=>{
 const times=['2026-10-14T01:00','2026-10-14T02:00','2026-10-14T03:00']
 const sources={marine:{current:{sea_surface_temperature:0},hourly:{time:[times[1],times[0],'2026-10-15T01:00'],sea_surface_temperature:[22.4,0,99]}},aqi:{current:{european_aqi:0,pm10:0,pm2_5:1.25},hourly:{time:[times[2],times[0]],european_aqi:[null,0]}}}
 const main={temp:18}, hours=times.map(time=>({time,temp:18})), days=[{dateStr:'2026-10-14',seaTimes:times},{dateStr:'2026-10-16',seaTimes:['2026-10-16T01:00']}]
 const result=enrichForecast(main,hours,days,sources)
 assert.equal(result.weather.seaTemp,0);assert.equal(result.weather.aqi,0);assert.equal(result.weather.pm10,0);assert.equal(result.weather.pm25,1.25)
 assert.deepEqual(result.hourly.map(h=>h.seaTemp),[0,22,null]);assert.deepEqual(result.hourly.map(h=>h.aqi),[0,null,null]);assert.deepEqual(result.daily.map(d=>d.seaTemp),[11,null]);assert.deepEqual(main,{temp:18})
 const empty=enrichForecast(main,hours,days,null);assert.equal(empty.weather.aqi,null);assert.equal(empty.weather.seaTemp,null)
})
