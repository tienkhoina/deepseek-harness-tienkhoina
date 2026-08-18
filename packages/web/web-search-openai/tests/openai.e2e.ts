import { describe, expect, it } from 'vitest'
import {
  OpenAiResponsesSearchProvider,
  OPENAI_RESPONSES_DEFAULT_BASE_URL,
  OPENAI_RESPONSES_DEFAULT_MODEL,
} from '@deepseek-ai/dsh-web-search-openai'

const apiKey = process.env.OPENAI_API_KEY

describe.skipIf(apiKey === undefined || apiKey.length === 0)('OpenAI Responses web search real API', () => {
  it('returns citeable sources for a live query', async () => {
    const provider = new OpenAiResponsesSearchProvider({
      ...apiKey === undefined ? {} : { apiKey },
      baseURL: process.env.OPENAI_RESPONSES_BASE_URL ?? OPENAI_RESPONSES_DEFAULT_BASE_URL,
      model: process.env.OPENAI_RESPONSES_WEB_SEARCH_MODEL ?? OPENAI_RESPONSES_DEFAULT_MODEL,
    })
    const result = await provider.search({ query: 'What is the DeepSeek Harness project?' })
    expect(result.sources.length).toBeGreaterThan(0)
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//u)
  })
})
