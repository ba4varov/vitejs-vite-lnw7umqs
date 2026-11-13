import { handleNimh } from '../server/nimh-warnings.js'
import { handleAlerts } from '../server/alerts-core.js'
export const config = { api: { bodyParser: { sizeLimit: '24kb' } } }
export default async function handler(req: any, res: any) {
  if (req.query?.source === 'nimh') {
    const { source: _source, ...query } = req.query
    return handleNimh({ method: req.method, query }, res)
  }
  return handleAlerts(req, res)
}
