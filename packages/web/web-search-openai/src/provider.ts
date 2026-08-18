/**
 * OpenAI Responses search through the native `web_search` server tool. The
 * provider maps structured search sources and URL annotations into the shared
 * web result and never extracts URLs from unstructured prose.
 * @module @deepseek-ai/dsh-web-search-openai/provider
 */

import { WebError } from '@deepseek-ai/dsh-web'
import type {
  WebSearchProvider,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from '@deepseek-ai/dsh-web'
import type { CredentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-session'
import type {
  OpenAiResponsesError,
  OpenAiResponsesMessage,
  OpenAiResponsesOutputItem,
  OpenAiResponsesOutputText,
  OpenAiResponsesRequest,
  OpenAiResponsesResponse,
  OpenAiResponsesUrlCitation,
  OpenAiResponsesWebSearchCall,
  OpenAiResponsesWebSearchTool,
  OpenAiResponsesWebSource,
  ReasoningEffort,
  SearchContextSize,
  ReturnTokenBudget,
  Modality,
} from './types.ts'

/** Stable id this provider registers under. */
export const OPENAI_RESPONSES_PROVIDER_ID = 'openai-responses'

/** Default OpenAI API base; `/responses` is appended. */
export const OPENAI_RESPONSES_DEFAULT_BASE_URL = 'https://api.openai.com/v1'

/** Default model for the Responses web search request. */
export const OPENAI_RESPONSES_DEFAULT_MODEL = 'gpt-5.5'

/** Default credential reference used by the provider plugin. */
export const OPENAI_RESPONSES_DEFAULT_API_KEY_ENV = 'OPENAI_API_KEY'

/** Exact secret-free auxiliary request logged before dispatch. */
export interface OpenAiResponsesSearchLlmRequest {
  /** Fully resolved Responses endpoint. */
  readonly endpoint: string
  /** Exact JSON body sent to OpenAI. */
  readonly body: OpenAiResponsesRequest
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Secret-free auxiliary OpenAI Responses web search request. */
    'web/openai-responses-search-llm-request': OpenAiResponsesSearchLlmRequest
  }
}

/** Resolved provider options supplied by the plugin's configuration layer. */
export interface OpenAiResponsesSearchProviderOptions {
  /** Literal OpenAI API key; when present it wins over {@link resolveApiKey}. */
  apiKey?: string
  /** Resolve the current OpenAI API key for one search operation. */
  resolveApiKey?: () => Promise<string | undefined>
  /** Credential reference named by missing-credential diagnostics. */
  apiKeyEnv?: CredentialRef
  /** Endpoint base; `/responses` is appended. */
  baseURL: string
  /** Responses model name. */
  model: string
  /** Optional maximum output-token budget sent to Responses. */
  maxOutputTokens?: number
  /** Optional reasoning effort level: 'low', 'medium', 'high', 'xhigh'. */
  reasoningEffort?: ReasoningEffort
  /** Optional modalities (text, audio, image). */
  modalities?: readonly Modality[]
  /** Optional temperature (0-2). */
  temperature?: number
  /** Optional top_p (0-1). */
  topP?: number
  /** Optional tool choice: 'auto' or 'required'. */
  toolChoice?: 'auto' | 'required'
  /** Optional search context size: 'low', 'medium', 'high'. */
  searchContextSize?: SearchContextSize
  /** Optional return token budget: 'default' or 'unlimited'. */
  returnTokenBudget?: ReturnTokenBudget
  /** Optional Responses web-search domain allowlist. */
  allowedDomains?: readonly string[]
  /** Optional Responses web-search domain blocklist. */
  blockedDomains?: readonly string[]
  /** Optional cache-only web access mode. */
  externalWebAccess?: boolean
  /** Optional background mode for async processing. */
  background?: boolean
  /** Record the exact secret-free request immediately before dispatch. */
  recordRequest?: (request: OpenAiResponsesSearchLlmRequest) => void
}

/**
 * Parse a Responses JSON value at the wire boundary. Unsupported output item
 * kinds are retained by tag; malformed known fields are gracefully ignored.
 *
 * @param value - decoded JSON from the Responses endpoint.
 * @returns the provider-private response envelope.
 */
export function parseOpenAiResponsesResponse(value: unknown): OpenAiResponsesResponse {
  if (!isRecord(value)) {
    // If not even an object, return empty response
    return {}
  }

  const outputValue = value.output
  let output: OpenAiResponsesOutputItem[] | undefined
  if (outputValue !== undefined) {
    if (Array.isArray(outputValue)) {
      output = outputValue.map(parseOutputItem).filter(item => item !== null)
    }
    // Silently ignore non-array output
  }

  const outputText = value.output_text
  let validOutputText: string | undefined
  if (outputText !== undefined && outputText !== null && typeof outputText === 'string') {
    validOutputText = outputText
  }

  return {
    ...output === undefined || output.length === 0 ? {} : { output },
    ...validOutputText === undefined ? {} : { output_text: validOutputText },
  }
}

/**
 * Map structured Responses web-search output to the shared web result. Source
 * items and URL annotations are both structured provider fields; prose alone
 * is never treated as a citation source.
 *
 * @param response - parsed Responses response.
 * @returns normalized content and citeable sources.
 */
export function mapOpenAiResponsesResponse(response: OpenAiResponsesResponse): WebSearchResult {
  const byUrl = new Map<string, WebSearchSource>()
  const text: string[] = []
  let hasWebSearchCall = false

  for (const item of response.output ?? []) {
    if (item.type === 'web_search_call') {
      hasWebSearchCall = true
      for (const source of (item as OpenAiResponsesWebSearchCall).action?.sources ?? []) {
        addSource(byUrl, source.url, source.title)
      }
      continue
    }
    if (item.type !== 'message') continue
    for (const content of (item as OpenAiResponsesMessage).content ?? []) {
      if (content.text != null && content.text.length > 0) text.push(content.text)
      for (const annotation of content.annotations ?? []) {
        addSource(byUrl, annotation.url, annotation.title)
      }
    }
  }

  const answer = response.output_text != null && response.output_text.length > 0
    ? response.output_text
    : text.join('')

  // If web_search_call was present but no URL sources were extracted, still return the answer
  // (the model may have used API sources like weather data that don't have URLs)
  // Only fail if there's no web_search_call AND no answer text
  if (byUrl.size === 0 && !hasWebSearchCall && answer.length === 0) {
    throw new WebError(
      'OpenAI Responses returned no structured web search sources and no text content',
      'WEB_PROVIDER_ERROR',
    )
  }

  return {
    ...answer.length > 0 ? { content: answer } : {},
    sources: [...byUrl.values()],
    truncated: false,
  }
}

/** The OpenAI Responses-backed search provider. */
export class OpenAiResponsesSearchProvider implements WebSearchProvider {
  readonly id = OPENAI_RESPONSES_PROVIDER_ID

  /**
   * @param resolveOptions - options or a resolver that snapshots options at the
   * start of each search.
   */
  constructor(
    private readonly optionsOrResolver:
      | OpenAiResponsesSearchProviderOptions
      | (() => OpenAiResponsesSearchProviderOptions),
  ) {}

  available(): boolean {
    const options = this.options()
    const hasKey = (options.apiKey?.length ?? 0) > 0 || options.resolveApiKey !== undefined
    const hasBaseURL = URL.canParse(options.baseURL)
    const hasModel = options.model.length > 0
    const hasValidMaxTokens = options.maxOutputTokens === undefined || isPositiveInteger(options.maxOutputTokens)
    const hasValidAllowedDomains = domainsAreUsable(options.allowedDomains)
    const hasValidBlockedDomains = domainsAreUsable(options.blockedDomains)

    return hasKey && hasBaseURL && hasModel && hasValidMaxTokens && hasValidAllowedDomains && hasValidBlockedDomains
  }

  async search(request: WebSearchRequest, signal?: AbortSignal): Promise<WebSearchResult> {
    const options = this.options()
    const apiKey = await this.apiKey(options, signal)
    throwIfSearchAborted(signal)
    const endpoint = `${options.baseURL.replace(/\/+$/u, '')}/responses`
    const body = requestBody(options, request.query)

    options.recordRequest?.({ endpoint, body })
    throwIfSearchAborted(signal)

    let response: Response
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        redirect: 'error',
        headers: {
          'authorization': `Bearer ${apiKey}`,
          'content-type': 'application/json',
          'accept': 'application/json',
          'user-agent': 'deepseek-harness/0.0.1',
        },
        body: JSON.stringify(body),
        ...signal !== undefined ? { signal } : {},
      })
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`OpenAI Responses search request failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }

    if (!response.ok) {
      const status = response.status
      let message = `OpenAI Responses API error (HTTP ${status})`
      try {
        const raw: unknown = await response.json()
        const detail = errorMessage(raw)
        if (detail !== undefined && detail.length > 0) message = detail
      } catch (error: unknown) {
        if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      }
      throw new WebError(message, 'WEB_PROVIDER_ERROR')
    }

    try {
      const raw: unknown = await response.json()
      const parsed = parseOpenAiResponsesResponse(raw)
      return mapOpenAiResponsesResponse(parsed)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      if (error instanceof WebError) throw error
      throw new WebError(`OpenAI Responses returned an unprocessable response body: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
  }

  private async apiKey(options: OpenAiResponsesSearchProviderOptions, signal?: AbortSignal): Promise<string> {
    throwIfSearchAborted(signal)
    if (options.apiKey !== undefined && options.apiKey.length > 0) return options.apiKey
    let resolved: string | undefined
    try {
      resolved = await abortable(options.resolveApiKey?.() ?? Promise.resolve(undefined), signal)
    } catch (error: unknown) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error)
      throw new WebError(`OpenAI Responses search credential resolution failed: ${String(error)}`, 'WEB_PROVIDER_ERROR', { cause: error })
    }
    if (resolved !== undefined && resolved.length > 0) return resolved
    const ref = options.apiKeyEnv ?? OPENAI_RESPONSES_DEFAULT_API_KEY_ENV
    throw new WebError(
      `OpenAI Responses search has no API key for "${ref}"; store it through the credentials service`
      + ' or export it in the launching environment',
      'WEB_PROVIDER_CREDENTIAL_MISSING',
    )
  }

  private options(): OpenAiResponsesSearchProviderOptions {
    return typeof this.optionsOrResolver === 'function'
      ? this.optionsOrResolver()
      : this.optionsOrResolver
  }
}

