import { ProxyAgent } from "undici";
import { env } from "../../config/env.js";
import type { AiModelConfig } from "./providers.js";

export type AiRole = "system" | "user" | "assistant";

export interface AiChatMessage {
  role: AiRole;
  content: string;
}

let proxyDispatcher: ProxyAgent | undefined;

export async function* streamAiResponse(
  messages: AiChatMessage[],
  modelConfig: AiModelConfig,
  signal?: AbortSignal
): AsyncGenerator<string> {
  if (modelConfig.kind === "mock") {
    yield* streamMockResponse(messages, signal);
    return;
  }

  yield* streamOpenAiCompatibleResponse(messages, modelConfig, signal);
}

async function* streamMockResponse(
  messages: AiChatMessage[],
  signal?: AbortSignal
): AsyncGenerator<string> {
  const latestUserMessage =
    [...messages].reverse().find((message) => message.role === "user")
      ?.content ?? "";
  const text = `已收到你的问题：${latestUserMessage}\n\n这是本地 mock 模型返回的流式内容。`;
  const chunks = text.match(/[\s\S]{1,6}/g) ?? [];

  for (const chunk of chunks) {
    signal?.throwIfAborted();
    await delay(28);
    yield chunk;
  }
}

async function* streamOpenAiCompatibleResponse(
  messages: AiChatMessage[],
  modelConfig: AiModelConfig,
  signal?: AbortSignal
): AsyncGenerator<string> {
  const url = `${trimTrailingSlash(modelConfig.baseUrl)}/chat/completions`;
  const response = await fetchWithRetry(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${modelConfig.apiKey}`
      },
      body: JSON.stringify({
        model: modelConfig.model,
        messages,
        stream: true,
        ...(modelConfig.model.includes("reasoner") ? {} : { temperature: 0.7 })
      }),
      dispatcher: getProxyDispatcher()
    },
    signal
  );

  if (!response.ok || !response.body) {
    const message = await response.text();
    throw new Error(
      `${modelConfig.providerLabel} 请求失败：${response.status} ${truncate(message, 500)}`
    );
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      const parsed = parseSseBuffer(buffer);
      buffer = parsed.remainder;

      for (const data of parsed.events) {
        if (data === "[DONE]") {
          return;
        }

        const delta = readDelta(data);
        if (delta) {
          yield delta;
        }
      }
    }

    const finalData = buffer.trim();
    if (finalData.startsWith("data:")) {
      const delta = readDelta(finalData.slice(5).trim());
      if (delta) {
        yield delta;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function parseSseBuffer(buffer: string) {
  const events: string[] = [];
  let remainder = buffer;
  let boundaryIndex = remainder.indexOf("\n\n");

  while (boundaryIndex !== -1) {
    const rawEvent = remainder.slice(0, boundaryIndex);
    remainder = remainder.slice(boundaryIndex + 2);
    const data = rawEvent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");

    if (data) {
      events.push(data);
    }

    boundaryIndex = remainder.indexOf("\n\n");
  }

  return { events, remainder };
}

function readDelta(data: string) {
  try {
    const payload = JSON.parse(data) as {
      choices?: Array<{
        delta?: {
          content?: string | Array<string | { text?: string }>;
        };
      }>;
    };
    const content = payload.choices?.[0]?.delta?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content
        .map((part) => (typeof part === "string" ? part : part?.text ?? ""))
        .join("");
    }
    return "";
  } catch {
    return "";
  }
}

async function fetchWithRetry(
  url: string,
  init: RequestInit & { dispatcher?: ProxyAgent },
  outerSignal?: AbortSignal
) {
  let lastError: unknown;

  for (let attempt = 0; attempt <= env.AI_MAX_RETRIES; attempt += 1) {
    outerSignal?.throwIfAborted();
    const timeoutSignal = AbortSignal.timeout(env.AI_REQUEST_TIMEOUT_MS);
    const signal = outerSignal
      ? AbortSignal.any([outerSignal, timeoutSignal])
      : timeoutSignal;

    try {
      const response = await fetch(url, { ...init, signal });

      if (!isRetryableStatus(response.status) || attempt === env.AI_MAX_RETRIES) {
        return response;
      }

      await response.body?.cancel();
      await delay(retryDelay(attempt));
    } catch (error) {
      lastError = error;

      if (outerSignal?.aborted || attempt === env.AI_MAX_RETRIES) {
        throw error;
      }

      await delay(retryDelay(attempt));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("AI provider request failed after retries");
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryDelay(attempt: number) {
  return Math.min(500 * 2 ** attempt, 4000);
}

function getProxyDispatcher() {
  const proxyUrl =
    process.env.HTTPS_PROXY ??
    process.env.HTTP_PROXY ??
    process.env.https_proxy ??
    process.env.http_proxy;

  if (!proxyUrl) {
    return undefined;
  }

  proxyDispatcher ??= new ProxyAgent(proxyUrl);
  return proxyDispatcher;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}

function truncate(value: string, maxLength: number) {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
