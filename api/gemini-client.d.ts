export class GeminiServiceError extends Error {
  stage: string; code: string; httpStatus?: number; upstreamStatus?: string; model?: string; safeMessage?: string
}
export const geminiClient: {
  generate(options: { endpoint: string; stage: string; body: Record<string, unknown> }): Promise<{ payload: any; model: string }>
  resolveModel(stage: string): Promise<string>
  invalidate(): void
}
