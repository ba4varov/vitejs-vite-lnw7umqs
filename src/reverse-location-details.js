import { acceptableAccuracy, MAX_ADDRESS_ACCURACY } from './location-accuracy.js'

// A nearest-feature reverse result does not establish which district contains
// an uncertainty circle. Keep the existing conservative accuracy gate for both
// kinds of detail; do not invent a broader district threshold from a city fix.
export function reverseLocationDetails(address, accuracy) {
  if (!acceptableAccuracy(accuracy, MAX_ADDRESS_ACCURACY)) return { street: null, neighborhood: null }
  const label = value => typeof value === 'string' && value.trim() ? value.trim() : null
  const street = label(address?.road) || label(address?.pedestrian) || label(address?.street)
  const number = label(address?.house_number)
  const neighborhood = label(address?.suburb) || label(address?.neighbourhood) || label(address?.city_district)
  return { street: street ? [street, number].filter(Boolean).join(' ') : null, neighborhood }
}

// Deliberately contains no coordinates or provider response. It is rendered
// locally and never added to telemetry or persisted as a diagnostic record.
export function reportedAccuracyMetres(accuracy) {
  return Number.isFinite(accuracy) && accuracy >= 0 ? Math.ceil(accuracy) : null
}
