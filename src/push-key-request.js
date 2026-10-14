import {validKeyDiagnostic} from './push-key-diagnostics.js'
// getSession verifies/refreshes the current Auth session; never use the UI's old
// access token after an account change. Recheck before displaying the result.
export async function requestPushKeyCheck(session,body,{getSession,fetcher=fetch}) {
 const active=await getSession()
 if(!active||active.user.id!==session.user.id)throw Error('SESSION_CHANGED')
 const response=await fetcher('/api/push-key-diagnostics',{method:'POST',headers:{Authorization:`Bearer ${active.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(body),cache:'no-store',redirect:'error',signal:AbortSignal.timeout(10000)})
 if(!response.ok)throw Error('CHECK_UNAVAILABLE')
 const result=await response.json(),current=await getSession()
 if(!current||current.user.id!==session.user.id)throw Error('SESSION_CHANGED')
 if(!result||Object.keys(result).length!==1||!validKeyDiagnostic(result.keys))throw Error('CHECK_UNAVAILABLE')
 return {p256dh:result.keys.p256dh,auth:result.keys.auth}
}
