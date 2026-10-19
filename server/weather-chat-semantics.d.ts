import type { Understanding, ValidChatInput, ConversationContext, PendingClarification } from './weather-chat-core.js'
export type SemanticUnderstanding = Understanding & {
  turnType: 'new_question' | 'follow_up' | 'clarification' | 'cancel'
  citySource: 'explicit' | 'context' | 'selected' | 'missing'
  timeSource: 'explicit' | 'context' | 'default'
  missing: 'none' | 'intent' | 'date' | 'location'
}
export const semanticSchema: Record<string, unknown>
export const semanticSystem: string
export function semanticInput(input: ValidChatInput, currentDate: string): Record<string, unknown>
export function parseSemanticUnderstanding(value: unknown, lang?: 'bg' | 'en'): SemanticUnderstanding | null
export function hasInvalidCalendarLiteral(message: string, now?: Date, timezone?: string, lang?: 'bg' | 'en', dateExpected?: boolean): boolean
export type SemanticTurn = { understanding: Understanding; message: string; context?: ConversationContext; continuation: boolean; answer?: string; pendingClarification: PendingClarification | null; reason: 'semantic' | 'semantic_clarification' | 'invalid_date' }
export function resolveSemanticTurn(message: string, lang: 'bg' | 'en', options: ValidChatInput & { now?: Date; timezone?: string }, semantic: SemanticUnderstanding): SemanticTurn
