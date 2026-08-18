/**
 * Provider-private wire types for OpenAI's Responses web search tool. These
 * types stay outside the shared web seam and do not create a dependency on
 * `ctx.llm`.
 * @module @deepseek-ai/dsh-web-search-openai/types
 */

/** Domain filters accepted by the Responses web search tool. */
export interface OpenAiResponsesWebSearchFilters {
  readonly allowed_domains?: readonly string[]
  readonly blocked_domains?: readonly string[]
}

/** Search context size for web search tool. */
export type SearchContextSize = 'low' | 'medium' | 'high'

/** Return token budget for web search tool. */
export type ReturnTokenBudget = 'default' | 'unlimited'

/** Reasoning effort levels. */
export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh'

/** Reasoning configuration. */
export interface ReasoningConfig {
  readonly effort?: ReasoningEffort
}

/** Modality types supported by the model. */
export type Modality = 'text' | 'audio' | 'image'

/** The server-side web search tool sent in a Responses request. */
export interface OpenAiResponsesWebSearchTool {
  readonly type: 'web_search'
  readonly filters?: OpenAiResponsesWebSearchFilters
  readonly external_web_access?: boolean
  readonly search_context_size?: SearchContextSize
  readonly return_token_budget?: ReturnTokenBudget
}

/** Message format for input array. */
export interface OpenAiResponsesInputMessage {
  readonly role: string
  readonly content: string
}

/** Exact secret-free request body recorded before one Responses dispatch. */
export interface OpenAiResponsesRequest {
  readonly model: string
  readonly input: string | ReadonlyArray<OpenAiResponsesInputMessage>
  readonly tools?: ReadonlyArray<OpenAiResponsesWebSearchTool>
  readonly tool_choice?: 'auto' | 'required'
  readonly include?: ReadonlyArray<string>
  readonly max_output_tokens?: number
  readonly reasoning?: ReasoningConfig
  readonly modalities?: ReadonlyArray<Modality>
  readonly temperature?: number
  readonly top_p?: number
  readonly background?: boolean
}

/** One source returned in `web_search_call.action.sources`. */
export interface OpenAiResponsesWebSource {
  readonly type?: string
  readonly url?: string
  readonly title?: string | null
}

/** One URL citation annotation attached to Responses output text. */
export interface OpenAiResponsesUrlCitation {
  readonly type: 'url_citation'
  readonly url?: string | null
  readonly title?: string | null
}

/** A text content item inside a Responses message output item. */
export interface OpenAiResponsesOutputText {
  readonly type: 'output_text'
  readonly text?: string | null
  readonly annotations?: readonly OpenAiResponsesUrlCitation[]
}

/** A Responses message output item. */
export interface OpenAiResponsesMessage {
  readonly type: 'message'
  readonly content?: readonly OpenAiResponsesOutputText[]
}

/** The action attached to a Responses web search call. */
export interface OpenAiResponsesWebSearchAction {
  readonly type?: string
  readonly sources?: readonly OpenAiResponsesWebSource[]
}

/** A Responses web search call output item. */
export interface OpenAiResponsesWebSearchCall {
  readonly type: 'web_search_call'
  readonly action?: OpenAiResponsesWebSearchAction
}

/** Output items not interpreted by this provider. */
export interface OpenAiResponsesOtherOutputItem {
  readonly type: string
}

/** Output item vocabulary consumed by the provider. */
export type OpenAiResponsesOutputItem =
  | OpenAiResponsesMessage
  | OpenAiResponsesWebSearchCall
  | OpenAiResponsesOtherOutputItem

/** OpenAI Responses success envelope. */
export interface OpenAiResponsesResponse {
  readonly output?: readonly OpenAiResponsesOutputItem[]
  readonly output_text?: string | null
}

/** Best-effort OpenAI error envelope; fields vary across gateways. */
export interface OpenAiResponsesError {
  readonly error?: { readonly message?: string } | string
  readonly message?: string
}
