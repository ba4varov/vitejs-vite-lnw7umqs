import {handlePush} from '../server/push-core.js'
export const config={api:{bodyParser:{sizeLimit:'10kb'}}}
export default async function handler(req:any,res:any){return handlePush(req,res)}
