// ISO 3166-2 province identifiers from the existing reverse-geocoding address.
const provinces = ['BLG','BGS','VAR','VTR','VID','VRC','GAB','DOB','KRZ','KNL','LOV','MON','PAZ','PER','PVN','PDV','RAZ','RSE','SLS','SLV','SML','SOF','SFO','SZR','TGV','HKV','SHU','JAM']
export function gpsWarningArea(data, accuracy) {
 const a=data?.address
 if(a?.country_code?.toLowerCase()!=='bg'||!Number.isFinite(accuracy)||accuracy<0||accuracy>100)return null
 // Coarse fixes and reverse zoom=10 cannot establish administrative containment.
 const iso=a['ISO3166-2-lvl4']
 const match=typeof iso==='string'&&iso.match(/^BG-(\d{2})$/)
 const region=match&&provinces[Number(match[1])-1]
 if(!region)return null
 // Never substitute address.city/town/village (or the nearest settlement).
 const administrative=a.municipality||(/^община\s+/iu.test(a.county||'')?a.county:null)
 const municipality=typeof administrative==='string'&&/^[А-Яа-яѝ -]{2,80}$/.test(administrative)?administrative.replace(/^община\s+/iu,''):undefined
 return {region,...(municipality?{municipality}:{})}
}
