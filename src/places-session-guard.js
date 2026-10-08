/** Coordinates account-scoped async work without owning React state. */
export function createPlacesSessionGuard() {
  let epoch = 0
  let accountId = null
  let selectionRevision = 0
  let defaultEligible = false
  return {
    changeSession(nextAccountId) {
      const accountChanged = accountId !== nextAccountId
      accountId = nextAccountId
      if (accountChanged) epoch += 1
      if (accountChanged) defaultEligible = nextAccountId !== null
      return { accountChanged, ticket: this.ticket() }
    },
    ticket() { return { epoch, accountId, selectionRevision, defaultEligible } },
    isCurrent(ticket) { return ticket.epoch === epoch && ticket.accountId === accountId },
    manualSelection() { selectionRevision += 1; defaultEligible = false },
    canApplyDefault(ticket) {
      return this.isCurrent(ticket) && ticket.selectionRevision === selectionRevision && accountId !== null && ticket.defaultEligible && defaultEligible
    },
    resolveDefault(ticket) { if (this.canApplyDefault(ticket)) { defaultEligible = false; return true } return false },
  }
}
