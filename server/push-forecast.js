import {validPushPreferences} from './push-validation.js'
import {validatePlannerInput} from './planner-logic.js'
import {forecastRisks,activityAlerts,riskKinds,activityKinds} from './alerts-logic.js'
const fields=['apparent_temperature','precipitation_probability','precipitation','wind_speed_10m','weather_code']
// Future worker adapter only. Not called by /api/push or any scheduled function.
export async function fetchPushForecast(city,fetcher=fetch,now=Date.now()) {
 if(!validPushPreferences({enabled:false,cities:[city],categories:[]}))throw Error('INVALID_CITY')
 const url=new URL('https://api.open-meteo.com/v1/forecast')
 url.search=new URLSearchParams({latitude:String(city.latitude),longitude:String(city.longitude),timezone:city.zone,hourly:fields.join(','),current:'temperature_2m',forecast_hours:'72',timeformat:'unixtime',wind_speed_unit:'kmh',temperature_unit:'celsius',precipitation_unit:'mm'}).toString()
 const response=await fetcher(url.href,{signal:AbortSignal.timeout(8000),redirect:'error',cache:'no-store'})
 if(!response.ok||Number(response.headers.get('content-length')||0)>150000)throw Error('FORECAST_UNAVAILABLE')
 const reader=response.body?.getReader();if(!reader)throw Error('INVALID_FORECAST')
 let bytes=0;const chunks=[]
 try {for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>150000)throw Error('FORECAST_TOO_LARGE');chunks.push(value)}}finally{await reader.cancel().catch(()=>{})}
 const data=JSON.parse(Buffer.concat(chunks).toString('utf8')),h=data.hourly,u=data.hourly_units
 if(data.timezone!==city.zone||!Number.isFinite(data.current?.time)||Math.abs(data.current.time*1000-now)>90*60000||u?.time!=='unixtime'||u.apparent_temperature!=='°C'||u.precipitation_probability!=='%'||u.precipitation!=='mm'||u.wind_speed_10m!=='km/h'||!Array.isArray(h?.time)||h.time.length<2||h.time.length>72||!fields.every(k=>Array.isArray(h[k])&&h[k].length===h.time.length))throw Error('INVALID_FORECAST')
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:city.zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'})
 const forecast={timeZone:city.zone,hours:h.time.map((seconds,i)=>{
  if(!Number.isFinite(seconds)||seconds*1000<now-3600000||seconds*1000>now+72*3600000||(i&&seconds-h.time[i-1]!==3600))throw Error('INVALID_FORECAST_TIME')
  const p=Object.fromEntries(formatter.formatToParts(seconds*1000).map(x=>[x.type,x.value]))
  return {time:`${p.year}-${p.month}-${p.day}T${p.hour}:00`,feelsLike:h.apparent_temperature[i],rainProbability:h.precipitation_probability[i],rain:h.precipitation[i],wind:h.wind_speed_10m[i],code:h.weather_code[i]}
 })}
 if(!validatePlannerInput({...forecast,activity:'walk'}))throw Error('INVALID_FORECAST_VALUES')
 return {forecast,city:{...city},fetchedAt:now,source:'server-open-meteo'}
}
export function evaluatePushForecast(snapshot,preferences,entitlement,now=Date.now()) {
 if(!validPushPreferences(preferences)||!preferences.enabled)return []
 if(!preferences.cities.some(c=>c.latitude===snapshot?.city?.latitude&&c.longitude===snapshot.city.longitude&&c.zone===snapshot.city.zone))throw Error('UNSELECTED_CITY')
 if(snapshot?.source!=='server-open-meteo'||!Number.isFinite(snapshot.fetchedAt)||now-snapshot.fetchedAt<0||now-snapshot.fetchedAt>15*60000||!validatePlannerInput({...snapshot.forecast,activity:'walk'}))throw Error('STALE_FORECAST')
 const pro=entitlement?.plan==='pro' && Array.isArray(entitlement.permissions) && entitlement.permissions.includes('planner:advanced')
 return [...forecastRisks(snapshot.forecast,now).filter(e=>riskKinds.includes(e.kind)&&preferences.categories.includes(e.kind)),...(pro?activityAlerts(snapshot.forecast,preferences.categories.filter(k=>activityKinds.includes(k)),now):[])]
}
