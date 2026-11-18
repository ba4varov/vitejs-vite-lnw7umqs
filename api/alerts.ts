import { handleNimh } from '../server/nimh-warnings.js'
import { handleAlerts } from '../server/alerts-core.js'
import { handleEarthquakes } from '../server/earthquakes-core.js'
import { handleEarthquakeHistory } from '../server/earthquake-history-core.js'
export const config = { api: { bodyParser: { sizeLimit: '24kb' } } }
export default async function handler(req: any, res: any) {
  if (req.query?.source === 'earthquake-history') {
    const { source: _source, ...query } = req.query
    return handleEarthquakeHistory({ method: req.method, query, headers: req.headers }, res)
  }
  if (req.query?.source === 'earthquakes') {
    const { source: _source, ...query } = req.query
    return handleEarthquakes({ method: req.method, query, headers: req.headers }, res)
  }
  if (req.query?.source === 'nimh') {
    const { source: _source, ...query } = req.query
    return handleNimh({ method: req.method, query, headers: req.headers }, res)
  }
  return handleAlerts(req, res)
}
