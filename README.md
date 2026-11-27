# ChatAI

这个项目可以理解为一个“可自己部署的网页版 AI 助手”，使用方式类似 ChatGPT，但对话记录、账号、文件和常用提示词都由自己的系统管理。
它主要能做什么
1. 与 AI 连续聊天
   用户输入问题后，回答会像打字一样逐步显示。生成过程中可以点击“停止生成”，也可以重新生成回答、编辑之前的问题并产生新的回答分支。
2. 管理历史对话
   每次聊天都会保存到数据库。可以搜索、重命名、收藏、归档、分组或彻底删除对话，刷新页面后记录仍然存在。
3. 上传文件让 AI 阅读
   支持 PDF、Word、Excel、TXT、Markdown、CSV、JSON 等文件。系统会先提取文字，再把内容连同问题一起交给 AI，例如：
   “帮我总结这份 PDF”
   “分析这个 Excel 中的数据”
4. 管理常用提示词
   可以保存经常使用的指令，例如“润色文章”“生成周报”“解释代码”。以后点击一次即可放入输入框，不需要重复输入。
5. 账号和数据同步
   未登录也能使用访客空间；注册登录后，对话、附件、分组和提示词会归到该账号下，换设备后仍能读取。
6. 个性化界面
   支持浅色、深色和跟随系统主题，也能调整界面密度、颜色风格、动效和背景效果，并保存自己的视觉方案。
7. 更完整的聊天交互
   包含 Markdown 排版、代码高亮和复制、消息时间、回到底部、导出 Markdown、命令搜索中心等功能。停止生成后残留的空白加载提示也已经在显示逻辑中处理。
一次聊天是怎么完成的
用户输入问题
    ↓
网页把问题和附件发送给后端
    ↓
后端读取相关历史消息
    ↓
调用 AI 模型
    ↓
回答逐字返回网页
    ↓
完整问答保存到 MySQL
项目由哪些部分组成
- 前端：用户看到和操作的网页，使用 Vue 3 开发，默认地址是 http://localhost:5173。
- 后端：负责账号、对话、文件和 AI 调用，使用 Fastify，默认地址是 http://localhost:4000。
- 数据库：使用 MySQL，保存用户、会话、消息、附件和提示词。
- AI 服务：可以连接 OpenAI 兼容接口。没有配置模型密钥时，会使用本地模拟回答，所以“能够回复”不一定代表已经连接真实 AI。
- Redis：目前不需要。现有功能用 MySQL 和普通服务进程即可运行；只有将来做多服务器部署、大量并发、任务队列或共享缓存时，才有必要加入 Redis。
一句话概括：这是一个带账号、历史记录、文件阅读、提示词资料库和个性化界面的私人 AI 对话工作台。

## Stack

- Web: Vue 3, Vite, Pinia, Vue Router
- API: Fastify, TypeScript
- Database: MySQL with Prisma
- AI: mock streaming by default, OpenAI-compatible streaming when configured

## Quick Start

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create environment files:

   ```bash
   copy apps\api\.env.example apps\api\.env
   copy apps\web\.env.example apps\web\.env
   ```

3. Start MySQL:

   ```bash
   docker compose up -d mysql
   ```

4. Create Prisma's development shadow database:

   ```bash
   docker compose exec -T mysql mysql -uroot -pchatai_root -e "CREATE DATABASE IF NOT EXISTS chatai_shadow;"
   ```

5. Generate Prisma Client and run migrations:

   ```bash
   npm run prisma:generate
   npm run prisma:migrate
   ```

6. Start the app:

   ```bash
   npm run dev
   ```

The web app runs at `http://localhost:5173`, and the API runs at `http://localhost:4000`.

### LAN access

The development server listens on all interfaces. From another device on the same network, open:

`http://192.168.1.249:5173`

The browser automatically uses the host name from the page URL for API requests, so no machine-specific API URL is required. If Windows Firewall blocks access, allow inbound TCP ports `5173` and `4000` for Node.js (or add rules for those ports).

## AI Provider

The API starts with `AI_PROVIDER=mock`, so the chat interface can stream replies without a model key.

内置 OpenAI 兼容供应商：`openai`、`deepseek`、`qwen`、`kimi`、`gemini`，也支持任意自定义兼容服务。配置了哪些供应商的 Key，页面顶部就会出现对应模型选择项；每个会话会记住自己使用的模型。

在 `apps/api/.env` 中按需配置（示例）：

```env
# 默认使用 DeepSeek
AI_PROVIDER=deepseek
DEEPSEEK_API_KEY="your_deepseek_key"
DEEPSEEK_MODELS="deepseek-chat,deepseek-reasoner"

# 同时启用通义千问
QWEN_API_KEY="your_dashscope_key"
QWEN_MODELS="qwen-plus,qwen-max,qwen-turbo"

# 同时启用 Kimi
KIMI_API_KEY="your_moonshot_key"
KIMI_MODELS="kimi-latest,moonshot-v1-32k,moonshot-v1-128k"
```

多个供应商可以同时配置。默认模型由 `AI_PROVIDER` 决定，用户也可以在页面上切换。

自定义 OpenAI 兼容服务：

```env
AI_PROVIDER=openai-compatible
AI_BASE_URL="https://your-gateway.example.com/v1"
AI_API_KEY="your_api_key"
AI_MODELS="model-a,model-b"
```

Gemini 需要使用 OpenAI 兼容端点 `https://generativelanguage.googleapis.com/v1beta/openai`。更多说明见 `docs/model-setup.md` 和 `apps/api/.env.example`。
