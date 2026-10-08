import { handleProfile } from '../server/profile-core.js'

export default async function handler(req: any, res: any) {
  return handleProfile(req, res)
}
