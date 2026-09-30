import { handleProfile } from './profile-core.js'

export default async function handler(req: any, res: any) {
  return handleProfile(req, res)
}
