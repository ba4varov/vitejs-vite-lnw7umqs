export const GEMINI_BUDGET_MS: Readonly<{ total: number; discovery: number; generation: number }>
export class GeminiServiceError extends Error {
  stage: string; code: string; httpStatus?: number; upstreamStatus?: string; model?: string; safeMessage?: string
}
export const geminiClient: {
  generate(options: { endpoint: string; stage: string; body: Record<string, unknown>; requestId?: string }): Promise<{ payload: unknown; model: string }>
  resolveModel(stage: string): Promise<string>
  invalidate(): void
}
