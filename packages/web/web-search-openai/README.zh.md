# @deepseek-ai/dsh-web-search-openai

[English](README.md) | 中文

由 [OpenAI](https://openai.com) Responses 支持的 `WebSearchProvider`，用于 harness 的 [web 能力 seam](../web/README.md)（`ctx.web`）。它使用原生 Responses `web_search` 服务器工具调用 `POST {baseURL}/responses`，并把结构化源与 URL 引用映射为 seam 的规范化 `WebSearchResult`。

这是一个实现包：它向 `ctx.web` 注册提供方，通过可选的 `ctx.credentials` seam 为每次搜索解析 `OPENAI_API_KEY`，若存在发起请求的 Agent 会话则记录不含密钥的辅助请求，且不注册面向模型的工具。该提供方有意独立于 `ctx.llm`；OpenAI 服务器工具是提供方私有的 Responses wire 细节。

## 配置

| 配置键 | 默认值 | 含义 |
|---|---|---|
| `apiKey` | 未设置 | OpenAI API 密钥字面值。优先使用 `apiKeyEnv`，避免密钥进入配置；非空字面值优先。 |
| `apiKeyEnv` | `OPENAI_API_KEY` | 每次搜索通过 `ctx.credentials` 解析的凭据引用；没有该 seam 时从启动环境解析。缺少值时调用以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败。 |
| `baseURL` | `https://api.openai.com/v1` | Responses API 基址；追加 `/responses`。缺省时回退到 `$OPENAI_RESPONSES_BASE_URL`。无法解析时提供方不可用。 |
| `model` | `gpt-5.5` | 辅助搜索请求使用的 Responses 模型。 |
| `maxOutputTokens` | 未设置 | 可选的正整数输出 token 上限。 |
| `allowedDomains` | 未设置 | 传给 Responses web search 过滤器的可选域名白名单。 |
| `blockedDomains` | 未设置 | 传给 Responses web search 过滤器的可选域名黑名单。 |
| `externalWebAccess` | 未设置 | 可选的 OpenAI web search 设置；设为 `false` 可请求不进行实时外部访问的缓存或索引结果。 |

本插件注册 `web-search-openai` Settings 分节。Plugins 设置卡片通过 `web` 分节选择该提供方并编辑这些提供方字段；API Key 不写入 settings 文档，而是按 `apiKeyEnv` 通过 credentials 领域写入。

base bundle 会以 `web-search-openai` 挂载该提供方，但为保持现有 profile 行为，仍选择 `deepseek-official`。在 Cordis overlay 中选择 OpenAI 路由：

```yaml
- id: web
  config:
    searchProvider: openai-responses
- id: web-search-openai
  config:
    apiKeyEnv: OPENAI_API_KEY
    model: gpt-5.5
```

配置在搜索开始时解析，因此凭据轮换会作用于下一次请求。提供方 id 是 `openai-responses`；注册了多个可用搜索提供方时，必须显式选择它。Plugins 设置卡片会为该选择保存 `web.searchProvider: openai-responses`。

## 请求与映射

每次搜索将查询作为 Responses `input` 发送，携带一个原生 `{ type: 'web_search' }` 工具、`tool_choice: 'auto'`，以及 `include: ['web_search_call.action.sources']`。源来自结构化的 `web_search_call.action.sources` 条目和 `url_citation` 注解，只接受 HTTP(S)，并按 URL 去重。`output_text` 或消息中的 `output_text` 块会成为规范化的 `content`。

提供方绝不会从普通模型文本中提取 URL。如果响应没有结构化源，会抛出 `WebError` `WEB_PROVIDER_ERROR`，而不是返回无引用的答案。共享 seam 在映射后执行 `maxResults`，丢弃源时设置 `truncated`。

## 请求日志

由 Agent 发起的搜索会在发送请求前一刻，向相应会话追加仅用于日志的 `web/openai-responses-search-llm-request` 事件。事件包含解析后的端点和不含密钥的精确 JSON 请求体，不包含标头和凭据。发送前发生凭据失败或取消时不会创建事件；发送后发生 HTTP 或响应失败时，本次请求尝试仍会持久化。Agent 之外直接调用提供方时没有会话可记录。

## 模型体验

### 辅助 OpenAI Responses 搜索请求

#### 模型看到的内容

独立的 OpenAI Responses 请求接收查询作为 `input`，并接收原生 `web_search` 服务器工具。该请求独立于会话模型请求；本包不会把服务器工具调用暴露为面向模型的函数 schema。

#### Token 影响

每次搜索都会产生独立的 Responses 输入与输出用量。`maxOutputTokens` 可以限制生成输出，但原生工具控制检索，因此本提供方不承诺固定源数量。

#### KV Cache 影响

辅助请求有独立的缓存上下文。上游服务可以复用稳定的模型、工具和指令前缀；查询或路由变化会从首次差异处开始不同。

### 间接的会话工具结果

#### 模型看到的内容

通过 [`dsh-tool-web`](../tool-web/README.md)，会话模型看到来自结构化 Responses 输出的规范化内容以及去重后的 URL 和标题。它不会收到该提供方隐藏的 API 密钥、请求标头或仅用于会话日志的请求事件。

#### Token 影响

注册不会产生会话 token。`dsh-tool-web` 添加的结果会随内容和源增长，随后 web seam 应用消费者的源数量上限。

#### KV Cache 影响

工具结果会在辅助调用后追加到会话；新结果会改变后续会话前缀，但不会改变之前已经缓存的请求材料。

## 已知限制与暂缓事项

- **原生服务器工具不是面向模型的函数工具**：`dsh-llm-pi-ai` 仍负责会话模型的工具 schema；本提供方直接调用 OpenAI Responses。
- **一次搜索是独立的 Responses 请求**：它会额外产生延迟与用量，本实现不提供纯检索成本或源数量保证。
- **同步可用性无法查询异步凭据存储**：选中的提供方即使有解析器，没有可用密钥时仍可能在执行阶段以 `WEB_PROVIDER_CREDENTIAL_MISSING` 失败。
- **必须有结构化引用**：如果没有 `web_search_call.action.sources` 或 URL 注解，会拒绝响应，不会从文本生成引用。
- **卡片按提供方显示字段**：共享 Plugins 卡片开放本包的接口地址、模型、输出 Token 上限、域名过滤和外部访问设置；会话模型设置仍由各 LLM 提供方负责。
