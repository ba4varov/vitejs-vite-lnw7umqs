import { useState } from 'react'
import { startupReport } from './startup-report.js'
import './startup-diagnostics.css'
export default function StartupDiagnostics({lang}:{lang:string}) {
 const bg = lang === 'bg'
 const [report,setReport] = useState('')
 const [status,setStatus] = useState('')
 async function copy() {
  setReport('')
  let text
  try {
   const scope = window as unknown as {meteoStartupLifecycle:()=>unknown;meteoStartupTiming:()=>unknown}
   text = startupReport(scope.meteoStartupLifecycle(), scope.meteoStartupTiming())
  } catch {
   setStatus(bg?'Копирането е блокирано: отчетът не премина проверката за безопасни данни.':'Copy blocked: report failed the safe data check.')
   return
  }
  try {
   if (!navigator.clipboard?.writeText) throw Error('Clipboard unavailable')
   await navigator.clipboard.writeText(text)
   setStatus(bg?'Диагностиката е копирана.':'Diagnostics copied.')
  } catch {
   setReport(text)
   setStatus(bg?'Изберете текста и използвайте „Копиране“ от менюто на телефона.':'Select the text and use Copy in your phone menu.')
  }
 }
 return <details className="startup-diagnostics" data-testid="startup-diagnostics">
  <summary>{bg?'Диагностика':'Diagnostics'}</summary>
  <button type="button" onClick={copy}>{bg?'Копирай диагностиката':'Copy diagnostics'}</button>
  <p role="status">{status}</p>
  {report && <><label htmlFor="startup-report">{bg?'Ръчно копиране':'Manual copy'}</label><textarea id="startup-report" readOnly value={report} onFocus={e=>e.currentTarget.select()} /><button type="button" onClick={()=>{const area=document.getElementById('startup-report') as HTMLTextAreaElement;area.focus({preventScroll:true});area.select()}}>{bg?'Избери целия текст':'Select all text'}</button></>}
 </details>
}
