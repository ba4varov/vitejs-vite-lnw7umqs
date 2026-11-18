import {handleEarthquakes} from '../server/earthquakes-core.js'

// Public, shared USGS feed: NO city/GPS coordinates in the request.
// Vercel CDN caches the normalized result; browser filters by chosen city.
export const config={api:{bodyParser:false}}
export default async function handler(req:any,res:any){return handleEarthquakes(req,res)}
