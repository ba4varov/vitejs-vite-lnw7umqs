// In-memory only: no guest identity, persisted event queue, or background retries.
export function createActivityTracker({ request, getSession, randomId = () => crypto.randomUUID() }) {
  let subject = null, consent = null, generation = 0, pending = 0
  return {
    reset(id) { if (subject !== id) { subject = id; consent = null; generation++ } },
    snapshot() { return consent },
    invalidate() { consent = null; generation++ },
    apply(id, value) { if (subject === id) { consent = value; generation++ } },
    async track(action) {
      const id = subject, revision = consent?.revision, started = generation
      if (!id || !consent?.enabled || !revision || pending >= 3) return false
      pending++
      try {
        const session = await getSession()
        if (!session || session.user.id !== id || started !== generation || !consent?.enabled) return false
        const result = await request(session, 'POST', {action, operationId:randomId(), revision})
        return result.recorded === true
      } catch { return false } finally { pending-- }
    },
  }
}
