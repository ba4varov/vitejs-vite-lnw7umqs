export const ALLOWED_INTENTS: readonly string[]
export const ALLOWED_TIME_SCOPES: readonly string[]
export function parseUnderstanding(value: unknown, lang: 'bg' | 'en'): { intent: string; requestedCity: string | null; timeScope: string; targetDate: string | null; needsClarification: boolean; clarificationQuestion: string | null } | null
export function findDailyForecast(daily: Array<{ date?: string }>, targetDate: string): { date?: string } | null
export function geminiUnderstandingError(code: string, lang?: 'bg' | 'en'): string
export type ValidChatInput = { message: string; city: string; latitude: number; longitude: number; lang: 'bg' | 'en' }
export function validateChatInput(body: unknown): ValidChatInput | null
export type DeterministicUnderstanding = { intent: string; requestedCity: string | null; timeScope: string; targetDate: string | null; needsClarification: boolean; clarificationQuestion: string | null; isQuick: boolean }
export function parseDeterministicQuestion(message: string, lang?: 'bg' | 'en'): DeterministicUnderstanding | null
export function deterministicWeatherAnswer(summary: Record<string, any>, understood: DeterministicUnderstanding, lang?: 'bg' | 'en'): string
