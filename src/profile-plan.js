const labels = {
  bg: { free: 'Безплатен', pro: 'Pro план', loading: 'Зареждане…', unavailable: 'Планът не е наличен' },
  en: { free: 'Free', pro: 'Pro plan', loading: 'Loading…', unavailable: 'Plan unavailable' },
}

// Only a confirmed, recognized server plan can be displayed as Free or Pro.
export function profilePlanLabel(plan, lang, loading = false, failed = false) {
  const t = labels[lang]
  if (loading) return t.loading
  if (failed) return t.unavailable
  return plan === 'pro' ? t.pro : plan === 'free' ? t.free : t.unavailable
}
