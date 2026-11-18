import {handlePush} from '../server/push-core.js'
import {handleEarthquakeConsent} from '../server/earthquake-push-consent.js'
export const config={api:{bodyParser:{sizeLimit:'10kb'}}}
export default async function handler(req:any,res:any){
  if(req.query?.channel==='earthquakes'){
    const {channel:_channel,...query}=req.query
    return handleEarthquakeConsent({
      method:req.method,query,headers:req.headers,body:req.body
    },res)
  }
  return handlePush(req,res)
}
