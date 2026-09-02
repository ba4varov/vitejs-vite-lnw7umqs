type ApiRequest = {
  method?: string
  body?: Record<string, unknown>
}

type ApiResponse = {
  status: (code: number) => ApiResponse
  json: (body: Record<string, unknown>) => void
}

import { GeminiServiceError, geminiClient } from './gemini-client.js'

export default async function handler(request: ApiRequest, response: ApiResponse) {
  if (request.method !== 'POST') {
    return response.status(405).json({ error: 'Method not allowed' })
  }

  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) {
    return response.status(503).json({ error: 'AI service is not configured' })
  }

  const weather = request.body ?? {}
  const language = weather.lang === 'en' ? 'English' : 'Bulgarian'
  const prompt = `Write a playful, humorous, but practical weather tip in ${language} using only the data below.
Keep it to one or two short sentences and under 220 characters. Do not use markdown, greetings, warnings not supported by the data, or mention AI.
Location: ${weather.city}
Temperature: ${weather.temp}°C; feels like: ${weather.feelsLike}°C
Conditions: ${weather.description}; weather code: ${weather.code}
Rain today: ${weather.rain} mm; rain probability: ${weather.precipProb}%
Wind: ${weather.wind} km/h; UV index: ${weather.uvIndex}`

  try {
    const { payload: result } = await geminiClient.generate({
      endpoint: 'weather-advice', stage: 'gemini-advice', body: {
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 1, maxOutputTokens: 100 }
      }
    })
    const advice = result.candidates?.[0]?.content?.parts?.[0]?.text?.trim().slice(0, 220)
    if (!advice) return response.status(502).json({ error: 'AI returned no advice' })

    return response.status(200).json({ advice })
  } catch (error) {
    const configurationError = error instanceof GeminiServiceError &&
      ['models-list-failed', 'no-compatible-model', 'configured-model-unavailable'].includes(error.code)
    return response.status(configurationError ? 503 : 502).json({
      error: configurationError ? 'AI service model is unavailable' : 'AI service is unavailable'
    })
  }
}
