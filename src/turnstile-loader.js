const SCRIPT_ID = 'cloudflare-turnstile-script'
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
let loading

export function loadTurnstile(win = window, doc = document) {
  if (win.turnstile) return Promise.resolve(win.turnstile)
  if (loading) return loading

  loading = new Promise((resolve, reject) => {
    let script = doc.getElementById(SCRIPT_ID)
    if (!script) {
      script = doc.createElement('script')
      script.id = SCRIPT_ID
      script.src = SCRIPT_URL
      script.async = true
      script.defer = true
      doc.head.appendChild(script)
    }
    script.addEventListener('load', () => win.turnstile ? resolve(win.turnstile) : reject(new Error('TURNSTILE_UNAVAILABLE')), { once: true })
    script.addEventListener('error', () => reject(new Error('TURNSTILE_LOAD_FAILED')), { once: true })
  }).catch(error => {
    loading = undefined
    doc.getElementById(SCRIPT_ID)?.remove()
    throw error
  })
  return loading
}

export function resetTurnstileLoaderForTests() { loading = undefined }
