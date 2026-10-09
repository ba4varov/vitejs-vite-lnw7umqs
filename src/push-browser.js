export function pushSupport(scope=window) {
 const n=scope.navigator
 const ios=/iPad|iPhone|iPod/.test(n.userAgent)||(/Macintosh/.test(n.userAgent)&&n.maxTouchPoints>1)
 if(ios && !scope.matchMedia('(display-mode: standalone)').matches && !n.standalone)return 'ios-install'
 return scope.isSecureContext && 'serviceWorker' in n && 'PushManager' in scope && 'Notification' in scope?'supported':'unsupported'
}
export async function preparePushWorker(scope=window) {
 if(pushSupport(scope)!=='supported')throw Error('UNSUPPORTED')
 return scope.navigator.serviceWorker.register('/push-sw.js',{scope:'/',updateViaCache:'none'})
}
export function vapidBytes(key) {
 const text=atob(key.replace(/-/g,'+').replace(/_/g,'/'))
 const bytes=Uint8Array.from(text,c=>c.charCodeAt(0))
 if(bytes.length!==65||bytes[0]!==4)throw Error('INVALID_PUBLIC_KEY')
 return bytes
}
export async function enrollPush({scope=window,registration,key,persist}) {
 // Called directly by the click handler, before any await loses iOS activation.
 const permission=await scope.Notification.requestPermission()
 if(permission!=='granted')throw Error(permission==='denied'?'DENIED':'DISMISSED')
 const existing=await registration.pushManager.getSubscription()
 const expected=vapidBytes(key)
 if(existing) {
  const actual=new Uint8Array(existing.options?.applicationServerKey || [])
  // Never relabel a subscription bound to the old VAPID key as a new one.
  if(actual.length!==expected.length || actual.some((byte,i)=>byte!==expected[i]))throw Error('KEY_ROTATION_REQUIRED')
 }
 const subscription=existing||await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:expected})
 try {return await persist(subscription.toJSON())}
 catch(error) {if(!existing)await subscription.unsubscribe().catch(()=>{});throw error}
}
export async function removePushDevice({registration,device,persist}) {
 // Remove server authority first. A network failure never falsely reports success.
 const data=await persist(device.id)
 const sub=await registration?.pushManager.getSubscription()
 if(sub) {
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sub.endpoint))
  const fingerprint=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('')
  if(fingerprint===device.fingerprint)await sub.unsubscribe()
 }
 return data
}
