import { useCallback, useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { authConfigured, captchaConfigured, consumeAuthHash, getUser, profileRequest, resendConfirmation, resetPassword, restoreSession, subscribeSession, saveSession, signIn, signOut, signUp, updatePassword, type AuthSession } from './auth-client'
import { authCallbackView } from './auth-flow.js'
import { Turnstile } from './Turnstile'

type View = 'closed' | 'login' | 'register' | 'forgot' | 'profile' | 'password'
const copy = {
  bg: { login: 'Вход', register: 'Регистрация', profile: 'Моят профил', logout: 'Изход', email: 'Имейл', password: 'Парола', confirm: 'Потвърди паролата', showPassword: 'Покажи паролата', hidePassword: 'Скрий паролата', name: 'Име (незадължително)', forgot: 'Забравена парола?', send: 'Изпрати', save: 'Запази', plan: 'Текущ план', free: 'Безплатен', close: 'Затвори', mismatch: 'Паролите не съвпадат.', verify: 'Провери имейла си, за да потвърдиш регистрацията.', resent: 'Писмото за потвърждение е изпратено отново.', reset: 'Изпратихме инструкции за нова парола.', success: 'Промяната е запазена.', loading: 'Зареждане…', resend: 'Изпрати потвърждението отново', unavailable: 'Регистрацията още не е настроена. Виж README за необходимите настройки.', failure: 'Операцията е неуспешна. Провери данните и опитай отново.', newPassword: 'Нова парола', signedOut: 'Излязохте успешно.', captchaRequired: 'Потвърдете, че сте човек, преди да изпратите.', captcha: { loading: 'Зареждане на проверката…', ready: 'Проверката е успешна.', expired: 'Проверката изтече. Потвърдете отново.', error: 'Проверката не се зареди или възникна грешка.', retry: 'Опитай отново' } },
  en: { login: 'Sign in', register: 'Register', profile: 'My profile', logout: 'Sign out', email: 'Email', password: 'Password', confirm: 'Confirm password', showPassword: 'Show password', hidePassword: 'Hide password', name: 'Name (optional)', forgot: 'Forgot password?', send: 'Send', save: 'Save', plan: 'Current plan', free: 'Free', close: 'Close', mismatch: 'Passwords do not match.', verify: 'Check your email to confirm your registration.', resent: 'The confirmation email was sent again.', reset: 'We sent password reset instructions.', success: 'Your changes were saved.', loading: 'Loading…', resend: 'Resend confirmation', unavailable: 'Registration is not configured yet. See README for the required setup.', failure: 'The operation failed. Check your details and try again.', newPassword: 'New password', signedOut: 'You have signed out.', captchaRequired: 'Please confirm you are human before submitting.', captcha: { loading: 'Loading verification…', ready: 'Verification successful.', expired: 'Verification expired. Please verify again.', error: 'Verification failed to load or encountered an error.', retry: 'Try again' } },
}

function PasswordField({ label, value, onChange, autoComplete, showLabel, hideLabel }: { label: string, value: string, onChange: (event: ChangeEvent<HTMLInputElement>) => void, autoComplete: string, showLabel: string, hideLabel: string }) {
  const [visible, setVisible] = useState(false)
  return <label>{label}<span className="password-field"><input type={visible ? 'text' : 'password'} required minLength={8} autoComplete={autoComplete} value={value} onChange={onChange} /><button type="button" className="password-toggle" aria-label={visible ? hideLabel : showLabel} aria-pressed={visible} onClick={() => setVisible(current => !current)}><span aria-hidden="true">{visible ? '◉' : '👁'}</span></button></span></label>
}

export function AuthPanel({ lang }: { lang: 'bg' | 'en' }) {
  const t = copy[lang]
  const [session, setSession] = useState<AuthSession | null>(null), [view, setView] = useState<View>('closed')
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirmation, setConfirmation] = useState('')
  const [profile, setProfile] = useState<any>(null), [name, setName] = useState('')
  const [busy, setBusy] = useState(true), [message, setMessage] = useState(''), [error, setError] = useState('')
  const [captchaToken, setCaptchaToken] = useState<string | null>(null), [captchaReset, setCaptchaReset] = useState(0)
  const redirect = `${location.origin}${location.pathname}`
  const captchaSiteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY || ''
  const protectedView = view === 'login' || view === 'register' || view === 'forgot'
  const onCaptchaTokenChange = useCallback((token: string | null) => setCaptchaToken(token), [])
  const changeView = (next: View) => { setCaptchaToken(null); setError(''); setMessage(''); setView(next) }

  useEffect(() => subscribeSession(active => {
    setSession(active)
    if (!active) { setProfile(null); setName(''); setView('closed') }
  }), [])

  useEffect(() => { (async () => {
    const hash = consumeAuthHash()
    let active = await restoreSession()
    if (hash?.access_token) {
      try {
        const user = await getUser(hash.access_token)
        active = { ...hash, user } as AuthSession
        saveSession(active)
        const callbackView = authCallbackView(hash.type, user) as View
        setView(callbackView)
        if (callbackView === 'profile') {
          try { const data = await profileRequest(active); setProfile(data); setName(data.name) }
          catch (reason) { fail(reason) }
        }
      } catch (reason) { fail(reason) }
    }
    setSession(active); setBusy(false)
  })() }, [])

  const fail = (reason: unknown) => { console.error(reason); setError(t.failure); setMessage('') }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (busy) return
    if (protectedView && captchaConfigured && !captchaToken) { setError(t.captchaRequired); return }
    setBusy(true); setError(''); setMessage('')
    let captchaSent = false
    try {
      if (view === 'register') { if (password !== confirmation) throw new Error('mismatch'); captchaSent = true; await signUp(email, password, redirect, captchaToken || undefined); setMessage(t.verify) }
      if (view === 'login') { captchaSent = true; const active = await signIn(email, password, captchaToken || undefined); setSession(active); changeView('closed') }
      if (view === 'forgot') { captchaSent = true; await resetPassword(email, redirect, captchaToken || undefined); setMessage(t.reset) }
      if (view === 'password' && session) { await updatePassword(session.access_token, password); setPassword(''); setMessage(t.success) }
      if (view === 'profile' && session) { const data = await profileRequest(session, 'PATCH', name); setProfile(data); setMessage(t.success) }
    } catch (reason: any) { if (reason.message === 'mismatch') setError(t.mismatch); else fail(reason) } finally { if (captchaSent) { setCaptchaToken(null); setCaptchaReset(value => value + 1) }; setBusy(false) }
  }
  const openProfile = async () => { setView('profile'); setError(''); setMessage(''); if (!session) return; setBusy(true); try { const data = await profileRequest(session); setProfile(data); setName(data.name) } catch (reason) { fail(reason) } finally { setBusy(false) } }
  const logout = async () => { if (!session) return; const active = session; setSession(null); setProfile(null); setView('closed'); setMessage(t.signedOut); setBusy(false); await signOut(active) }
  const resend = async () => {
    if (busy) return
    if (captchaConfigured && !captchaToken) { setError(t.captchaRequired); return }
    setBusy(true); setError(''); setMessage('')
    try { await resendConfirmation(email, redirect, captchaToken || undefined); setMessage(t.resent) }
    catch (reason) { fail(reason) }
    finally { setCaptchaToken(null); setCaptchaReset(value => value + 1); setBusy(false) }
  }

  return <div className="auth-nav" aria-live="polite">
    {busy && view === 'closed' ? <span>{t.loading}</span> : session ? <><button onClick={openProfile}>{t.profile}</button><button onClick={logout} disabled={busy}>{t.logout}</button></> : <><button onClick={() => changeView('login')}>{t.login}</button><button className="primary" onClick={() => changeView('register')}>{t.register}</button></>}
    {view !== 'closed' && <div className="auth-backdrop" onMouseDown={e => e.target === e.currentTarget && changeView('closed')}><section className="auth-dialog" role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <button className="auth-close" aria-label={t.close} onClick={() => changeView('closed')}>×</button>
      <h2 id="auth-title">{view === 'profile' ? t.profile : view === 'register' ? t.register : view === 'forgot' ? t.forgot : view === 'password' ? t.newPassword : t.login}</h2>
      {!authConfigured && <p className="auth-error">{t.unavailable}</p>}
      {view === 'profile' && profile && <><p className="profile-email">{profile.email}</p><p><strong>{t.plan}:</strong> {t.free}</p></>}
      <form onSubmit={submit}>
        {view !== 'profile' && view !== 'password' && <label>{t.email}<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>}
        {(view === 'login' || view === 'register' || view === 'password') && <PasswordField label={view === 'password' ? t.newPassword : t.password} value={password} onChange={e => setPassword(e.target.value)} autoComplete={view === 'login' ? 'current-password' : 'new-password'} showLabel={t.showPassword} hideLabel={t.hidePassword} />}
        {view === 'register' && <PasswordField label={t.confirm} value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="new-password" showLabel={t.showPassword} hideLabel={t.hidePassword} />}
        {view === 'profile' && <label>{t.name}<input maxLength={80} autoComplete="name" value={name} onChange={e => setName(e.target.value)} /></label>}
        {protectedView && captchaConfigured && <Turnstile key={view} siteKey={captchaSiteKey} lang={lang} resetKey={captchaReset} onTokenChange={onCaptchaTokenChange} labels={t.captcha} />}
        {error && <p className="auth-error" role="alert">{error}</p>}{message && <p className="auth-success" role="status">{message}</p>}
        <button className="auth-submit" disabled={busy || !authConfigured || (protectedView && captchaConfigured && !captchaToken)}>{busy ? t.loading : view === 'profile' ? t.save : view === 'login' ? t.login : view === 'register' ? t.register : t.send}</button>
      </form>
      {view === 'login' && <button className="auth-link" onClick={() => changeView('forgot')}>{t.forgot}</button>}
      {view === 'register' && <button className="auth-link" disabled={!email || busy || (captchaConfigured && !captchaToken)} onClick={resend}>{t.resend}</button>}
    </section></div>}
  </div>
}
