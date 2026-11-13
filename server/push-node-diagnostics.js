// Request-local bridge across the legacy shared sender, which omits these Node fields.
// Copy only fixed categories after the sender has validated the same HTTP failure.
export function createNodeDiagnosticBridge(){
 let status,fields={}
 return {
  capture(result){
   status=result?.status;fields={}
   for(const [key,allowed] of [
    ['providerMimeCategory',['missing','plain','html','json','other']],
    ['providerBodyShape',['known_fcm_html','generic_bad_request_html','json_error','other']],
   ])if(typeof result?.[key]==='string'&&allowed.includes(result[key]))fields[key]=result[key]
   return result
  },
  enrich(result){
   if(Number.isInteger(status)&&status>=400&&status<=599&&result?.diagnostic?.providerStatus===status){
    return {...result,diagnostic:{...result.diagnostic,...fields}}
   }
   return result
  },
 }
}
