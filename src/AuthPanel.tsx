import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { authConfigured, googleAuthConfigured, signInWithGoogle, consumeGoogleCallback, captchaConfigured, consumeAuthHash, getUser, profileRequest, resendConfirmation, resetPassword, restoreSession, subscribeSession, saveSession, signIn, signOut, signUp, updatePassword, type AuthSession } from './auth-client'
import { authCallbackView } from './auth-flow.js'
import { profilePlanLabel } from './profile-plan.js'
import { NotificationSettings } from './NotificationSettings'
import { PushSettings } from './PushSettings'
import { ActivityConsent } from './ActivityConsent'
import { Turnstile } from './Turnstile'

type ProfileTab = 'account' | 'weather' | 'push' | 'privacy'
const profileTabs = { bg: ['Моят профил', 'Метео известия', 'Push известия', 'Поверителност'], en: ['My profile', 'Weather notifications', 'Push notifications', 'Privacy'] }
const tabIds: ProfileTab[] = ['account', 'weather', 'push', 'privacy']
type View = 'closed' | 'login' | 'register' | 'forgot' | 'profile' | 'password'
const copy = {
  bg: { google: 'Продължи с Google', googleFailure: 'Входът с Google е отказан, прекъснат или неуспешен. Опитай отново.', login: 'Вход', register: 'Регистрация', profile: 'Моят профил', logout: 'Изход', email: 'Имейл', password: 'Парола', confirm: 'Потвърди паролата', showPassword: 'Покажи паролата', hidePassword: 'Скрий паролата', name: 'Име (незадължително)', forgot: 'Забравена парола?', send: 'Изпрати', save: 'Запази', plan: 'Текущ план', free: 'Безплатен', close: 'Затвори', mismatch: 'Паролите не съвпадат.', verify: 'Провери имейла си, за да потвърдиш регистрацията.', resent: 'Писмото за потвърждение е изпратено отново.', reset: 'Изпратихме инструкции за нова парола.', success: 'Промяната е запазена.', loading: 'Зареждане…', resend: 'Изпрати потвърждението отново', unavailable: 'Регистрацията още не е настроена. Виж README за необходимите настройки.', failure: 'Операцията е неуспешна. Провери данните и опитай отново.', newPassword: 'Нова парола', signedOut: 'Излязохте успешно.', captchaRequired: 'Потвърдете, че сте човек, преди да изпратите.', captcha: { loading: 'Зареждане на проверката…', ready: 'Проверката е успешна.', expired: 'Проверката изтече. Потвърдете отново.', error: 'Проверката не се зареди или възникна грешка.', retry: 'Опитай отново' } },
  en: { google: 'Continue with Google', googleFailure: 'Google sign-in was denied, interrupted or failed. Please try again.', login: 'Sign in', register: 'Register', profile: 'My profile', logout: 'Sign out', email: 'Email', password: 'Password', confirm: 'Confirm password', showPassword: 'Show password', hidePassword: 'Hide password', name: 'Name (optional)', forgot: 'Forgot password?', send: 'Send', save: 'Save', plan: 'Current plan', free: 'Free', close: 'Close', mismatch: 'Passwords do not match.', verify: 'Check your email to confirm your registration.', resent: 'The confirmation email was sent again.', reset: 'We sent password reset instructions.', success: 'Your changes were saved.', loading: 'Loading…', resend: 'Resend confirmation', unavailable: 'Registration is not configured yet. See README for the required setup.', failure: 'The operation failed. Check your details and try again.', newPassword: 'New password', signedOut: 'You have signed out.', captchaRequired: 'Please confirm you are human before submitting.', captcha: { loading: 'Loading verification…', ready: 'Verification successful.', expired: 'Verification expired. Please verify again.', error: 'Verification failed to load or encountered an error.', retry: 'Try again' } },
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
  const [tab, setTab] = useState<ProfileTab>('account')
  const [weatherDirty, setWeatherDirty] = useState(false), [pushDirty, setPushDirty] = useState(false)
  const [weatherBusy, setWeatherBusy] = useState(false), [pushBusy, setPushBusy] = useState(false), [privacyBusy, setPrivacyBusy] = useState(false)
  const settingsBusy = weatherBusy || pushBusy || privacyBusy
  const dialog = useRef<HTMLElement>(null)
  const dirty = view === 'profile' && ((Boolean(profile) && name !== (profile?.name ?? '')) || weatherDirty || pushDirty)
  const close = () => {
    if (busy || settingsBusy) return
    if (dirty && !window.confirm(lang === 'bg' ? 'Има незапазени промени. Да ги отхвърлим и затворим профила?' : 'You have unsaved changes. Discard them and close your profile?')) return
    changeView('closed')
  }
  const closeRef = useRef(close); closeRef.current = close
  useEffect(() => {
    if (view === 'closed') return
    const previous = document.activeElement as HTMLElement | null
    const bodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const hidden: HTMLElement[] = []
    let node: HTMLElement | null = dialog.current?.parentElement ?? null
    while (node && node !== document.body) {
      for (const sibling of node.parentElement?.children ?? []) if (sibling !== node && sibling instanceof HTMLElement && !sibling.inert) { sibling.inert = true; hidden.push(sibling) }
      node = node.parentElement
    }
    dialog.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); closeRef.current(); return }
      if (event.key !== 'Tab') return
      const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), summary, [tabindex="0"], a[href]') ?? []).filter(el => el.getClientRects().length > 0)
      const first = items[0], last = items.at(-1)
      if (!first) { event.preventDefault(); dialog.current?.focus(); return }
      if (event.shiftKey && (document.activeElement === first || !dialog.current?.contains(document.activeElement))) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); document.body.style.overflow = bodyOverflow; hidden.forEach(el => { el.inert = false }); if (previous?.isConnected) previous.focus() }
  }, [view === 'closed'])
  useEffect(() => { dialog.current?.querySelector('.auth-dialog-content')?.scrollTo(0, 0) }, [tab])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])
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
    try {
      if (await consumeGoogleCallback()) { active = await restoreSession(); setView('closed') }
    } catch { setView('login'); setError(t.googleFailure) }
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

  const googleLogin = async () => {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try { await signInWithGoogle() }
    catch { setError(t.googleFailure) }
    finally { setBusy(false) }
  }
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
      if (view === 'profile' && session) { const data = await profileRequest(session, 'PATCH', name); setProfile(data); setName(data.name); setMessage(t.success) }
    } catch (reason: any) { if (reason.message === 'mismatch') setError(t.mismatch); else fail(reason) } finally { if (captchaSent) { setCaptchaToken(null); setCaptchaReset(value => value + 1) }; setBusy(false) }
  }
  const openProfile = async () => { if (busy) return; setProfile(null); setTab('account'); setWeatherDirty(false); setPushDirty(false); setView('profile'); setError(''); setMessage(''); if (!session) return; setBusy(true); try { const data = await profileRequest(session); setProfile(data); setName(data.name) } catch (reason) { fail(reason) } finally { setBusy(false) } }
  const logout = async () => { if (!session) return; const active = session; setSession(null); setProfile(null); setView('closed'); setMessage(t.signedOut); setBusy(false); await signOut(active) }
  const resend = async () => {
    if (busy) return
    if (captchaConfigured && !captchaToken) { setError(t.captchaRequired); return }
    setBusy(true); setError(''); setMessage('')
    try { await resendConfirmation(email, redirect, captchaToken || undefined); setMessage(t.resent) }
    catch (reason) { fail(reason) }
    finally { setCaptchaToken(null); setCaptchaReset(value => value + 1); setBusy(false) }
  }

  return <div id="planner-auth" className="auth-nav">
    {busy && view === 'closed' ? <span>{t.loading}</span> : session ? <><button onClick={openProfile}>{t.profile}</button><button onClick={logout} disabled={busy}>{t.logout}</button></> : <><button onClick={() => changeView('login')}>{t.login}</button><button className="primary" onClick={() => changeView('register')}>{t.register}</button></>}
    {view !== 'closed' && <div className="auth-backdrop" onMouseDown={e => e.target === e.currentTarget && close()}><section ref={dialog} tabIndex={-1} className={`auth-dialog ${view === 'profile' ? 'profile-dialog' : ''}`} role="dialog" aria-modal="true" aria-labelledby="auth-title">
      <header className="auth-dialog-header"><button className="auth-close" aria-label={t.close} disabled={busy || settingsBusy} onClick={close}>×</button>
      <h2 id="auth-title">{view === 'profile' ? t.profile : view === 'register' ? t.register : view === 'forgot' ? t.forgot : view === 'password' ? t.newPassword : t.login}</h2>
      </header>
      {view === 'profile' && <nav className="profile-tabs" role="tablist" aria-label={t.profile}>{tabIds.map((id, index) => <button key={id} id={`profile-tab-${id}`} role="tab" aria-selected={tab === id} aria-controls={`profile-panel-${id}`} tabIndex={tab === id ? 0 : -1} onClick={() => setTab(id)} onKeyDown={event => { const keys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End']; if (!keys.includes(event.key)) return; event.preventDefault(); const next = event.key === 'Home' ? 0 : event.key === 'End' ? 3 : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + 4) % 4; setTab(tabIds[next]); document.getElementById(`profile-tab-${tabIds[next]}`)?.focus() }}>{profileTabs[lang][index]}</button>)}</nav>}
      <div className="auth-dialog-content">
      {dirty && <p className="profile-draft-note" role="status">{lang === 'bg' ? 'Има незапазени промени. Те се запазват при смяна на раздела.' : 'You have unsaved changes. They are kept when switching sections.'}</p>}
      {!authConfigured && <p className="auth-error">{t.unavailable}</p>}
      {googleAuthConfigured && (view === 'login' || view === 'register') && <button type="button" className="auth-google" disabled={busy} onClick={googleLogin}>{t.google}</button>}
      {view === 'profile' && session && <>
        <section id="profile-panel-weather" role="tabpanel" aria-labelledby="profile-tab-weather" hidden={tab !== 'weather'}><NotificationSettings key={'notifications-'+session.user.id} session={session} lang={lang} onDirtyChange={setWeatherDirty} onBusyChange={setWeatherBusy} /></section>
        <section id="profile-panel-push" role="tabpanel" aria-labelledby="profile-tab-push" hidden={tab !== 'push'}><PushSettings key={'push-'+session.user.id} session={session} lang={lang} onDirtyChange={setPushDirty} onBusyChange={setPushBusy} /></section>
        <section id="profile-panel-privacy" role="tabpanel" aria-labelledby="profile-tab-privacy" hidden={tab !== 'privacy'}><h3>{profileTabs[lang][3]}</h3><ActivityConsent key={session.user.id} session={session} lang={lang} onBusyChange={setPrivacyBusy} /></section>
      </>}
      <section id="profile-panel-account" role={view === 'profile' ? 'tabpanel' : undefined} aria-labelledby={view === 'profile' ? 'profile-tab-account' : undefined} hidden={view === 'profile' && tab !== 'account'}>
      {view === 'profile' && <><h3>{t.profile}</h3>{profile && <p className="profile-email"><span>{t.email}</span><strong>{profile.email}</strong></p>}<p className="profile-plan"><strong>{t.plan}:</strong> {profilePlanLabel(profile?.plan, lang, busy, Boolean(error))}</p></>}
      <form onSubmit={submit}>
        {view !== 'profile' && view !== 'password' && <label>{t.email}<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} /></label>}
        {(view === 'login' || view === 'register' || view === 'password') && <PasswordField label={view === 'password' ? t.newPassword : t.password} value={password} onChange={e => setPassword(e.target.value)} autoComplete={view === 'login' ? 'current-password' : 'new-password'} showLabel={t.showPassword} hideLabel={t.hidePassword} />}
        {view === 'register' && <PasswordField label={t.confirm} value={confirmation} onChange={e => setConfirmation(e.target.value)} autoComplete="new-password" showLabel={t.showPassword} hideLabel={t.hidePassword} />}
        {view === 'profile' && <label>{t.name}<input disabled={busy || !profile} maxLength={80} autoComplete="name" value={name} onChange={e => setName(e.target.value)} /></label>}
        {protectedView && captchaConfigured && <Turnstile key={view} siteKey={captchaSiteKey} lang={lang} resetKey={captchaReset} onTokenChange={onCaptchaTokenChange} labels={t.captcha} />}
        {error && <p className="auth-error" role="alert">{view === 'profile' && !profile ? (lang === 'bg' ? 'Профилът и планът временно не могат да бъдат заредени. Затвори и опитай отново.' : 'Your profile and plan temporarily cannot be loaded. Close and try again.') : error}</p>}{message && <p className="auth-success" role="status">{message}</p>}
        <button className="auth-submit" disabled={busy || !authConfigured || (view === 'profile' && !profile) || (protectedView && captchaConfigured && !captchaToken)}>{busy ? t.loading : view === 'profile' ? t.save : view === 'login' ? t.login : view === 'register' ? t.register : t.send}</button>
      </form>
      {view === 'login' && <button className="auth-link" onClick={() => changeView('forgot')}>{t.forgot}</button>}
      {view === 'register' && <button className="auth-link" disabled={!email || busy || (captchaConfigured && !captchaToken)} onClick={resend}>{t.resend}</button>}
      </section></div>
    </section></div>}
  </div>
}
