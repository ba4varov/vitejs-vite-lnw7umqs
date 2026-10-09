import { handleAlerts } from '../server/alerts-core.js'
export const config = { api: { bodyParser: { sizeLimit: '24kb' } } }
export default async function handler(req: any, res: any) { return handleAlerts(req, res) }
