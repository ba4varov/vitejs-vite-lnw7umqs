export const ALLOWED_INTENTS: readonly string[]
export const ALLOWED_TIME_SCOPES: readonly string[]
export const QUICK_ACTIONS: readonly string[]
export function parseUnderstanding(value: unknown, lang: 'bg' | 'en'): { intent: string; requestedCity: string | null; timeScope: string; targetDate: string | null; needsClarification: boolean; clarificationQuestion: string | null } | null
export function findDailyForecast(daily: Array<{ date?: string }>, targetDate: string): { date?: string } | null
export function geminiUnderstandingError(code: string, lang?: 'bg' | 'en'): string
export type ValidChatInput = { message: string; city: string; latitude: number; longitude: number; lang: 'bg' | 'en'; quickAction?: 'umbrella' | 'clothing' | 'walk' }
export function validateChatInput(body: unknown): ValidChatInput | null
export type DeterministicUnderstanding = { intent: string; requestedCity: string | null; timeScope: string; targetDate: string | null; needsClarification: boolean; clarificationQuestion: string | null; isQuick: boolean }
export function normalizeQuestion(value: string): string
export function normalizeBulgarianTimeExpressions(value: string): string
export function localIsoDate(now?: Date, timezone?: string): string
export function relativeForecastDate(scope: 'today' | 'tomorrow' | 'day_after_tomorrow', now?: Date, timezone?: string): string | null
export function extractRequestedDate(message: string, now?: Date, timezone?: string): string | null
export function extractRequestedCity(message: string): string | null
export function extractTimeScope(message: string): string | null
export function parseDeterministicQuestion(message: string, lang?: 'bg' | 'en', options?: { now?: Date; timezone?: string; quickAction?: 'umbrella' | 'clothing' | 'walk' }): DeterministicUnderstanding | null
export function deterministicWeatherAnswer(summary: Record<string, any>, understood: DeterministicUnderstanding, lang?: 'bg' | 'en'): string
