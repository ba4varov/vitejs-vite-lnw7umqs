export type LocationCandidate = { text: string; strength: 'syntax' | 'connector' | 'name'; anchored?: boolean; role?: 'origin' | 'destination' | 'comparison' }
export type GroundedPlace = { name: string; latitude: number; longitude: number; timezone: string | null }
export type AmbiguousPlace = { ambiguous: true; name: string; options: string[] }
export function normalizePlaceName(value: string): string
export function oneEditApart(a: string, b: string): boolean
export function collectLocationCandidates(message: string, lang?: 'bg' | 'en'): LocationCandidate[] & { overflow?: boolean }
export type GroundingResult = { candidates: number } & ({ status: 'none' } | { status: 'verified'; place: GroundedPlace } | { status: 'ambiguous'; requestedCity: string | null } | { status: 'unverified'; requestedCity: string })
export function groundLocation(candidates: LocationCandidate[] & { overflow?: boolean }, requestedCity: string | null, explicitAI: boolean, resolve: (name: string) => Promise<GroundedPlace | AmbiguousPlace | null>): Promise<GroundingResult>
