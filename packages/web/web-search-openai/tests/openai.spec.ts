import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import WebRuntime from '@deepseek-ai/dsh-web'
import {
  OpenAiResponsesSearchProvider,
  OPENAI_RESPONSES_PROVIDER_ID,
} from '@deepseek-ai/dsh-web-search-openai'
import * as openAiPlugin from '@deepseek-ai/dsh-web-search-openai'
import { mapOpenAiResponsesResponse, parseOpenAiResponsesResponse } from '../src/provider.ts'

const options = {
  apiKey: 'oa-key',
  baseURL: 'https://api.openai.test/v1',
  model: 'gpt-5.5',
}

class MemorySettings extends SettingsProvider {
  constructor(ctx: Context, private readonly initial: Record<string, unknown>) {
    super(ctx)
  }

  readonly writable = true

  protected load(): Promise<Record<string, unknown>> {
    return Promise.resolve(structuredClone(this.initial))
  }

  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.initial[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function searchResponse(): unknown {
  return {
    output_text: 'the answer',
    output: [
      {
        type: 'web_search_call',
        action: {
          type: 'search',
          sources: [
            { type: 'url', url: 'https://a.test', title: 'A' },
            { type: 'url', url: 'https://b.test', title: 'B' },
          ],
        },
      },
      {
        type: 'message',
        content: [{
          type: 'output_text',
          text: 'the answer',
          annotations: [
            { type: 'url_citation', url: 'https://b.test', title: 'B again' },
            { type: 'url_citation', url: 'https://c.test', title: 'C' },
          ],
        }],
      },
    ],
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('OpenAI Responses response mapping', () => {
  it('maps structured sources and URL citation annotations without duplication', () => {
    expect(mapOpenAiResponsesResponse(parseOpenAiResponsesResponse(searchResponse()))).toEqual({
      content: 'the answer',
      sources: [
        { url: 'https://a.test', title: 'A' },
        { url: 'https://b.test', title: 'B' },
        { url: 'https://c.test', title: 'C' },
      ],
      truncated: false,
    })
  })

  it('uses message output text when the top-level output_text is absent', () => {
    const result = mapOpenAiResponsesResponse(parseOpenAiResponsesResponse({
      output: [
        { type: 'web_search_call', action: { sources: [{ url: 'https://a.test' }] } },
        { type: 'message', content: [{ type: 'output_text', text: 'answer' }] },
      ],
    }))
    expect(result.content).toBe('answer')
  })

  it('rejects prose without a structured source', () => {
    expect(() => mapOpenAiResponsesResponse(parseOpenAiResponsesResponse({
      output_text: 'answer',
      output: [{ type: 'message', content: [{ type: 'output_text', text: 'answer' }] }],
    }))).toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('rejects malformed response envelopes at the parser boundary', () => {
    expect(() => parseOpenAiResponsesResponse({ output: {} })).toThrow(/output must be an array/)
    expect(() => parseOpenAiResponsesResponse({ output_text: 1 })).toThrow(/output_text must be a string/)
  })
})

describe('OpenAiResponsesSearchProvider availability', () => {
  it('is unavailable without a key or resolver', () => {
    expect(new OpenAiResponsesSearchProvider({ ...options, apiKey: '' }).available()).toBe(false)
  })

  it('is available with a key or a credential resolver', () => {
    expect(new OpenAiResponsesSearchProvider(options).available()).toBe(true)
    expect(new OpenAiResponsesSearchProvider({ ...options, apiKey: '', resolveApiKey: async () => 'resolved' }).available()).toBe(true)
  })

  it('rejects invalid endpoint, model, token budget, and domains', () => {
    expect(new OpenAiResponsesSearchProvider({ ...options, baseURL: 'not a url' }).available()).toBe(false)
    expect(new OpenAiResponsesSearchProvider({ ...options, model: '' }).available()).toBe(false)
    expect(new OpenAiResponsesSearchProvider({ ...options, maxOutputTokens: 0 }).available()).toBe(false)
    expect(new OpenAiResponsesSearchProvider({ ...options, allowedDomains: [''] }).available()).toBe(false)
  })
})

describe('OpenAiResponsesSearchProvider request mapping', () => {
  it('records and posts a Responses request with the native web_search tool', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(searchResponse()))
    const recordRequest = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await new OpenAiResponsesSearchProvider({ ...options, recordRequest }).search({ query: 'hello' })

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.openai.test/v1/responses')
    expect(init).toMatchObject({ method: 'POST', redirect: 'error' })
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer oa-key')
    const body = {
      model: 'gpt-5.5',
      tools: [{ type: 'web_search' }],
      tool_choice: 'auto',
      include: ['web_search_call.action.sources'],
      input: 'hello',
    }
    expect(JSON.parse(init.body as string)).toEqual(body)
    expect(recordRequest).toHaveBeenCalledWith({ endpoint: url, body })
    expect(recordRequest.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0] ?? 0)
  })

  it('sends domain filters, external access, and an output-token limit when configured', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(searchResponse()))
    vi.stubGlobal('fetch', fetchMock)
    await new OpenAiResponsesSearchProvider({
      ...options,
      allowedDomains: ['openai.com'],
      blockedDomains: ['example.com'],
      externalWebAccess: false,
      maxOutputTokens: 512,
    }).search({ query: 'q' })
    expect(JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({
      max_output_tokens: 512,
      tools: [{
        type: 'web_search',
        filters: { allowed_domains: ['openai.com'], blocked_domains: ['example.com'] },
        external_web_access: false,
      }],
    })
  })

  it('forwards the abort signal', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(searchResponse()))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    await new OpenAiResponsesSearchProvider(options).search({ query: 'q' }, controller.signal)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(init.signal).toBe(controller.signal)
  })
})

