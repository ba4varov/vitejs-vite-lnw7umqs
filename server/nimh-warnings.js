// Restricted HTML adapter: only explicit table colours, never map pixels or forecast thresholds.
export const regions = {'Пазарджик':'PAZ','Габрово':'GAB','Търговище':'TGV','Велико Търново':'VTR','Плевен':'PVN','Ловеч':'LOV','Хасково':'HKV','Русе':'RSE','Перник':'PER','Кърджали':'KRZ','Силистра':'SLS','Разград':'RAZ','Смолян':'SML','Шумен':'SHU','Ямбол':'JAM','Кюстендил':'KNL','Варна':'VAR','Сливен':'SLV','Добрич':'DOB','Пловдив':'PDV','Софийска област':'SFO','София':'SOF','София-град':'SOF','София град':'SOF','Стара Загора':'SZR','Монтана':'MON','Благоевград':'BLG','Враца':'VRC','Видин':'VID','Бургас':'BGS'}
export const sourceUrl = (region, day) => `https://weather.bg/obshtini/index.php?z=${day}&o=${region}`
const text = s => s.replace(/<br\s*\/?>/gi,' ').replace(/<[^>]*>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/\s+/g,' ').trim()
const colours = {'#00ff00':'green','#ffff00':'yellow','#ff8000':'orange','#ff0000':'red'}
const kinds = ['heat','cold','wind','rain','snow']
export const sofiaDate = now => new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Sofia',year:'numeric',month:'2-digit',day:'2-digit'}).format(now)
function isoDate(d,m,y) {
 const iso=`${y}-${m}-${d}`
 return new Date(`${iso}T12:00:00Z`).toISOString().slice(0,10)===iso ? iso : null
}
export function parseNimh(html, region, expectedDate) {
 const dateMatch=html.match(/по общини за\s+(\d{2})\.(\d{2})\.(\d{4})\s*г\./)
 if(!dateMatch || isoDate(...dateMatch.slice(1))!==expectedDate) throw Error('INVALID_DATE')
 const table=html.match(/<table\b[^>]*\bid=['"]myTable['"][^>]*>([\s\S]*?)<\/table>/i)?.[1]
 const district=html.match(/<table\b[^>]*\bid=['"]myTable1['"][^>]*>([\s\S]*?)<\/table>/i)?.[1]
 if(!table || !district)throw Error('INVALID_TABLE')
 const header=table.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i)?.[1]||''
 const headings=[...header.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map(m=>text(m[1]))
 if(headings.length!==6 || !/^Община$/.test(headings[0]) || !/^Висока\s+температура$/.test(headings[1]) || !/^Ниска\s+температура$/.test(headings[2]) || headings[3]!=='Вятър' || headings[4]!=='Дъжд' || !headings[5].startsWith('Сняг'))throw Error('INVALID_COLUMNS')
 const municipalities={}
 for(const row of table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
  const cells=[...row[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)]
  if(!cells.length)continue
  if(cells.length!==6)throw Error('INVALID_ROW')
  const name=text(cells[0][2]);if(!name||municipalities[name])throw Error('INVALID_NAME')
  municipalities[name]=cells.slice(1).flatMap((cell,i)=>{
   const colour=colours[cell[1].match(/background-color:\s*(#[a-f0-9]{6})/i)?.[1]?.toLowerCase()]
   if(!colour)throw Error('UNKNOWN_COLOUR')
   if(colour==='green')return []
   const description=text(cell[2]);if(!description)throw Error('MISSING_DESCRIPTION')
   return [{scope:'municipality',area:name,level:colour,kind:kinds[i],description,date:expectedDate}]
  })
 }
 if(!Object.keys(municipalities).length)throw Error('EMPTY_TABLE')
 const warnings=[]
 const blocks=[...district.matchAll(/<tr\b[^>]*bgcolor=['"](#[a-f0-9]{6})['"][^>]*>([\s\S]*?)(?=<tr\b[^>]*bgcolor=|$)/gi)]
 if(!blocks.length)throw Error('MISSING_DISTRICT')
 for(const block of blocks) {
  const level=colours[block[1].toLowerCase()];if(!level)throw Error('UNKNOWN_COLOUR')
  const area=text(block[2].match(/<h3>([\s\S]*?)<\/h3>/i)?.[1]||'')
  const dates=[...block[2].matchAll(/прогноза за:\s*(\d{2})\.(\d{2})\.(\d{4})/g)]
  if(!area || dates.length!==1 || isoDate(...dates[0].slice(1))!==expectedDate)throw Error('INVALID_DISTRICT_DATE')
  if(level==='green')continue
  const descriptions=[...block[2].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>text(m[1])).filter(s=>s&&!s.startsWith('прогноза за:')&&!s.startsWith('издадена на:'))
  if(descriptions.length!==1)throw Error('INVALID_DESCRIPTION')
  const hazardNames={'1':'rain','2':'storm','4':'snow','5':'wind','6':'cold','7':'heat','8':'fog','9':'waves'}
  const hazards=[...block[2].matchAll(/static\/icon\/(\d+)\.gif/g)].map(m=>m[1]).filter(n=>n!=='0').map(n=>hazardNames[n])
  if(!hazards.length||hazards.some(h=>!h))throw Error('UNKNOWN_HAZARD')
  warnings.push({hazards,scope:area.includes('море')?'marine':'district',area,level,kind:'official',description:descriptions[0],date:expectedDate})
 }
 return {region,date:expectedDate,municipalities,warnings}
}
// Bounded warm-instance cache, failures included; simultaneous requests share a promise.
const cache=new Map()
async function cached(key,ttl,load,now) {
 const hit=cache.get(key);if(hit&&hit.until>now)return hit.promise
 if(cache.size>=160)cache.delete(cache.keys().next().value)
 const entry={until:now+ttl,promise:null}
 entry.promise=load().catch(error=>{entry.until=now+60000;throw error})
 cache.set(key,entry);return entry.promise
}
async function read(url,fetcher) {
 const r=await fetcher(url,{redirect:'error',signal:AbortSignal.timeout(8000)})
 if(!r.ok)throw Error('SOURCE_UNAVAILABLE')
 const body=await r.text();if(body.length>1500000)throw Error('SOURCE_TOO_LARGE');return body
}
export async function handleNimh(req,res,fetcher=fetch,now=Date.now()) {
 res.setHeader('Cache-Control','public, max-age=60, s-maxage=300, must-revalidate')
 if(req.method!=='GET')return res.status(405).json({status:'unavailable',warnings:[]})
 const q=req.query||{}
 if(Object.keys(q).some(k=>k!=='id')||!/^\d{1,9}$/.test(q.id||''))return res.status(400).json({status:'unverified',warnings:[]})
 try {
  const geo=await cached(`geo:${q.id}`,86400000,async()=>JSON.parse(await read(`https://geocoding-api.open-meteo.com/v1/get?id=${q.id}&language=bg`,fetcher)),now)
  const region=geo.country_code==='BG'&&regions[geo.admin1?.replace(/^Област\s+/, '')]
  if(!region||!geo.admin2)return res.status(200).json({status:'unverified',warnings:[]})
  const municipality=region==='SOF'&&geo.admin2_id===6458974?'Столична':geo.admin2.replace(/^Община\s+/, '')
  const today=sofiaDate(now),tomorrow=sofiaDate(new Date(`${today}T12:00:00Z`).getTime()+86400000)
  const days=await Promise.all(['d','u'].map(async(day,i)=>{
   const date=i?tomorrow:today
   try {
    const data=await cached(`${region}:${date}`,900000,async()=>({ ...parseNimh(await read(sourceUrl(region,day),fetcher),region,date),checkedAt:now }),now)
    if(!Object.hasOwn(data.municipalities,municipality))throw Error('UNVERIFIED_MUNICIPALITY')
    return {status:'verified',date,checkedAt:data.checkedAt,source:sourceUrl(region,day),warnings:[...data.municipalities[municipality],...data.warnings]}
   }catch{return {status:'unavailable',date,warnings:[],source:sourceUrl(region,day)}}
  }))
  return res.status(200).json({status:'resolved',region:geo.admin1,municipality,placeId:geo.id,days})
 }catch{return res.status(503).json({status:'unavailable',warnings:[]})}
}
