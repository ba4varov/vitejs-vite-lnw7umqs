import {handlePush} from '../server/push-core.js'
import {handleEarthquakeConsent} from '../server/earthquake-push-consent.js'
import {handleSafetyWorker} from '../server/safety-push-worker.js'
export const config={api:{bodyParser:{sizeLimit:'10kb'}}}
export default async function handler(req:any,res:any){
  if(req.query?.channel==='safety-dispatch'){
    // Exact route only: no coordinates, target IDs or server settings from HTTP.
    if(Object.keys(req.query).length!==1||req.method!=='POST'||
       req.body!=null&&JSON.stringify(req.body)!=='{}'){
      res.setHeader('Cache-Control','no-store')
      return res.status(400).json({error:'INVALID_REQUEST',deliveryEnabled:false})
    }
    // The worker checks its own static OFF switch before any secret use.
    const headers=new Headers()
    for(const name of ['authorization','origin','referer','content-type']){
      const value=req.headers?.[name]
      if(typeof value==='string')headers.set(name,value)
    }
    const request=new Request('https://meteo-puls.invalid/api/push',{
      method:'POST',headers,body:'{}'
    })
    const reply=await handleSafetyWorker(request)
    res.setHeader('Cache-Control','private, no-store')
    res.setHeader('Content-Type','application/json; charset=utf-8')
    return res.status(reply.status).send(await reply.text())
  }
  if(req.query?.channel==='earthquakes'){
    const {channel:_channel,...query}=req.query
    return handleEarthquakeConsent({
      method:req.method,query,headers:req.headers,body:req.body
    },res)
  }
  return handlePush(req,res)
}
