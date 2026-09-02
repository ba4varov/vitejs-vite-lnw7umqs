export const ALLOWED_INTENTS: readonly string[]
export type ValidChatInput = { message: string; city: string; latitude: number; longitude: number; lang: 'bg' | 'en' }
export function validateChatInput(body: unknown): ValidChatInput | null
