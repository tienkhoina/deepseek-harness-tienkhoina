/**
 * Register an OpenAI Responses-backed search provider in `ctx.web`. The
 * provider calls the native Responses `web_search` server tool and does not
 * register a model-facing tool or depend on `ctx.llm`.
 * @module @deepseek-ai/dsh-web-search-openai
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-web'
import {
  OpenAiResponsesSearchProvider,
  OPENAI_RESPONSES_DEFAULT_API_KEY_ENV,
  OPENAI_RESPONSES_DEFAULT_BASE_URL,
  OPENAI_RESPONSES_DEFAULT_MODEL,
} from './provider.ts'
import type { OpenAiResponsesSearchProviderOptions } from './provider.ts'

export {
  OpenAiResponsesSearchProvider,
  OPENAI_RESPONSES_DEFAULT_API_KEY_ENV,
  OPENAI_RESPONSES_DEFAULT_BASE_URL,
  OPENAI_RESPONSES_DEFAULT_MODEL,
  OPENAI_RESPONSES_PROVIDER_ID,
  mapOpenAiResponsesResponse,
  parseOpenAiResponsesResponse,
} from './provider.ts'
export type { OpenAiResponsesSearchLlmRequest, OpenAiResponsesSearchProviderOptions } from './provider.ts'
export type {
  OpenAiResponsesError,
  OpenAiResponsesMessage,
  OpenAiResponsesOutputItem,
  OpenAiResponsesOutputText,
  OpenAiResponsesRequest,
  OpenAiResponsesResponse,
  OpenAiResponsesUrlCitation,
  OpenAiResponsesWebSearchAction,
  OpenAiResponsesWebSearchCall,
  OpenAiResponsesWebSearchFilters,
  OpenAiResponsesWebSearchTool,
  OpenAiResponsesWebSource,
} from './types.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'web-search-openai'

/** The web seam this provider registers into. */
export const inject = ['web']

/** Settings namespace carrying this provider's endpoint and request options. */
export const WEB_SEARCH_OPENAI_SETTINGS_NAMESPACE = settingsNamespace('web-search-openai')

/** Environment variable naming the endpoint base. */
const OPENAI_RESPONSES_BASE_URL_ENV = 'OPENAI_RESPONSES_BASE_URL'

/** Plugin configuration. All values except the secret are safe to expose in a config catalog. */
export interface Config {
  /** Literal OpenAI API key; prefer {@link apiKeyEnv} for deployment configuration. */
  apiKey?: string
  /** Credential reference resolved for each search. */
  apiKeyEnv?: string
  /** Endpoint base; `/responses` is appended. */
  baseURL?: string
  /** Responses model name. */
  model?: string
  /** Optional maximum output-token budget for the auxiliary request. */
  maxOutputTokens?: number
  /** Optional reasoning effort level: 'low', 'medium', 'high', 'xhigh'. */
  reasoningEffort?: 'low' | 'medium' | 'high' | 'xhigh'
  /** Optional modalities supported by the model (text, audio, image). */
  modalities?: ('text' | 'audio' | 'image')[]
  /** Optional temperature (0-2) for response generation. */
  temperature?: number
  /** Optional top_p (0-1) for nucleus sampling. */
  topP?: number
  /** Optional tool choice: 'auto' (default) or 'required'. */
  toolChoice?: 'auto' | 'required'
  /** Optional search context size: 'low', 'medium', 'high'. */
  searchContextSize?: 'low' | 'medium' | 'high'
  /** Optional return token budget: 'default' or 'unlimited'. */
  returnTokenBudget?: 'default' | 'unlimited'
  /** Optional domain allowlist passed to OpenAI web search. */
  allowedDomains?: string[]
  /** Optional domain blocklist passed to OpenAI web search. */
  blockedDomains?: string[]
  /** Set false to use cached/indexed results without live external access. */
  externalWebAccess?: boolean
  /** Optional background mode for asynchronous processing. */
  background?: boolean
}

