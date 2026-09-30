export function authCallbackView(type, user) {
  if (type === 'recovery') return 'password'
  if (type === 'signup' && user?.email_confirmed_at) return 'profile'
  return 'closed'
}
