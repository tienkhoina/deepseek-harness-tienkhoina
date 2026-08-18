# @deepseek-ai/dsh-web-search-openai

English | [中文](README.zh.md)

An [OpenAI](https://openai.com) Responses-backed `WebSearchProvider` for the harness [web capability seam](../web/README.md) (`ctx.web`). It calls `POST {baseURL}/responses` with the native Responses `web_search` server tool and maps structured sources and URL citations into the seam's normalized `WebSearchResult`.

This is an implementation package: it registers a provider into `ctx.web`, resolves `OPENAI_API_KEY` through the optional `ctx.credentials` seam for each search, records the secret-free auxiliary request in the initiating Agent session when one exists, and does not register a model-facing tool. The provider is intentionally independent of `ctx.llm`; the OpenAI server tool is a provider-private Responses wire detail.

## Config

| Key | Default | Meaning |
|---|---|---|
| `apiKey` | omitted | Literal OpenAI API key. Prefer `apiKeyEnv` so no secret enters configuration; a non-empty literal wins. |
| `apiKeyEnv` | `OPENAI_API_KEY` | Credential reference resolved for each search through `ctx.credentials`, or from the launching environment when that seam is absent. A missing value fails the call as `WEB_PROVIDER_CREDENTIAL_MISSING`. |
| `baseURL` | `https://api.openai.com/v1` | Responses API base; `/responses` is appended. Falls back to `$OPENAI_RESPONSES_BASE_URL`. An unparseable value makes the provider unavailable. |
| `model` | `gpt-5.5` | Responses model used for the auxiliary search request. |
| `maxOutputTokens` | omitted | Optional positive-integer output-token limit. |
| `allowedDomains` | omitted | Optional domain allowlist passed as the Responses web-search filter. |
| `blockedDomains` | omitted | Optional domain blocklist passed as the Responses web-search filter. |
| `externalWebAccess` | omitted | Optional OpenAI web-search setting; set `false` to request cached or indexed results without live external access. |

The plugin registers the `web-search-openai` Settings section. The Plugins settings card selects this provider through the `web` section and edits these provider fields without placing the API key in the settings document; the key is written through the credentials domain under `apiKeyEnv`.

The base bundle mounts this provider as `web-search-openai` but keeps `deepseek-official` selected for existing profiles. Select the OpenAI route in a Cordis overlay:

```yaml
- id: web
  config:
    searchProvider: openai-responses
- id: web-search-openai
  config:
    apiKeyEnv: OPENAI_API_KEY
    model: gpt-5.5
```

Configuration is resolved when a search starts, so credential rotation reaches the next request. The provider id is `openai-responses`; it must be selected explicitly when more than one usable search provider is registered. The Plugins settings card saves `web.searchProvider: openai-responses` for this selection.

## Request and mapping

Each search sends the query as Responses `input`, one native `{ type: 'web_search' }` tool with `tool_choice: 'auto'`, and `include: ['web_search_call.action.sources']`. Sources come from structured `web_search_call.action.sources` entries and `url_citation` annotations, are restricted to HTTP(S), and are deduplicated by URL. `output_text` or message `output_text` blocks become normalized `content`.

The provider never extracts URLs from ordinary model prose. If the response contains no structured source, it throws `WebError` `WEB_PROVIDER_ERROR` rather than returning an uncited answer. The shared seam enforces `maxResults` after mapping and sets `truncated` when it drops sources.

## Request logging

Immediately before dispatch, a search running under an initiating Agent appends the log-only `web/openai-responses-search-llm-request` session event. It contains the resolved endpoint and exact secret-free JSON body; headers and credentials are excluded. Credential failures and cancellation before dispatch create no event, while later HTTP or response failures leave the attempted request durable. Direct provider calls outside an Agent have no session to log.

## Model Experience

### Auxiliary OpenAI Responses search request

#### What the model sees

An independent OpenAI Responses request receives the query as `input` and the native `web_search` server tool. This request is separate from the conversation model request and its server-side tool call is not exposed as a model-facing function schema by this package.

#### Token effect

Each search incurs separate Responses input and output usage. `maxOutputTokens` can cap generated output, but the provider does not promise a fixed source count because the native tool controls retrieval.

#### KV Cache effect

The auxiliary request has its own cache context. The stable model, tool, and instruction prefix can be reused by the upstream service, while a changed query or route differs from its first changed token.

### Conversation tool result, indirectly

#### What the model sees

Through [`dsh-tool-web`](../tool-web/README.md), the conversation model sees normalized content and deduplicated URLs and titles from structured Responses output. It does not receive the provider's hidden API key, request headers, or session-only request event.

#### Token effect

Registration produces no conversation tokens. The result added by `dsh-tool-web` grows with the returned content and sources, then the web seam applies the consumer's source bound.

#### KV Cache effect

The tool result is appended to the conversation after the auxiliary call; a new result changes the subsequent conversation prefix but does not alter earlier cached request material.

## Known Limitations and Deferred Work

- **The native server tool is not a model-facing function tool** — `dsh-llm-pi-ai` remains responsible for conversation model tool schemas, while this provider calls OpenAI Responses directly.
- **One search is a separate Responses request** — latency and usage are additional to the conversation turn, and no dedicated retrieval-only cost or source-count guarantee is exposed here.
- **Synchronous availability cannot query an asynchronous credential store** — a selected provider with a resolver but no usable key can still fail at execution with `WEB_PROVIDER_CREDENTIAL_MISSING`.
- **Structured citations are required** — an answer without `web_search_call.action.sources` or URL annotations is rejected instead of being converted from prose.
- **The card is provider-specific** — the shared Plugins card exposes this package's endpoint, model, output-token limit, domain filters, and external-access settings; conversation model settings remain owned by their LLM providers.
