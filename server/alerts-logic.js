import {localHourEpoch, validatePlannerInput, calculatePlanner} from './planner-logic.js'
export const riskKinds=['rain','storm','wind','cold','heat']
export const activityKinds=['walk','garden','sport']
export const alertKinds=[...riskKinds,...activityKinds]
// Hourly thresholds are indicative forecast heuristics, never official warnings.
export function forecastRisks(forecast, now=Date.now()) {
  if(!validatePlannerInput({...forecast,activity:'walk'})) return []
  const result=[]
  for(const kind of riskKinds) {
    let current=null
    for(const h of forecast.hours) {
      const start=localHourEpoch(h.time,forecast.timeZone)
      const hit=kind==='rain'?(h.rain!==null && h.rain>=10):kind==='storm'?[95,96,99].includes(h.code):kind==='wind'?(h.wind!==null && h.wind>=60):kind==='cold'?(h.feelsLike!==null && h.feelsLike<=-15):(h.feelsLike!==null && h.feelsLike>=40)
      if(start===null || start+3600000<=now || start+3600000>now+72*3600000 || !hit) {current=null;continue}
      const value=kind==='rain'?h.rain:kind==='storm'?h.code:kind==='wind'?h.wind:h.feelsLike
      if(current && current.end===start) {current.end=start+3600000;current.min=Math.min(current.min,value);current.max=Math.max(current.max,value)}
      else {current={kind,start,end:start+3600000,min:value,max:value};result.push(current)}
    }
  }
  return result.slice(0,180)
}
export function activityAlerts(forecast, enabled, now) {
  return activityKinds.filter(k=>enabled.includes(k)).flatMap(kind=>calculatePlanner({...forecast,activity:kind},now).windows.map(window=>({kind,...window})))
}
export const alertKey=(city,zone,event)=>JSON.stringify([city,zone,event.kind,event.start])
