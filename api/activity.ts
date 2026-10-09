import { handleActivity } from '../server/activity-core.js'
export default async function handler(req: any, res: any) { return handleActivity(req, res) }
