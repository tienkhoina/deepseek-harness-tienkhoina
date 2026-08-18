# Agent Note：OpenAI Responses 原生 web 搜索提供方

Status: implemented

[English](2026-08-17-openai-responses-web-search.md) | 中文

## 问题

harness 已经提供与厂商无关的 `ctx.web.search()` 能力并挂载了 DeepSeek 原生 web 搜索，但使用 OpenAI Responses 的部署还需要同一能力调用 OpenAI 原生的 `web_search` 服务器工具。如果将其接入 `dsh-llm-pi-ai`，就会把提供方私有的 Responses 请求变成会话模型工具 schema，并让 web 提供方依赖 LLM 适配器的函数工具词汇。

## 决策

- 增加完整的 `dsh-web` Service Provider 包 `@deepseek-ai/dsh-web-search-openai`。它注册 `openai-responses`，调用 `POST {baseURL}/responses`，发送 `{ type: 'web_search' }`，并将结构化的 `web_search_call.action.sources` 与 `url_citation` 注解映射为 `WebSearchResult`。
- 将提供方保持在 web 能力内部。它不使用 `ctx.llm`，也不注册面向模型的函数工具；`dsh-tool-web` 仍是会话模型 `web_search` schema 与结果展示的唯一所有者。
- 每次搜索通过 `ctx.credentials` 解析 `OPENAI_API_KEY`；没有挂载凭据服务时回退到启动环境；存在发起会话时，在发送前追加不含密钥的 `web/openai-responses-search-llm-request` 事件。
- 在 base bundle 中将该提供方作为显式备选挂载，但继续选择 `deepseek-official` 作为默认值。overlay 使用 `web.config.searchProvider: openai-responses` 才会启用该路由。
- 为实时提供方选择注册 `web` Settings 命名空间，为 OpenAI 特有字段注册 `web-search-openai` Settings 命名空间。Plugins 卡片在 DeepSeek 与 OpenAI 注册项之间选择，把提供方字段写入各自的命名空间，并通过 credentials 而不是 settings 写入各自的 API Key。
- 要求结构化源。如果响应只有普通文本，则返回 `WEB_PROVIDER_ERROR`；提供方不会从文本中抓取 URL 来伪造引用。URL 源会去重、限制为 HTTP(S)，并通过现有 seam 规范化。

## 曾考虑的替代方案

- **在 `dsh-llm-pi-ai` 中增加 OpenAI 专用工具 schema**：否决，因为 Responses `web_search` 条目是服务器侧工具，不属于会话模型的函数工具列表；这样还会让 LLM 适配器承担 web 提供方行为。
- **用 OpenAI 替换 base bundle 的 DeepSeek 路由**：否决，因为现有 profile 使用 `DEEPSEEK_API_KEY`，没有 overlay 决策就改变默认后端。
- **从响应普通文本中解析 URL**：否决，因为无引用答案无法证明来源；缺少结构化源时提供方会严格失败。
- **将 API Key 存入 settings 文档**：否决，因为带 secret 角色的字段不能通过 settings 描述返回；UI 会通过已有的凭据引用层写入 credentials。

## 后果

每次 `ctx.web.search()` 都会单独发起一次 Responses 请求，因此 OpenAI web 搜索的延迟与 token 用量会叠加在会话轮次之外。映射后仍由共享 web seam 执行 `maxResults`；域名过滤、外部访问模式、模型、端点和输出 token 上限保留为提供方配置。Plugins 卡片在一次暂存保存中提供共享提供方选择与提供方特有字段。凭据轮换无需重新加载插件即可作用于下一次搜索，但同步的提供方可用性无法证明异步凭据存储当前确实有可用密钥。
