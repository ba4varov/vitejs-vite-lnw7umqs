import {safeKeyStage,keyStageError,transportStage} from './push-key-stages.js'
import {validKeyDiagnostic} from './push-key-diagnostics.js'
// getSession verifies/refreshes the current Auth session; never use the UI's old
// access token after an account change. Recheck before displaying the result.
export async function requestPushKeyCheck(session,body,{getSession,fetcher=fetch}) {
 const readSession=async stage=>{try{return await getSession()}catch{throw keyStageError(stage)}}
 const active=await readSession('session:before-request')
 if(!active||active.user.id!==session.user.id)throw Object.assign(Error('SESSION_CHANGED'),{diagnostic:'session:before-request'})
 let response
 try{response=await fetcher('/api/push-key-diagnostics',{method:'POST',headers:{Authorization:`Bearer ${active.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)})}catch(error){throw keyStageError(transportStage('request',error))}
 let result
 try{result=await response.json()}catch{throw keyStageError(response.ok?'request:response':'request:http')}
 const current=await readSession('session:after-request')
 if(!current||current.user.id!==session.user.id)throw Object.assign(Error('SESSION_CHANGED'),{diagnostic:'session:after-request'})
 if(!response.ok)throw keyStageError(safeKeyStage(result?.diagnostic)||'request:http')
 if(!result||Object.keys(result).some(k=>!['keys','diagnostic'].includes(k))||!validKeyDiagnostic(result.keys)||(result.diagnostic!==undefined&&!safeKeyStage(result.diagnostic)))throw keyStageError('request:response')
 return {p256dh:result.keys.p256dh,auth:result.keys.auth,...(result.diagnostic?{diagnostic:result.diagnostic}:{})}
}
