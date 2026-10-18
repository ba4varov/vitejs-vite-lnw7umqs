import type { ValidChatInput } from './weather-chat-core.js'
export function localRoute(input: ValidChatInput): { useLocal: boolean; reason: string }
