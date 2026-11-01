import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeRain } from '../../src/rain-warning.js'
const start = Date.parse('2026-01-01T12:00Z')
const make = (values, zone = 'UTC', epoch = start) => ({ timeZone: zone, hours: values.map((rain, i) => {
 const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(epoch+i*3600000).map(p=>[p.type,p.value]))
 return {rain,time:`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`}
}) })
test('48.5 mm with hourly maximum 4.7 crosses midnight', () => {
 const values = [4.7,...Array(22).fill(1.9),2]
 const result = analyzeRain(make(values),start)
 assert.ok(Math.abs(result.warning.amount-48.5)<1e-9)
 assert.equal(result.warning.duration,24)
 assert.equal(result.warning.level,2)
})
test('below all thresholds',()=>assert.equal(analyzeRain(make(Array(72).fill(.1)),start).warning,null))
for(const [duration,amount,level] of [[24,15,1],[24,35,2],[24,65,3],[6,20,2],[1,10,2]]) test(`exact threshold ${duration}/${amount}`,()=>{
 const values=Array(duration).fill(0); values[0]=amount/duration
 for(let i=1;i<duration;i++)values[i]=amount/duration
 const warning=analyzeRain(make(values),start).warning
 assert.equal(warning.level,level);assert.equal(warning.duration,duration)
})
test('finds later sliding maximum within 72 hours',()=>{
 const result=analyzeRain(make([...Array(30).fill(0),...Array(24).fill(2),...Array(18).fill(0)]),start)
 assert.equal(result.warning.start,start+30*3600000);assert.equal(result.warning.amount,48)
})
for(const zone of ['Europe/Sofia','America/New_York','Asia/Kolkata'])test(`local time ${zone}`,()=>{const epoch=zone==='Asia/Kolkata'?start-1800000:start;assert.equal(analyzeRain(make(Array(24).fill(2),zone,epoch),epoch).warning.amount,48)})
for(const epoch of [Date.parse('2026-03-28T18:00Z'),Date.parse('2026-10-24T18:00Z')])test(`DST ${epoch}`,()=>{
 const result=analyzeRain(make(Array(24).fill(2),'Europe/Sofia',epoch),epoch)
 // Spring skips a wall hour but remains continuous; autumn ambiguous fold is omitted.
 assert.equal(result.warning?.duration,epoch===Date.parse('2026-03-28T18:00Z')?24:undefined)
})
for(const invalid of [null,undefined,NaN,Infinity,-1,'2'])test(`invalid rain ${invalid}`,()=>{
 const values=Array(24).fill(1);values[12]=invalid
 assert.equal(analyzeRain(make(values),start).warning,null)
})
test('missing and duplicate hours invalidate windows',()=>{
 for(const mutate of [h=>h.splice(12,1),h=>h[12].time=h[11].time]){
 const forecast=make(Array(24).fill(1));mutate(forecast.hours)
 assert.equal(analyzeRain(forecast,start).warning,null)
 }
})
test('partially elapsed hour is excluded',()=>{
 const forecast=make([10,...Array(24).fill(.1)])
 assert.equal(analyzeRain(forecast,start+1).warning,null)
 assert.equal(analyzeRain(forecast,start).warning.duration,1)
})
test('overlapping risks yield one deterministic warning on refresh',()=>{
 const forecast=make(Array(72).fill(4))
 const result=analyzeRain(forecast,start)
 assert.equal(result.warning.duration,24)
 assert.deepEqual(analyzeRain(forecast,start),result)
})
