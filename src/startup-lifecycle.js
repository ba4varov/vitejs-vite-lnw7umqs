// Explicit opt-in only. A bounded, tab-local journal survives document reloads.
// No URLs, wall-clock times, identifiers, coordinates or arbitrary payloads.
const key = 'meteo-startup-lifecycle-v1'
const singleton = Symbol.for('meteo.startup-lifecycle.v1')
const limit = 200
const events = new Set(['module:evaluate','document:start','document:pageshow','document:pagehide','document:freeze','document:resume','document:visibility','worker:controllerchange','root:create','app:setup','app:cleanup','app:view','session:observed','location:decision'])
const enums = {
 navigation: ['navigate','reload','back_forward','prerender','unknown'],
 view: ['initial-location','forecast-loading','forecast','error'],
 source: ['default','quick','search','place','geolocation','fallback','manual'],
 visibility: ['visible','hidden','prerender','unknown'],
}
const booleans = ['ready','hasForecast','persisted','discarded','controlled','authenticated','accountChanged']
const integer = value => Number.isSafeInteger(value) && value >= 0 && value <= 1000000
function safeEntry(value) {
 if (!value || !events.has(value.event) || !integer(value.document) || !Number.isFinite(value.ms) || value.ms < 0) return null
 const entry = {event:value.event,document:value.document,ms:Math.round(value.ms*10)/10}
 if(integer(value.instance))entry.instance=value.instance
 for(const field of booleans)if(typeof value[field]==='boolean')entry[field]=value[field]
 for(const [field,allowed] of Object.entries(enums))if(allowed.includes(value[field]))entry[field]=value[field]
 return entry
}
function readJournal(storage) {
 try {
  const raw=storage?.getItem(key)||'null'
  const stored=raw.length<=64000?JSON.parse(raw):null
  return {document:integer(stored?.document)?stored.document:0,events:Array.isArray(stored?.events)?stored.events.slice(-limit).map(safeEntry).filter(Boolean):[]}
 } catch {return null}
}
export function createStartupLifecycle(enabled, {now=()=>performance.now(), storage}={}) {
 const stored=enabled?readJournal(storage):null
 const documentId=stored?.document<1000000?stored.document+1:1
 let latestDocument=documentId,instance=0,journal=stored?.events||[]
 return {
  enabled,
  instance() {return enabled?++instance:0},
  record(event,details={}) {
   if(!enabled||!events.has(event))return
   const entry=safeEntry({...details,event,document:documentId,ms:now()})
   if(!entry)return
   // A BFCache-restored Window must append to the newer document's trail,
   // not overwrite it with its old in-memory journal/counter.
   const current=readJournal(storage)
   if(current&&current.document>=latestDocument) {latestDocument=current.document;journal=current.events}
   journal.push(entry);journal=journal.slice(-limit)
   try {storage?.setItem(key,JSON.stringify({document:latestDocument,events:journal}))}catch{/* Best effort only. */}
  },
  snapshot() {return {document:enabled?documentId:0,events:journal.map(entry=>({...entry}))}},
 }
}
export function installStartupLifecycle(scope,enabled) {
 if(enabled&&scope[singleton]) {scope[singleton].record('module:evaluate');return scope[singleton]}
 let storage
 if(enabled)try{storage=scope.sessionStorage}catch{/* Browser policy may deny storage. */}
 const diagnostic=createStartupLifecycle(enabled,{storage})
 if(!enabled)return diagnostic
 Object.defineProperty(scope,singleton,{value:diagnostic,configurable:true})
 diagnostic.record('module:evaluate')
 let navigation='unknown'
 try{navigation=scope.performance.getEntriesByType('navigation')[0]?.type||'unknown'}catch{/* Optional browser API. */}
 diagnostic.record('document:start',{navigation,discarded:scope.document.wasDiscarded,controlled:Boolean(scope.navigator.serviceWorker?.controller)})
 for(const event of ['pageshow','pagehide'])scope.addEventListener(event,e=>diagnostic.record(`document:${event}`,{persisted:e.persisted===true}))
 for(const event of ['freeze','resume'])scope.document.addEventListener(event,()=>diagnostic.record(`document:${event}`))
 scope.document.addEventListener('visibilitychange',()=>diagnostic.record('document:visibility',{visibility:scope.document.visibilityState}))
 scope.navigator.serviceWorker?.addEventListener('controllerchange',()=>diagnostic.record('worker:controllerchange',{controlled:Boolean(scope.navigator.serviceWorker.controller)}))
 Object.defineProperty(scope,'meteoStartupLifecycle',{value:()=>diagnostic.snapshot(),configurable:true})
 return diagnostic
}
