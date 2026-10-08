import { handleAdmin } from '../server/admin-core.js'
export default async function handler(req: any, res: any) { return handleAdmin(req, res) }
