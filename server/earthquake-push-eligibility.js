// Preview-only logic for future earthquake Push. No provider, scheduler,
// service credentials or side effects. The existing push_deliveries table is
// the durable unique (device_id,event_key) gate for a later reviewed worker.
import {
  distanceKm,earthquakeDedupKey,EARTHQUAKE_DEFAULTS,
  EARTHQUAKE_PUSH_DELIVERY_ENABLED,
  EARTHQUAKE_FRESH_PUSH_AGE_MS
} from './earthquakes-core.js'

export function inspectEarthquakeDeliveryCandidate(event,consent,device,alreadySent=new Set(),now=Date.now()) {
  if(!event||!consent||!device||!consent.enabled||!consent.city||
    !consent.userId||consent.userId!==device.userId||
    typeof device.id!=='string'||!device.id||
    !Number.isFinite(event.time)||event.time>now||now-event.time>EARTHQUAKE_FRESH_PUSH_AGE_MS||
    !Number.isFinite(event.magnitude)||event.magnitude<EARTHQUAKE_DEFAULTS.minMagnitude ||
    !Number.isFinite(consent.optedInAt)||event.time<consent.optedInAt ||
    (Number.isFinite(device.expiresAt)&&device.expiresAt<=now) ||
    device.revoked===true)return null
  const key=earthquakeDedupKey(event)
  const location={lat:consent.city.latitude,lon:consent.city.longitude}
  const distance=distanceKm(location,event)
  if(!key||distance===null||distance>EARTHQUAKE_DEFAULTS.radiusKm||
    alreadySent.has(`${device.id}:${key}`))return null
  return Object.freeze({
    deviceId:device.id,
    userId:consent.userId,
    eventKey:key,
    occurredAt:event.time,
    magnitude:event.magnitude,
    distanceKm:Math.round(distance),
    // Only a preview: the message will be rendered after re-authorization,
    // never sent by this module.
    source:'USGS',
  })
}

export function prepareEarthquakeDeliveryPreview(events,consents,devices,alreadySent=new Set(),now=Date.now()) {
  if(!Array.isArray(events)||!Array.isArray(consents)||!Array.isArray(devices))return []
  const result=[]
  const seen=new Set()
  for(const consent of consents)for(const device of devices){
    for(const event of events){
      const candidate=inspectEarthquakeDeliveryCandidate(event,consent,device,alreadySent,now)
      if(!candidate)continue
      const compound=`${candidate.deviceId}:${candidate.eventKey}`
      if(seen.has(compound))continue
      seen.add(compound);result.push(candidate)
      if(result.length>=100)return result
    }
  }
  return result
}

// Explicit safety gate. This function is deliberately inert until a separate
// PR adds a durable atomic reservation + consent re-check + one-shot transport.
export function earthquakeDeliveryEnabled() {
  return EARTHQUAKE_PUSH_DELIVERY_ENABLED === true
}
