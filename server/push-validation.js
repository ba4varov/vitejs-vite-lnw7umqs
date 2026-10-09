import {alertKinds} from './alerts-logic.js'
export const exactObject=(value,keys)=>value && typeof value==='object' && !Array.isArray(value) && Object.keys(value).every(k=>keys.includes(k))
// Revalidate immediately before any future outbound delivery. Never follow redirects.
export function validPushEndpoint(endpoint) {
 if(typeof endpoint!=='string'||endpoint.length>2048)return false
 try {
  const u=new URL(endpoint)
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash||u.href!==endpoint)return false
  return (u.hostname==='fcm.googleapis.com' && /^\/(fcm\/send|wp)\/[A-Za-z0-9_:-]+$/.test(u.pathname) && !u.search)
   || (u.hostname==='web.push.apple.com' && /^\/[A-Za-z0-9_-]+$/.test(u.pathname) && !u.search)
   || (/^[a-z0-9-]+\.notify\.windows\.com$/.test(u.hostname) && u.pathname==='/w/' && /^\?token=[A-Za-z0-9_%.-]+$/.test(u.search))
   || (u.hostname==='updates.push.services.mozilla.com' && /^\/wpush\/v2\/[A-Za-z0-9_-]+$/.test(u.pathname) && !u.search)
 }catch{return false}
}
export function validPushSubscription(s) {
 if(!exactObject(s,['endpoint','expirationTime','keys'])||!validPushEndpoint(s.endpoint)||!(s.expirationTime===null||s.expirationTime===undefined||Number.isFinite(s.expirationTime))||!exactObject(s.keys,['p256dh','auth']))return false
 const p=s.keys.p256dh,a=s.keys.auth
 return typeof p==='string' && /^[A-Za-z0-9_-]{87}$/.test(p) && Buffer.from(p,'base64url').length===65 && Buffer.from(p,'base64url')[0]===4 && typeof a==='string' && /^[A-Za-z0-9_-]{22}$/.test(a) && Buffer.from(a,'base64url').length===16
}
export function validPushPreferences(p) {
 if(!exactObject(p,['enabled','cities','categories'])||typeof p.enabled!=='boolean'||!Array.isArray(p.cities)||p.cities.length>5||!Array.isArray(p.categories)||p.categories.length>8||new Set(p.categories).size!==p.categories.length||!p.categories.every(k=>alertKinds.includes(k)))return false
 const identities=new Set()
 for(const city of p.cities) {
  if(!exactObject(city,['name','latitude','longitude','zone'])||typeof city.name!=='string'||city.name.trim().length<1||city.name.length>100||!Number.isFinite(city.latitude)||city.latitude< -90||city.latitude>90||!Number.isFinite(city.longitude)||city.longitude< -180||city.longitude>180||typeof city.zone!=='string'||city.zone.length>64)return false
  try {new Intl.DateTimeFormat('en',{timeZone:city.zone}).format(0)}catch{return false}
  const id=`${city.latitude}:${city.longitude}`;if(identities.has(id))return false;identities.add(id)
 }
 return !p.enabled||(p.cities.length>0&&p.categories.length>0)
}
