import { handlePlanner } from '../server/planner-core.js'
export const config = { api: { bodyParser: { sizeLimit: '24kb' } } }
export default async function handler(req: any, res: any) { return handlePlanner(req, res) }
