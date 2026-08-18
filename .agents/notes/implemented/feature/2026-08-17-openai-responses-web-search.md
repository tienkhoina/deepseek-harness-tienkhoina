# Agent Note: OpenAI Responses native web search provider

Status: implemented

English | [中文](2026-08-17-openai-responses-web-search.zh.md)

## Problem

The harness already exposes a provider-neutral `ctx.web.search()` capability and mounts DeepSeek native web search, but deployments that use OpenAI Responses need the same capability to call OpenAI's native `web_search` server tool. Routing that through `dsh-llm-pi-ai` would turn a provider-private Responses request into a conversation-model tool schema and would couple the web provider to the LLM adapter's function-tool vocabulary.

## Decision

- Add `@deepseek-ai/dsh-web-search-openai` as a complete `dsh-web` Service Provider package. It registers `openai-responses`, calls `POST {baseURL}/responses`, sends `{ type: 'web_search' }`, and maps structured `web_search_call.action.sources` plus `url_citation` annotations into `WebSearchResult`.
- Keep the provider private to the web capability. It does not use `ctx.llm` or register a model-facing function tool; `dsh-tool-web` remains the only owner of the conversation-facing `web_search` schema and result presentation.
- Resolve `OPENAI_API_KEY` through `ctx.credentials` for each search, fall back to the launching environment when credentials are not mounted, and append a secret-free `web/openai-responses-search-llm-request` event before dispatch when an initiating session exists.
- Mount the provider in the base bundle as an explicit alternative while retaining `deepseek-official` as the selected default. An overlay opts in with `web.config.searchProvider: openai-responses`.
- Register the `web` Settings namespace for live provider selection and the `web-search-openai` Settings namespace for OpenAI-specific fields. The Plugins card selects between the DeepSeek and OpenAI registrations, writes provider fields to their owning namespaces, and writes each API key through credentials rather than settings.
- Require structured sources. A response containing only prose is a `WEB_PROVIDER_ERROR`; the provider never invents citations by scraping URLs from text. URL sources are deduplicated, restricted to HTTP(S), and normalized through the existing seam.

## Alternatives considered

- **Extend `dsh-llm-pi-ai` with an OpenAI-specific tool schema** — rejected because the Responses `web_search` item is a server-side tool and does not belong in the conversation model's function-tool list; it would also make the LLM adapter own web-provider behavior.
- **Replace the base DeepSeek route with OpenAI** — rejected because existing profiles use `DEEPSEEK_API_KEY` and would change their default backend without an overlay decision.
- **Parse URLs from response prose** — rejected because an uncited answer cannot establish provenance; the provider fails closed when structured sources are absent.
- **Store the API key in the settings document** — rejected because secret-role fields must not be returned by settings descriptions; the UI writes credentials through the existing credential reference plane.

## Consequences

OpenAI web search is a separate Responses request for every `ctx.web.search()` call, so its latency and token usage are additional to the conversation turn. `maxResults` is still enforced by the shared web seam after mapping, while OpenAI-specific domain filters, external-access mode, model, endpoint, and output-token limits remain provider configuration. The Plugins card exposes the shared provider choice and provider-specific fields in one staged save. Credential rotation reaches the next search without a plugin reload, but synchronous provider availability cannot prove that an asynchronous credential store currently contains a usable key.
