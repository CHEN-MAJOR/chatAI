import { env } from "../../config/env.js";

export type AiProviderKey =
  | "mock"
  | "openai"
  | "deepseek"
  | "qwen"
  | "kimi"
  | "gemini"
  | "custom";

export interface AiModelOption {
  provider: string;
  providerLabel: string;
  model: string;
  label: string;
  isDefault: boolean;
}

export interface AiModelSelection {
  provider: string;
  model: string;
}

export interface AiModelConfig extends Omit<AiModelOption, "isDefault"> {
  baseUrl: string;
  apiKey: string;
  kind: "mock" | "openai-compatible";
}

export interface AiModelCatalog {
  models: AiModelOption[];
  defaultSelection: AiModelSelection;
}

interface ProviderPreset {
  key: Exclude<AiProviderKey, "mock" | "custom">;
  label: string;
  baseUrl: string;
  models: string[];
}

interface ProviderConfig {
  key: AiProviderKey;
  label: string;
  baseUrl: string;
  apiKey: string;
  models: string[];
}

interface ProviderEnv {
  apiKey?: string;
  baseUrl?: string;
  models?: string;
}

const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: "openai",
    label: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    models: ["gpt-4o-mini", "gpt-4o"]
  },
  {
    key: "deepseek",
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    models: ["deepseek-chat", "deepseek-reasoner"]
  },
  {
    key: "qwen",
    label: "通义千问",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen-plus", "qwen-max", "qwen-turbo"]
  },
  {
    key: "kimi",
    label: "Kimi",
    baseUrl: "https://api.moonshot.cn/v1",
    models: ["kimi-latest", "moonshot-v1-32k", "moonshot-v1-128k"]
  },
  {
    key: "gemini",
    label: "Google Gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    models: [
      "gemini-2.5-flash",
      "gemini-3.6-flash",
      "gemini-3.8-flash",
      "gemini-flash-latest",
      "gemini-pro-latest"
    ]
  }
];

const MODEL_LABELS: Record<string, string> = {
  "gpt-4o-mini": "GPT-4o mini",
  "gpt-4o": "GPT-4o",
  "deepseek-chat": "DeepSeek Chat",
  "deepseek-reasoner": "DeepSeek Reasoner",
  "qwen-plus": "Qwen Plus",
  "qwen-max": "Qwen Max",
  "qwen-turbo": "Qwen Turbo",
  "kimi-latest": "Kimi Latest",
  "moonshot-v1-8k": "Moonshot 8K",
  "moonshot-v1-32k": "Moonshot 32K",
  "moonshot-v1-128k": "Moonshot 128K",
  "gemini-2.5-flash": "Gemini 2.5 Flash",
  "gemini-2.5-pro": "Gemini 2.5 Pro",
  "gemini-3.6-flash": "Gemini 3.6 Flash",
  "gemini-3.8-flash": "Gemini 3.8 Flash",
  "gemini-flash-latest": "Gemini Flash Latest",
  "gemini-pro-latest": "Gemini Pro Latest",
  mock: "本地模拟"
};

export class AiSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiSelectionError";
  }
}

export function getAiModelCatalog(): AiModelCatalog {
  const defaultProvider = normalizeProvider(env.AI_PROVIDER);
  const providers = buildProviderConfigs(defaultProvider);
  const includeMock = defaultProvider === "mock" || providers.length === 0;
  let defaultSelection = resolveDefaultSelection(providers, defaultProvider);

  const options: Array<Omit<AiModelOption, "isDefault">> = [];
  if (includeMock) {
    options.push({
      provider: "mock",
      providerLabel: "本地模拟",
      model: "mock",
      label: MODEL_LABELS.mock
    });
  }
  for (const provider of providers) {
    for (const model of provider.models) {
      options.push({
        provider: provider.key,
        providerLabel: provider.label,
        model,
        label: MODEL_LABELS[model] ?? model
      });
    }
  }

  if (!options.some((option) => matchesSelection(option, defaultSelection))) {
    const fallback = options[0];
    defaultSelection = fallback
      ? { provider: fallback.provider, model: fallback.model }
      : { provider: "mock", model: "mock" };
    if (!fallback) {
      options.push({
        provider: "mock",
        providerLabel: "本地模拟",
        model: "mock",
        label: MODEL_LABELS.mock
      });
    }
  }

  return {
    models: options.map((option) => ({
      ...option,
      isDefault: matchesSelection(option, defaultSelection)
    })),
    defaultSelection
  };
}

