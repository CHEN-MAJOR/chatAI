# 模型配置与供应商兼容

项目通过 OpenAI 兼容协议接入模型。以下供应商已内置预设，只需要配置 API Key：

- OpenAI
- DeepSeek
- 通义千问（DashScope OpenAI 兼容模式）
- Kimi（Moonshot）
- Google Gemini（OpenAI 兼容端点）
- 任意自定义 OpenAI 兼容服务

配置了哪些供应商的 Key，页面顶部就会出现哪些模型选项。每个会话会记住自己使用的模型，切换模型后下一次发送就会生效。

## 快速配置

编辑 `apps/api/.env`（或仓库根 `.env`，`apps/api/.env` 优先级更高）。

### DeepSeek

```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY="sk-..."
DEEPSEEK_MODELS="deepseek-chat,deepseek-reasoner"
```

默认 Base URL：`https://api.deepseek.com/v1`

### 通义千问 Qwen

```env
AI_PROVIDER=qwen
QWEN_API_KEY="sk-..."
QWEN_MODELS="qwen-plus,qwen-max,qwen-turbo"
```

默认 Base URL：`https://dashscope.aliyuncs.com/compatible-mode/v1`

### Kimi

```env
AI_PROVIDER=kimi
KIMI_API_KEY="sk-..."
KIMI_MODELS="kimi-latest,moonshot-v1-32k,moonshot-v1-128k"
```

默认 Base URL：`https://api.moonshot.cn/v1`

### OpenAI

```env
AI_PROVIDER=openai
OPENAI_API_KEY="sk-..."
OPENAI_MODELS="gpt-4o-mini,gpt-4o"
```

默认 Base URL：`https://api.openai.com/v1`

### Google Gemini

Gemini 必须使用 OpenAI 兼容端点：

```env
AI_PROVIDER=gemini
GEMINI_API_KEY="..."
GEMINI_MODELS="gemini-2.5-flash,gemini-3.6-flash,gemini-pro-latest"
GEMINI_BASE_URL="https://generativelanguage.googleapis.com/v1beta/openai"
```

### 同时启用多个供应商

可以同时配置多个 Key。`AI_PROVIDER` 只决定默认选中哪个供应商：

```env
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY="..."
QWEN_API_KEY="..."
KIMI_API_KEY="..."
```

配置完成后重启 API，页面顶部会出现 DeepSeek、通义千问、Kimi 三组模型。

## 自定义 OpenAI 兼容服务

```env
AI_PROVIDER=openai-compatible
AI_BASE_URL="https://your-gateway.example.com/v1"
AI_API_KEY="your_api_key"
AI_MODELS="model-a,model-b"
```

## 变量说明

- `AI_PROVIDER`：默认供应商，取值 `mock`、`openai`、`openai-compatible`、`deepseek`、`qwen`、`kimi`、`gemini`、`custom`
- `*_API_KEY`：对应供应商的密钥
- `*_MODELS`：覆盖默认模型列表，逗号分隔
- `*_BASE_URL`：覆盖默认接口地址，适合代理或私有网关
- `AI_MODEL` / `AI_BASE_URL` / `AI_API_KEY`：旧的全局配置，仍兼容 `openai`、`gemini` 和自定义服务
- `AI_MODELS`：自定义服务的模型列表

没有配置任何真实供应商时，会使用 `mock` 本地模拟模型。

## 代理

如果访问模型接口需要代理：

```env
HTTPS_PROXY="http://127.0.0.1:7897"
HTTP_PROXY="http://127.0.0.1:7897"
```

请确保代理端口确实在监听。修改 `.env` 后需要重启 API，`tsx watch` 不会监听 `.env` 变化。

## 验证

启动后端后查看模型目录：

```bash
curl http://localhost:4000/api/ai/models
```

返回的 `models` 就是页面模型选择器的数据源，`defaultSelection` 是默认模型。

测试流式聊天：

```bash
curl -N -H "Content-Type: application/json" -X POST \
  -d '{"message":"你好，介绍一下你自己","provider":"deepseek","model":"deepseek-chat"}' \
  http://localhost:4000/api/chat/stream
```

看到 `message_delta` 和 `message_done` 事件说明调用成功。

## 常见问题

- 返回 400：供应商或模型未配置。先检查 `/api/ai/models` 返回的列表。
- 返回 401/403：API Key 错误或没有模型权限。
- 返回 404：Base URL 或模型名不正确。
- 连接超时：检查代理端口，或先用 `curl` 直接访问对应 Base URL。
- 页面没有模型选择器：没有任何真实供应商配置成功，或 `/api/ai/models` 请求失败。