function requestBody(options: OpenAiResponsesSearchProviderOptions, query: string): OpenAiResponsesRequest {
  // Build tool configuration
  const filters: { allowed_domains?: readonly string[]; blocked_domains?: readonly string[] } = {}
  if (options.allowedDomains !== undefined && options.allowedDomains.length > 0) {
    filters.allowed_domains = options.allowedDomains
  }
  if (options.blockedDomains !== undefined && options.blockedDomains.length > 0) {
    filters.blocked_domains = options.blockedDomains
  }

  const tool: OpenAiResponsesWebSearchTool = {
    type: 'web_search',
    ...Object.keys(filters).length > 0 ? { filters } : {},
    ...options.externalWebAccess !== undefined ? { external_web_access: options.externalWebAccess } : {},
    ...options.searchContextSize !== undefined ? { search_context_size: options.searchContextSize } : {},
    ...options.returnTokenBudget !== undefined ? { return_token_budget: options.returnTokenBudget } : {},
  }

  // Build reasoning config
  const reasoning = options.reasoningEffort !== undefined
    ? { effort: options.reasoningEffort }
    : undefined

  return {
    model: options.model,
    input: query,
    tools: [tool],
    include: ['web_search_call.action.sources'],
    ...options.toolChoice !== undefined ? { tool_choice: options.toolChoice } : {},
    ...options.maxOutputTokens !== undefined ? { max_output_tokens: options.maxOutputTokens } : {},
    ...reasoning !== undefined ? { reasoning } : {},
    ...options.modalities !== undefined && options.modalities.length > 0 ? { modalities: options.modalities } : {},
    ...options.temperature !== undefined ? { temperature: options.temperature } : {},
    ...options.topP !== undefined ? { top_p: options.topP } : {},
    ...options.background !== undefined ? { background: options.background } : {},
  }
}

