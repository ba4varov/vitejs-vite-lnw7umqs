// Return only an allowlisted shape; never serialize, log or persist the endpoint.
export function fcmEndpointShape(endpoint) {
 try {
  const u=new URL(endpoint)
  if(u.protocol!=='https:'||u.hostname!=='fcm.googleapis.com'||u.port||u.username||u.password||u.search||u.hash)return 'unsupported'
  if(/^\/wp\/[^/]+$/.test(u.pathname))return 'fcm-wp'
  if(/^\/fcm\/send\/[^/]+$/.test(u.pathname))return 'fcm-send'
 }catch{/* Browser errors can contain endpoint data. */}
 return 'unsupported'
}
export async function currentFcmShape(scope=window) {
 try {
  const registration=await scope.navigator.serviceWorker.getRegistration('/')
  if(registration?.active?.scriptURL!==new URL('/push-sw.js',scope.location.origin).href||registration.scope!==new URL('/',scope.location.origin).href)return 'unsupported'
  const subscription=await registration.pushManager.getSubscription()
  return fcmEndpointShape(subscription?.endpoint)
 }catch{return 'unsupported'}
}
