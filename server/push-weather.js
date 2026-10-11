import {riskKinds,activityKinds,riskHit,localAlertDate} from './alerts-logic.js'
import {validatePlannerInput,plannerWindows} from './planner-logic.js'
const fields=['apparent_temperature','precipitation_probability','precipitation','wind_speed_10m','weather_code']
const hour=3600000
// Epoch hours preserve both instances of a repeated DST hour. Never trust browser forecasts.
export async function weatherSnapshot(city,fetcher=fetch,now=Date.now()) {
 const url=new URL('https://api.open-meteo.com/v1/forecast')
 url.search=new URLSearchParams({latitude:String(city.latitude),longitude:String(city.longitude),timezone:city.zone,hourly:fields.join(','),current:'temperature_2m',forecast_hours:'72',timeformat:'unixtime',wind_speed_unit:'kmh',temperature_unit:'celsius',precipitation_unit:'mm'}).toString()
 const response=await fetcher(url.href,{signal:AbortSignal.timeout(8000),redirect:'error',cache:'no-store'})
 if(!response.ok || Number(response.headers.get('content-length')||0)>150000)throw Error('FORECAST_UNAVAILABLE')
 const reader=response.body?.getReader();if(!reader)throw Error('INVALID_FORECAST')
 let size=0,text='',decoder=new TextDecoder()
 try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>150000)throw Error('FORECAST_LIMIT');text+=decoder.decode(value,{stream:true})}text+=decoder.decode()}finally{await reader.cancel().catch(()=>{})}
 const data=JSON.parse(text),h=data.hourly,u=data.hourly_units
 if(data.timezone!==city.zone || !Number.isFinite(data.current?.time) || Math.abs(data.current.time*1000-now)>90*60000 || u?.time!=='unixtime' || u.apparent_temperature!=='°C' || u.precipitation_probability!=='%' || u.precipitation!=='mm' || u.wind_speed_10m!=='km/h' || u.weather_code!=='wmo code' || !Array.isArray(h?.time) || h.time.length<24 || h.time.length>72 || !fields.every(k=>Array.isArray(h[k])&&h[k].length===h.time.length))throw Error('INVALID_FORECAST')
 const hours=h.time.map((seconds,i)=>{
  const epoch=seconds*1000
  if(!Number.isSafeInteger(seconds)||epoch<now-hour||epoch>now+72*hour||(i&&seconds-h.time[i-1]!==3600))throw Error('INVALID_FORECAST_TIME')
  return {epoch,time:new Date(epoch).toISOString().slice(0,16),feelsLike:h.apparent_temperature[i],rainProbability:h.precipitation_probability[i],rain:h.precipitation[i],wind:h.wind_speed_10m[i],code:h.weather_code[i]}
 })
 if(hours[0].epoch>now+hour||!validatePlannerInput({activity:'walk',timeZone:'UTC',hours:hours.map(({epoch,...h})=>({...h,time:new Date(Math.floor(epoch/hour)*hour).toISOString().slice(0,16)}))}))throw Error('INVALID_FORECAST_VALUES')
 return {hours,city,fetchedAt:now,source:'server-open-meteo'}
}
export function weatherEvents(snapshot,now=Date.now()) {
 if(snapshot.source!=='server-open-meteo'||now<snapshot.fetchedAt||now-snapshot.fetchedAt>15*60000)throw Error('STALE_FORECAST')
 const result=[],hours=snapshot.hours.filter(h=>h.epoch+hour>now&&h.epoch<Math.floor(now/hour)*hour+24*hour)
 for(const kind of riskKinds) {
  let current
  for(const h of hours) {
   if(!riskHit(kind,h)){current=null;continue}
   if(current&&current.end===h.epoch)current.end=h.epoch+hour
   else {current={kind,start:h.epoch,end:h.epoch+hour};result.push(current)}
  }
 }
 const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:snapshot.city.zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'})
 const localHours=hours.filter(h=>h.epoch>=now).map(h=>{
  const p=Object.fromEntries(formatter.formatToParts(h.epoch).map(x=>[x.type,x.value]))
  return {...h,time:`${p.year}-${p.month}-${p.day}T${p.hour}:00`}
 })
 for(const kind of activityKinds) {
  const dates=new Set()
  for(const event of plannerWindows(kind,snapshot.city.zone,localHours).windows) {
   const date=localAlertDate(event.start,snapshot.city.zone)
   if(!dates.has(date)){result.push({kind,start:event.start,end:event.end});dates.add(date)}
  }
 }
 return result.sort((a,b)=>a.start-b.start||a.kind.localeCompare(b.kind))
}
const names={bg:{rain:'Силен дъжд',storm:'Гръмотевична буря',wind:'Силен вятър',cold:'Опасен студ',heat:'Опасна жега',walk:'Подходящо време за разходка',garden:'Подходящо време за градината',sport:'Подходящо време за спорт'},en:{rain:'Heavy rain',storm:'Thunderstorm',wind:'Strong wind',cold:'Extreme cold',heat:'Extreme heat',walk:'Good weather for walking',garden:'Good weather for gardening',sport:'Good weather for sport'}}
export function weatherMessage(claim) {
 const lang=claim.language==='en'?'en':'bg'
 const date=new Intl.DateTimeFormat(lang==='bg'?'bg-BG':'en-GB',{timeZone:claim.city.zone,day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})
 const city=Array.from(claim.city.name).filter(c=>c.charCodeAt(0)>=32&&c.charCodeAt(0)!==127).join('').slice(0,80)
 return {title:`${lang==='bg'?'Метео Пулс':'Meteo Pulse'} · ${city}`.slice(0,80),body:`${names[lang][claim.kind]}: ${date.format(claim.start)}–${date.format(claim.end)}. ${lang==='bg'?'Ориентировъчна прогноза · Open-Meteo.':'Indicative forecast · Open-Meteo.'}`.slice(0,240),eventId:claim.id}
}
