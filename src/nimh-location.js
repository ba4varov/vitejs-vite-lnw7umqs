import { acceptableAccuracy } from './location-accuracy.js'
// Administrative evidence is stricter than a 3 km forecast fix. A province
// tolerates up to 1 km; municipality retains the conservative 100 m limit.
// These limits reduce uncertainty; reverse geocoding is not a boundary polygon.
export const MAX_WARNING_REGION_ACCURACY = 1000
export const MAX_WARNING_MUNICIPALITY_ACCURACY = 100
// ISO 3166-2 province identifiers from the existing reverse-geocoding address.
const provinces = ['BLG','BGS','VAR','VTR','VID','VRC','GAB','DOB','KRZ','KNL','LOV','MON','PAZ','PER','PVN','PDV','RAZ','RSE','SLS','SLV','SML','SOF','SFO','SZR','TGV','HKV','SHU','JAM']
export function gpsWarningArea(data, accuracy) {
 const a=data?.address
 if(a?.country_code?.toLowerCase()!=='bg'||!acceptableAccuracy(accuracy,MAX_WARNING_REGION_ACCURACY))return null
 // Require explicit administrative evidence; settlement names are insufficient.
 const iso=a['ISO3166-2-lvl4']
 const match=typeof iso==='string'&&iso.match(/^BG-(\d{2})$/)
 const region=match&&provinces[Number(match[1])-1]
 if(!region)return null
 // Never substitute address.city/town/village (or the nearest settlement).
 const administrative=a.municipality||(/^община\s+/iu.test(a.county||'')?a.county:null)
 const municipality=acceptableAccuracy(accuracy,MAX_WARNING_MUNICIPALITY_ACCURACY)&&typeof administrative==='string'&&/^[А-Яа-яѝ -]{2,80}$/.test(administrative)?administrative.replace(/^община\s+/iu,''):undefined
 return {region,...(municipality?{municipality}:{})}
}
