const activities = {
  walk: { min: 5, max: 30, wind: 25, probability: 30, rain: 0.2 },
  garden: { min: 8, max: 28, wind: 20, probability: 20, rain: 0.1 },
  sport: { min: 8, max: 25, wind: 20, probability: 20, rain: 0.1 },
}
const codes = new Set([0,1,2,3,45,48,51,53,55,56,57,61,63,65,66,67,71,73,75,77,80,81,82,85,86,95,96,99])
const keys = ['time','feelsLike','rainProbability','rain','wind','code']
const object = value => value && typeof value === 'object' && !Array.isArray(value)
const exact = (value, allowed) => object(value) && Object.keys(value).every(key => allowed.includes(key))
const range = (value, min, max) => value === null || (typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max)

export function validatePlannerInput(body) {
  if (!exact(body, ['activity','timeZone','hours']) || !Object.hasOwn(activities, body.activity) || typeof body.timeZone !== 'string' || body.timeZone.length > 64 || !Array.isArray(body.hours) || body.hours.length > 72) return false
  try { new Intl.DateTimeFormat('en-CA', {timeZone:body.timeZone}).format(0) } catch { return false }
  let previous = ''
  for (const h of body.hours) {
    if (!exact(h, keys) || !keys.every(k => Object.hasOwn(h,k)) || typeof h.time !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:00$/.test(h.time) || h.time <= previous) return false
    const date = Date.parse(h.time+'Z')
    if (!Number.isFinite(date) || new Date(date).toISOString().slice(0,16) !== h.time || !range(h.feelsLike,-100,70) || !range(h.rainProbability,0,100) || !range(h.rain,0,500) || !range(h.wind,0,400) || (h.code !== null && !codes.has(h.code))) return false
    previous=h.time
  }
  return true
}

const localParts = (formatter, epoch) => {
  const parts=Object.fromEntries(formatter.formatToParts(epoch).map(p=>[p.type,p.value]))
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`
}

// Open-Meteo's existing response uses wall-clock strings. Resolve against the
// city's IANA zone, never the browser zone or a fixed offset. DST folds/gaps are
// ambiguous in that source format and are conservatively omitted.
export function localHourEpoch(time, timeZone) {
  const formatter=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'})
  const nominal=Date.parse(time+'Z'), offsets=new Set()
  for (const delta of [-36,-12,0,12,36]) {
    const instant=nominal+delta*3600000
    offsets.add(Date.parse(localParts(formatter,instant)+'Z')-instant)
  }
  const candidates=[...offsets].map(offset=>nominal-offset).filter(epoch=>localParts(formatter,epoch)===time)
  return candidates.length===1?candidates[0]:null
}

export function calculatePlanner(body, now) {
  if (!validatePlannerInput(body) || !Number.isFinite(now)) throw new TypeError('INVALID_INPUT')
  const limits=activities[body.activity], horizon=now+72*3600000
  const hours=body.hours.map(h=>({...h,epoch:localHourEpoch(h.time,body.timeZone)})).filter(h=>h.epoch!==null && h.epoch>=now && h.epoch+3600000<=horizon)
  const complete=h=>keys.slice(1).every(k=>h[k]!==null)
  const suitable=h=>complete(h) && Number(h.time.slice(11,13))>=7 && Number(h.time.slice(11,13))<20 && h.code<=3 && h.feelsLike>=limits.min && h.feelsLike<=limits.max && h.wind<=limits.wind && h.rainProbability<=limits.probability && h.rain<=limits.rain
  const candidates=[]
  for(let i=0;i<hours.length-1;i++) {
    const a=hours[i],b=hours[i+1]
    if(b.epoch-a.epoch!==3600000 || !suitable(a) || !suitable(b)) continue
    const pair=[a,b]
    candidates.push({start:a.epoch,end:b.epoch+3600000,feelsLikeMin:Math.min(a.feelsLike,b.feelsLike),feelsLikeMax:Math.max(a.feelsLike,b.feelsLike),rainProbability:Math.max(a.rainProbability,b.rainProbability),rain:Math.max(a.rain,b.rain),wind:Math.max(a.wind,b.wind),score:pair.reduce((score,h)=>score+Math.abs(h.feelsLike-20)+h.wind/5+h.rainProbability/5+h.rain*10,0)})
  }
  candidates.sort((a,b)=>a.score-b.score || a.start-b.start)
  const windows=[]
  for(const candidate of candidates) {
    if(windows.every(w=>candidate.start>=w.end || candidate.end<=w.start)) {const {score:_score,...window}=candidate;windows.push(window)}
    if(windows.length===3) break
  }
  windows.sort((a,b)=>a.start-b.start)
  return {status:windows.length?'ok':hours.filter(complete).length<2 || hours.some(h=>!complete(h))?'insufficient':'unsuitable',timeZone:body.timeZone,windows,source:'client-supplied-forecast'}
}
