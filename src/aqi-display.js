// Presentation only: keep finite observations (including zero) unchanged.
export function formatAqiValue(value, missingLabel, unit = '') {
  return typeof value === 'number' && Number.isFinite(value) ? `${value}${unit}` : missingLabel
}
