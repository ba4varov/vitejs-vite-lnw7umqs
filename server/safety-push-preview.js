// Dry-run-only planning for the future unified safety Push dispatcher.
// Nothing in this module sends notifications, reserves DB rows, reads private
// credentials, schedules jobs, or enables a provider. Production stays off.
import {createHash} from 'node:crypto'
import {evaluatePushForecast} from './push-forecast.js'
import {validPushPreferences} from './push-validation.js'
import {riskKinds,localAlertDate} from './alerts-logic.js'
import {prepareEarthquakeDeliveryPreview} from './earthquake-push-eligibility.js'
import {EARTHQUAKE_PUSH_DELIVERY_ENABLED} from './earthquakes-core.js'

// Weather opt-in is the existing per-user push_preferences.enabled + saved
// cities + selected risk categories. Earthquake opt-in remains separate.
export const WEATHER_PUSH_DELIVERY_ENABLED=false
export const WEATHER_PUSH_LEAD_MS=24*60*60*1000
const MAX_PREVIEW=100

const cityMatches=(a,b)=>a?.latitude===b?.latitude&&
  a?.longitude===b?.longitude&&a?.zone===b?.zone

export function weatherPushKey(city,kind,start) {
  if(!city||!riskKinds.includes(kind)||!Number.isFinite(start)||
    !Number.isFinite(city.latitude)||!Number.isFinite(city.longitude)||
    typeof city.zone!=='string')return null
  try {
    const day=localAlertDate(start,city.zone)
    const cityId=createHash('sha256')
      .update(JSON.stringify([city.latitude,city.longitude,city.zone]))
      .digest('hex').slice(0,32)
    // Stable across forecast refreshes. Max one per device, risk, city and
    // local calendar day; distinct hazards and cities remain distinct.
    return `weather:open-meteo:${cityId}:${kind}:${day}`
  }catch{return null}
}

export function prepareWeatherSafetyPushPreview(
  snapshot,preferences,entitlement,userId,devices,
  alreadySent=new Set(),now=Date.now()
) {
  if(typeof userId!=='string'||!userId||!Array.isArray(devices)||
    !(alreadySent instanceof Set)||!Number.isFinite(now)||
    !validPushPreferences(preferences)||!preferences.enabled||
    !snapshot?.city||!preferences.cities.some(c=>cityMatches(c,snapshot.city)))
    return []
  let risks
  try{risks=evaluatePushForecast(snapshot,preferences,entitlement,now)}
  catch{return []} // Invalid or stale forecast is NOT an all-clear or a Push.
  const selected=preferences.cities.find(c=>cityMatches(c,snapshot.city))
  const result=[],planned=new Set()
  for(const risk of risks) {
    if(!riskKinds.includes(risk?.kind)||!preferences.categories.includes(risk.kind)||
      !Number.isFinite(risk.start)||!Number.isFinite(risk.end)||
      risk.end<=now||risk.start>now+WEATHER_PUSH_LEAD_MS||
      risk.start<now-60*60*1000)continue
    const key=weatherPushKey(selected,risk.kind,risk.start)
    if(!key)continue
    for(const device of devices) {
      if(!device||device.userId!==userId||
        typeof device.id!=='string'||!device.id||
        device.revoked===true||
        (Number.isFinite(device.expiresAt)&&device.expiresAt<=now))continue
      const compound=`${device.id}:${key}`
      if(alreadySent.has(compound)||planned.has(compound))continue
      planned.add(compound)
      result.push(Object.freeze({
        channel:'weather',source:'Open-Meteo forecast',
        sourceType:'forecast-not-official-warning',
        eventKey:key,userId,deviceId:device.id,
        cityName:selected.name,riskKind:risk.kind,
        startsAt:risk.start,endsAt:risk.end,
        // Neither the candidate nor its label asserts a NIMH code.
        predicted:true,
      }))
      if(result.length>=MAX_PREVIEW)return result
    }
  }
  return result
}

export function prepareUnifiedSafetyPushPreview({
  weatherBatches=[],earthquakeEvents=[],earthquakeConsents=[],devices=[],
  alreadySent=new Set(),now=Date.now()
}={}) {
  if(!Array.isArray(weatherBatches)||!Array.isArray(earthquakeEvents)||
    !Array.isArray(earthquakeConsents)||!Array.isArray(devices)||
    !(alreadySent instanceof Set)||!Number.isFinite(now))return []
  const earthquake=prepareEarthquakeDeliveryPreview(
    earthquakeEvents,earthquakeConsents,devices,alreadySent,now
  ).map(item=>Object.freeze({...item,channel:'earthquake',
    sourceType:'recorded-event-not-early-warning'}))
  const weather=weatherBatches.flatMap(batch=>prepareWeatherSafetyPushPreview(
    batch?.snapshot,batch?.preferences,batch?.entitlement,batch?.userId,
    devices,alreadySent,now
  ))
  const keys=new Set(),output=[]
  for(const candidate of [...earthquake,...weather]){
    const compound=`${candidate.deviceId}:${candidate.eventKey}`
    if(keys.has(compound))continue
    keys.add(compound)
    output.push(candidate)
    if(output.length>=MAX_PREVIEW)break
  }
  return output
}

// This is NOT a Vercel environment toggle. A separate audited, authenticated
// server worker with DB claim/burn transactions is required before enabling.
export function safetyPushDeliveryEnabled() {
  return WEATHER_PUSH_DELIVERY_ENABLED===true &&
    EARTHQUAKE_PUSH_DELIVERY_ENABLED===true
}