describe('OpenAiResponsesSearchProvider errors and registration', () => {
  it('reports a missing credential before dispatch', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(new OpenAiResponsesSearchProvider({ ...options, apiKey: '', apiKeyEnv: credentialRef('OPENAI_API_KEY') }).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CREDENTIAL_MISSING' }))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('resolves a credential per search', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(searchResponse()))
    vi.stubGlobal('fetch', fetchMock)
    await new OpenAiResponsesSearchProvider({ ...options, apiKey: '', resolveApiKey: async () => 'resolved-key' }).search({ query: 'q' })
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toMatchObject({ authorization: 'Bearer resolved-key' })
  })

  it('maps HTTP errors and malformed success bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: { message: 'rate limited' } }, { status: 429 })))
    await expect(new OpenAiResponsesSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR', message: 'rate limited' }))

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ output: {} })))
    await expect(new OpenAiResponsesSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_ERROR' }))
  })

  it('maps fetch aborts to WEB_ABORTED', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new DOMException('aborted', 'AbortError'))))
    await expect(new OpenAiResponsesSearchProvider(options).search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_ABORTED' }))
  })

  it('registers and disposes the provider through ctx.web', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(searchResponse())))
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: OPENAI_RESPONSES_PROVIDER_ID })
    const fiber = await ctx.plugin(openAiPlugin, { apiKey: 'oa-key' })
    await expect(ctx.web.search({ query: 'q' })).resolves.toMatchObject({ truncated: false })
    await fiber.dispose()
    await expect(ctx.web.search({ query: 'q' }))
      .rejects.toThrow(expect.objectContaining({ code: 'WEB_PROVIDER_CONFIGURED_MISSING' }))
    await ctx.fiber.dispose()
  })

  it('projects the live web-search-openai settings section into the next request', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(searchResponse()))
    vi.stubGlobal('fetch', fetchMock)
    const ctx = new Context()
    await ctx.plugin(WebRuntime, { searchProvider: OPENAI_RESPONSES_PROVIDER_ID })
    await ctx.plugin(MemorySettings, {
      'web-search-openai': {
        baseURL: 'https://settings.openai.test/v1',
        model: 'settings-model',
        maxOutputTokens: 321,
      },
    })
    await ctx.plugin(openAiPlugin, {
      apiKey: 'oa-key',
      baseURL: 'https://base.openai.test/v1',
      model: 'base-model',
    })

    await expect(ctx.web.search({ query: 'settings' })).resolves.toMatchObject({ truncated: false })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://settings.openai.test/v1/responses')
    expect(JSON.parse(init.body as string)).toMatchObject({ model: 'settings-model', max_output_tokens: 321 })
    await ctx.fiber.dispose()
  })
})