export const Config: z<Config> = z.object({
  apiKey: z.string().role('secret'),
  apiKeyEnv: z.string().role('credential-ref').default(OPENAI_RESPONSES_DEFAULT_API_KEY_ENV),
  baseURL: z.string(),
  model: z.string().default(OPENAI_RESPONSES_DEFAULT_MODEL),
  maxOutputTokens: z.number().step(1).min(1),
  reasoningEffort: z.union([
    z.const('low'),
    z.const('medium'),
    z.const('high'),
    z.const('xhigh'),
  ]).description('Reasoning effort level for the model'),
  modalities: z.array(z.union([
    z.const('text'),
    z.const('audio'),
    z.const('image'),
  ])).description('Modalities supported by the model'),
  temperature: z.number().min(0).max(2).description('Sampling temperature (0-2)'),
  topP: z.number().min(0).max(1).description('Nucleus sampling top_p (0-1)'),
  toolChoice: z.union([
    z.const('auto'),
    z.const('required'),
  ]).description('Tool choice strategy'),
  searchContextSize: z.union([
    z.const('low'),
    z.const('medium'),
    z.const('high'),
  ]).description('Search context size'),
  returnTokenBudget: z.union([
    z.const('default'),
    z.const('unlimited'),
  ]).description('Return token budget'),
  allowedDomains: z.array(z.string()),
  blockedDomains: z.array(z.string()),
  externalWebAccess: z.boolean(),
  background: z.boolean().description('Enable background processing mode'),
})

function resolveOptions(ctx: Context, config: Config): OpenAiResponsesSearchProviderOptions {
  const apiKeyEnv = credentialRef(config.apiKeyEnv ?? OPENAI_RESPONSES_DEFAULT_API_KEY_ENV)
  const literalApiKey = config.apiKey !== undefined && config.apiKey.length > 0
    ? config.apiKey
    : undefined
  return {
    ...literalApiKey === undefined ? {} : { apiKey: literalApiKey },
    resolveApiKey: async () => {
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) {
        const resolved = await credentials.resolve(apiKeyEnv)
        return resolved?.value
      }
      const ambient = launchEnvironmentOf(ctx).get(apiKeyEnv)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
    apiKeyEnv,
    baseURL: config.baseURL
      ?? launchEnvironmentOf(ctx).get(OPENAI_RESPONSES_BASE_URL_ENV)?.value
      ?? OPENAI_RESPONSES_DEFAULT_BASE_URL,
    model: config.model ?? OPENAI_RESPONSES_DEFAULT_MODEL,
    ...config.maxOutputTokens === undefined ? {} : { maxOutputTokens: config.maxOutputTokens },
    ...config.reasoningEffort === undefined ? {} : { reasoningEffort: config.reasoningEffort },
    ...config.modalities === undefined ? {} : { modalities: config.modalities },
    ...config.temperature === undefined ? {} : { temperature: config.temperature },
    ...config.topP === undefined ? {} : { topP: config.topP },
    ...config.toolChoice === undefined ? {} : { toolChoice: config.toolChoice },
    ...config.searchContextSize === undefined ? {} : { searchContextSize: config.searchContextSize },
    ...config.returnTokenBudget === undefined ? {} : { returnTokenBudget: config.returnTokenBudget },
    ...config.allowedDomains === undefined ? {} : { allowedDomains: config.allowedDomains },
    ...config.blockedDomains === undefined ? {} : { blockedDomains: config.blockedDomains },
    ...config.externalWebAccess === undefined ? {} : { externalWebAccess: config.externalWebAccess },
    ...config.background === undefined ? {} : { background: config.background },
    recordRequest: (request) => {
      ctx.get('agents')?.currentInitiator()?.session.append(
        'web/openai-responses-search-llm-request',
        request,
      )
    },
  }
}

/** Register the OpenAI Responses search provider with `ctx.web`. */
export function apply(ctx: Context, config: Config): void {
  let current: () => Config = () => config
  installSettingsSection(ctx, WEB_SEARCH_OPENAI_SETTINGS_NAMESPACE, Config, config, {
    setSource: (source) => {
      current = source
    },
    onChange: () => {},
  })
  ctx.web.registerSearchProvider(new OpenAiResponsesSearchProvider(() => resolveOptions(ctx, current())))
}
