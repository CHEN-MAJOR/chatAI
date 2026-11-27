import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

// Compute __dirname in ES module
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 先加载仓库根 .env 作为默认值，再用 apps/api/.env 覆盖，最后回退到默认 dotenv 行为。
// 不能依赖 process.cwd()：通过 npm workspace 启动时 cwd 是 apps/api，会与 localEnv 重合。
const localEnv = path.resolve(__dirname, "../../.env");
const rootEnv = path.resolve(__dirname, "../../../../.env");
let dotenvLoaded = false;

if (fs.existsSync(rootEnv)) {
  dotenv.config({ path: rootEnv, override: false });
  dotenvLoaded = true;
}

if (fs.existsSync(localEnv)) {
  dotenv.config({ path: localEnv, override: true });
  dotenvLoaded = true;
}

if (!dotenvLoaded) {
  dotenv.config({ override: true });
}
import { z } from "zod";

const optionalString = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().optional()
);
const optionalUrl = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().url().optional()
);

const envSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  DATABASE_URL: z.string().optional(),
  AI_PROVIDER: z
    .enum(["mock", "openai", "openai-compatible", "deepseek", "qwen", "kimi", "gemini", "custom"])
    .default("mock"),
  AI_BASE_URL: optionalUrl,
  AI_API_KEY: optionalString,
  AI_MODEL: optionalString,
  AI_MODELS: optionalString,
  OPENAI_API_KEY: optionalString,
  OPENAI_BASE_URL: optionalUrl,
  OPENAI_MODELS: optionalString,
  DEEPSEEK_API_KEY: optionalString,
  DEEPSEEK_BASE_URL: optionalUrl,
  DEEPSEEK_MODELS: optionalString,
  QWEN_API_KEY: optionalString,
  QWEN_BASE_URL: optionalUrl,
  QWEN_MODELS: optionalString,
  KIMI_API_KEY: optionalString,
  KIMI_BASE_URL: optionalUrl,
  KIMI_MODELS: optionalString,
  GEMINI_API_KEY: optionalString,
  GEMINI_BASE_URL: optionalUrl,
  GEMINI_MODELS: optionalString,
  AI_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(10_000).max(300_000).default(90_000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  SSE_HEARTBEAT_MS: z.coerce.number().int().min(5_000).max(60_000).default(15_000)
});

export const env = envSchema.parse(process.env);

export const allowedOrigins = env.WEB_ORIGIN.split(",").map((origin) =>
  origin.trim()
);
