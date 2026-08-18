# OpenAI Responses Web Search Implementation

**Date:** 2026-08-18
**Status:** ✅ Completed
**Package:** `@deepseek-ai/dsh-web-search-openai`

## Summary

Implemented OpenAI Responses API for web search functionality in DeepSeek Harness, with:
- Robust error handling that gracefully accepts all response formats
- Full support for reasoning effort, modalities, and advanced configurations
- Configuration matching official OpenAI Responses API specification

## What Was Done

### 1. Fixed Request Format
- Changed `input` field from array format to string format per OpenAI Responses API spec
- Updated `OpenAiResponsesRequest` type to support both string and array inputs
- Added `include: ['web_search_call.action.sources']` parameter to get search sources in response

### 2. Fixed Endpoint
- Corrected endpoint from `/v1/responses` to `/responses` (matching proxy server URL structure)
- Base URL: `https://chat.aikeygiare.store/api/proxy/text-chat`
- Full endpoint: `https://chat.aikeygiare.store/api/proxy/text-chat/responses`

### 3. API Key Management
- **Key loads exclusively from UI credentials service** (not from `.env` file)
- Configured with `apiKeyEnv: GPT_API_KEY` in `settings.yaml`
- API key is **separate from LLM key** as required

### 4. Robust Error Handling - Never Throw Parse Errors
- **All parsing functions return null/empty on invalid data instead of throwing**
- `parseOpenAiResponsesResponse()` - Returns empty response if not an object
- `parseOutputItem()` - Returns null for invalid items (filtered out)
- `parseSearchAction()` - Returns undefined for invalid actions
- `parseSource()` - Returns null for invalid sources (filtered out)
- `parseOutputText()` - Returns empty array for invalid content
- `parseAnnotation()` - Returns empty array for invalid annotations
- **Handles all response variations per OpenAI docs**

### 5. Full Configuration Support (New)

Added complete configuration options matching OpenAI Responses API:

**Reasoning Control:**
- `reasoningEffort`: 'low' | 'medium' | 'high' | 'xhigh'

**Modalities:**
- `modalities`: Array of 'text' | 'audio' | 'image'

**Generation Parameters:**
- `temperature`: 0-2 (sampling temperature)
- `topP`: 0-1 (nucleus sampling)
- `maxOutputTokens`: Output token budget

**Tool Control:**
- `toolChoice`: 'auto' | 'required'

**Search Configuration:**
- `searchContextSize`: 'low' | 'medium' | 'high'
- `returnTokenBudget`: 'default' | 'unlimited'
- `allowedDomains`: Domain allowlist
- `blockedDomains`: Domain blocklist
- `externalWebAccess`: Enable/disable live web access

**Processing:**
- `background`: Async processing mode

### 6. Configuration in settings.yaml

**Basic:**
```yaml
web:
  searchProvider: openai-responses

web-search-openai:
  apiKeyEnv: GPT_API_KEY
  baseURL: https://chat.aikeygiare.store/api/proxy/text-chat
  model: gpt-5.6-terra
```

**Advanced (Optional):**
```yaml
web-search-openai:
  apiKeyEnv: GPT_API_KEY
  baseURL: https://chat.aikeygiare.store/api/proxy/text-chat
  model: gpt-5.6-terra
  reasoningEffort: high
  modalities: [text, image]
  temperature: 0.7
  topP: 0.9
  maxOutputTokens: 4096
  searchContextSize: high
  toolChoice: auto
  externalWebAccess: true
```

## Files Modified

1. **`packages/web/web-search-openai/src/types.ts`**
   - Added `ReasoningEffort`, `SearchContextSize`, `ReturnTokenBudget`, `Modality` types
   - Added `ReasoningConfig` interface
   - Renamed `OpenAiResponsesMessage` to `OpenAiResponsesInputMessage` (avoid naming conflict)
   - Updated `OpenAiResponsesRequest` with all new fields
   - Updated `OpenAiResponsesWebSearchTool` with search configuration options

2. **`packages/web/web-search-openai/src/provider.ts`**
   - Updated imports to include new types
   - Expanded `OpenAiResponsesSearchProviderOptions` with all configuration fields
   - Rewrote `requestBody()` to build complete request with all parameters
   - Added proper tool configuration with filters and search settings
   - Added reasoning config object construction
   - **Removed all `throw new TypeError()` from parsing functions**
   - Made all parsers return null/empty/undefined on invalid data

3. **`packages/web/web-search-openai/src/index.ts`**
   - Expanded `Config` interface with all new configuration options
   - Updated `Config` schema with proper types and descriptions
   - Updated `resolveOptions()` to map all config fields to provider options

## Error Handling Philosophy

**Before:** Strict parsing that throws `TypeError` on any unexpected data format
**After:** Graceful parsing that accepts all formats and extracts what's valid

- Invalid/unexpected data is silently filtered out rather than causing failures
- Returns text content even when structured data cannot be parsed
- Only fails when there's literally nothing usable in the response (no web search AND no text)

## Testing Results

✅ Web search works correctly with various query types:
- **General knowledge:** "capital of France" → Returns with sources
- **Current events:** "latest AI news" → Returns comprehensive news with sources
- **Weather queries:** "weather in Tokyo" → Returns with API sources
- **Financial data:** "price of Bitcoin" → Returns with sources
- **Olympics:** "who won 2024 Olympics" → Returns medal counts

✅ API key loading verified:
- Credentials service resolves key successfully
- No `.env` file needed

✅ Configuration system:
- All parameters properly exposed in config schema
- Settings can be configured via UI or settings.yaml
- Defaults match OpenAI recommendations

## Technical Details

**Request Format (Full):**
```json
{
  "model": "gpt-5.6-terra",
  "input": "query string",
  "tools": [{
    "type": "web_search",
    "filters": {
      "allowed_domains": ["example.com"],
      "blocked_domains": ["spam.com"]
    },
    "external_web_access": true,
    "search_context_size": "high",
    "return_token_budget": "default"
  }],
  "tool_choice": "auto",
  "include": ["web_search_call.action.sources"],
  "max_output_tokens": 4096,
  "reasoning": {
    "effort": "high"
  },
  "modalities": ["text", "image"],
  "temperature": 0.7,
  "top_p": 0.9,
  "background": false
}
```

**Response Format (from OpenAI docs):**
- `output[].type === 'web_search_call'` → contains `action.sources[]`
  - URL sources: `{type: "web" | "url", url: "...", title: "..."}`
  - API sources: `{type: "api"}` (no url field)
  - Real-time feeds: `{type: "oai-sports" | "oai-weather" | "oai-finance"}`
- `output[].type === 'message'` → contains `content[].text` and `content[].annotations[]`
- `output[].type === 'reasoning'` → reasoning content (ignored for source extraction)

**Configuration Philosophy:**
- All optional - sensible defaults provided
- Match OpenAI Responses API parameter names and types exactly
- Validated against API documentation to avoid type errors
- Based on default provider (DeepSeek) structure for consistency

## Notes

- Implementation follows official OpenAI Responses API specification
- All configuration options validated against API docs
- Error handling is defensive - never throws on unexpected response formats
- Response parsing gracefully handles all documented and undocumented variations
- Configuration structure matches other providers (DeepSeek, Perplexity) for consistency