function addSource(map: Map<string, WebSearchSource>, url: string | null | undefined, title: string | null | undefined): void {
  if (url === undefined || url === null || !isHttpUrl(url)) return
  const cleanTitle = title !== undefined && title !== null && title.length > 0 ? title : undefined
  const previous = map.get(url)
  if (previous === undefined) {
    map.set(url, { url, ...cleanTitle === undefined ? {} : { title: cleanTitle } })
  } else if (previous.title === undefined && cleanTitle !== undefined) {
    map.set(url, { ...previous, title: cleanTitle })
  }
}

function parseOutputItem(value: unknown): OpenAiResponsesOutputItem | null {
  if (!isRecord(value) || typeof value.type !== 'string') return null

  if (value.type === 'web_search_call') {
    const action = parseSearchAction(value.action)
    return { type: 'web_search_call', ...action === undefined ? {} : { action } }
  }

  if (value.type === 'message') {
    const contentValue = value.content
    if (contentValue !== undefined && !Array.isArray(contentValue)) return null
    const content = contentValue?.flatMap(parseOutputText).filter(c => c !== null)
    return { type: 'message', ...content === undefined || content.length === 0 ? {} : { content } }
  }

  // Return unknown types as-is
  return { type: value.type }
}

function parseSearchAction(value: unknown): OpenAiResponsesWebSearchCall['action'] {
  if (value === undefined) return undefined
  if (!isRecord(value)) return undefined // Gracefully skip invalid actions

  const sourcesValue = value.sources

  // Handle sources field - can be array, object, or missing
  let sources: OpenAiResponsesWebSource[] | undefined
  if (sourcesValue !== undefined && sourcesValue !== null) {
    try {
      if (Array.isArray(sourcesValue)) {
        sources = sourcesValue.map(parseSource).filter(s => s !== null)
      } else if (isRecord(sourcesValue)) {
        // Single source as object
        const parsed = parseSource(sourcesValue)
        if (parsed !== null) sources = [parsed]
      }
      // Silently ignore other types (strings, numbers, etc.)
    } catch {
      // Silently ignore parse errors for sources
    }
  }

  return {
    ...typeof value.type === 'string' ? { type: value.type } : {},
    ...sources === undefined ? {} : { sources },
  }
}