export function resolveAiSelection(
  provider?: string | null,
  model?: string | null
): AiModelConfig {
  const catalog = getAiModelCatalog();
  const requestedProvider = provider?.trim();
  const requestedModel = model?.trim();
  let selectedProvider = requestedProvider || catalog.defaultSelection.provider;

  if (!requestedProvider && requestedModel) {
    selectedProvider =
      catalog.models.find((option) => option.model === requestedModel)?.provider ??
      selectedProvider;
  }

  const providerOptions = catalog.models.filter(
    (option) => option.provider === selectedProvider
  );
  if (!providerOptions.length) {
    throw new AiSelectionError(`未配置模型供应商：${selectedProvider}。`);
  }

  const selectedOption = requestedModel
    ? providerOptions.find((option) => option.model === requestedModel)
    : providerOptions.find((option) => option.isDefault) ?? providerOptions[0];

  if (!selectedOption) {
    throw new AiSelectionError(
      `供应商 ${selectedProvider} 不支持模型：${requestedModel}。`
    );
  }

  if (selectedOption.provider === "mock") {
    return {
      ...selectedOption,
      baseUrl: "",
      apiKey: "",
      kind: "mock"
    };
  }

  const providerConfig = buildProviderConfigs(normalizeProvider(env.AI_PROVIDER)).find(
    (item) => item.key === selectedOption.provider
  );
  if (!providerConfig) {
    throw new AiSelectionError(`供应商 ${selectedProvider} 的配置不可用。`);
  }

  return {
    ...selectedOption,
    baseUrl: providerConfig.baseUrl,
    apiKey: providerConfig.apiKey,
    kind: "openai-compatible"
  };
}

function buildProviderConfigs(defaultProvider: AiProviderKey): ProviderConfig[] {
  const providers: ProviderConfig[] = [];

  for (const preset of PROVIDER_PRESETS) {
    const values = getProviderEnv(preset.key);
    const isDefault = defaultProvider === preset.key;
    // 只有 gemini/openai 保留旧的全局 AI_* 配置兼容；其他供应商使用自己的
    // *_API_KEY / *_BASE_URL / *_MODELS，避免切到 DeepSeek 时误用 Gemini 的配置。
    const useLegacyGlobal = isDefault && (preset.key === "gemini" || preset.key === "openai");
    const apiKey = values.apiKey ?? (useLegacyGlobal ? env.AI_API_KEY : undefined);
    if (!apiKey) continue;

    const baseUrl =
      values.baseUrl ??
      (useLegacyGlobal ? env.AI_BASE_URL : undefined) ??
      preset.baseUrl;
    let models = parseModelList(values.models);

    if (!models?.length && useLegacyGlobal && env.AI_MODEL) {
      models = uniqueModels([env.AI_MODEL, ...preset.models]);
    }
    models ??= preset.models;

    providers.push({
      key: preset.key,
      label: preset.label,
      baseUrl: trimTrailingSlash(baseUrl),
      apiKey,
      models
    });
  }

  if (defaultProvider === "custom" && env.AI_API_KEY) {
    const models =
      parseModelList(env.AI_MODELS) ??
      (env.AI_MODEL ? [env.AI_MODEL] : ["gpt-4o-mini"]);
    providers.push({
      key: "custom",
      label: "自定义兼容",
      baseUrl: trimTrailingSlash(env.AI_BASE_URL ?? "https://api.openai.com/v1"),
      apiKey: env.AI_API_KEY,
      models
    });
  }

  return providers;
}

function resolveDefaultSelection(
  providers: ProviderConfig[],
  defaultProvider: AiProviderKey
): AiModelSelection {
  if (defaultProvider === "mock") {
    return { provider: "mock", model: "mock" };
  }

  const provider =
    providers.find((item) => item.key === defaultProvider) ?? providers[0];
  if (!provider) {
    return { provider: "mock", model: "mock" };
  }

  const model =
    provider.key === defaultProvider &&
    env.AI_MODEL &&
    provider.models.includes(env.AI_MODEL)
      ? env.AI_MODEL
      : provider.models[0];

  return { provider: provider.key, model };
}

function getProviderEnv(key: ProviderPreset["key"]): ProviderEnv {
  switch (key) {
    case "openai":
      return {
        apiKey: env.OPENAI_API_KEY,
        baseUrl: env.OPENAI_BASE_URL,
        models: env.OPENAI_MODELS
      };
    case "deepseek":
      return {
        apiKey: env.DEEPSEEK_API_KEY,
        baseUrl: env.DEEPSEEK_BASE_URL,
        models: env.DEEPSEEK_MODELS
      };
    case "qwen":
      return {
        apiKey: env.QWEN_API_KEY,
        baseUrl: env.QWEN_BASE_URL,
        models: env.QWEN_MODELS
      };
    case "kimi":
      return {
        apiKey: env.KIMI_API_KEY,
        baseUrl: env.KIMI_BASE_URL,
        models: env.KIMI_MODELS
      };
    case "gemini":
      return {
        apiKey: env.GEMINI_API_KEY,
        baseUrl: env.GEMINI_BASE_URL,
        models: env.GEMINI_MODELS
      };
  }
}

function normalizeProvider(value: string): AiProviderKey {
  if (value === "openai-compatible") return "custom";
  if (
    value === "openai" ||
    value === "deepseek" ||
    value === "qwen" ||
    value === "kimi" ||
    value === "gemini" ||
    value === "custom"
  ) {
    return value;
  }
  return "mock";
}

function parseModelList(value?: string) {
  if (!value) return undefined;
  const models = uniqueModels(
    value.split(",").map((item) => item.trim()).filter(Boolean)
  );
  return models.length ? models : undefined;
}

function uniqueModels(models: string[]) {
  return [...new Set(models)];
}

function matchesSelection(
  option: Pick<AiModelOption, "provider" | "model">,
  selection: AiModelSelection
) {
  return option.provider === selection.provider && option.model === selection.model;
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, "");
}