function parseSource(value: unknown): OpenAiResponsesWebSource | null {
  if (!isRecord(value)) return null

  // Validate types but don't throw - return null on invalid data
  if (value.url !== undefined && value.url !== null && typeof value.url !== 'string') return null
  if (value.title !== undefined && value.title !== null && typeof value.title !== 'string') return null

  return {
    ...typeof value.type === 'string' ? { type: value.type } : {},
    ...value.url === undefined || value.url === null ? {} : { url: value.url },
    ...value.title === undefined ? {} : { title: value.title },
  }
}

function parseOutputText(value: unknown): OpenAiResponsesOutputText[] {
  if (!isRecord(value) || value.type !== 'output_text') return []

  // Validate text field but don't throw
  if (value.text !== undefined && value.text !== null && typeof value.text !== 'string') return []

  const annotationsValue = value.annotations
  // Validate annotations but don't throw
  if (annotationsValue !== undefined && !Array.isArray(annotationsValue)) return []

  const annotations = annotationsValue?.flatMap(parseAnnotation).filter(a => a !== null)
  return [{
    type: 'output_text',
    ...value.text === undefined ? {} : { text: value.text },
    ...annotations === undefined || annotations.length === 0 ? {} : { annotations },
  }]
}

function parseAnnotation(value: unknown): OpenAiResponsesUrlCitation[] {
  if (!isRecord(value) || value.type !== 'url_citation') return []

  // Validate url and title but don't throw
  if (value.url !== undefined && value.url !== null && typeof value.url !== 'string') return []
  if (value.title !== undefined && value.title !== null && typeof value.title !== 'string') return []

  return [{
    type: 'url_citation',
    ...value.url === undefined ? {} : { url: value.url },
    ...value.title === undefined ? {} : { title: value.title },
  }]
}

function errorMessage(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined
  const error = value as OpenAiResponsesError
  if (typeof error.error === 'string') return error.error
  if (isRecord(error.error) && typeof error.error.message === 'string') return error.error.message
  return typeof error.message === 'string' ? error.message : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHttpUrl(value: string): boolean {
  if (!URL.canParse(value)) return false
  const protocol = new URL(value).protocol
  return protocol === 'http:' || protocol === 'https:'
}

function domainsAreUsable(domains: readonly string[] | undefined): boolean {
  return domains === undefined || domains.every(domain => domain.length > 0)
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}

function abortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal === undefined) return operation
  if (signal.aborted) return Promise.reject(searchAborted(signal))
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => { reject(searchAborted(signal)) }
    signal.addEventListener('abort', onAbort, { once: true })
    void operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort)
        reject(error instanceof Error ? error : new Error(String(error), { cause: error }))
      },
    )
  })
}

function throwIfSearchAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw searchAborted(signal)
}

function searchAborted(signal?: AbortSignal, fallback?: unknown): WebError {
  return new WebError('OpenAI Responses search aborted', 'WEB_ABORTED', {
    cause: signal?.aborted === true ? signal.reason : fallback,
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
