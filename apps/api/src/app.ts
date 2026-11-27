import cors from "@fastify/cors";
import fastify from "fastify";
import { allowedOrigins, env } from "./config/env.js";
import { chatRoutes } from "./modules/chat/chat.routes.js";
import { healthRoutes } from "./modules/health/health.routes.js";
import { workspaceRoutes } from "./modules/workspace/workspace.routes.js";
import { attachmentRoutes } from "./modules/attachment/attachment.routes.js";
import { authRoutes } from "./modules/auth/auth.routes.js";
import { aiRoutes } from "./modules/ai/ai.routes.js";
import multipart from "@fastify/multipart";

export async function buildApp() {
  const app = fastify({
    logger: {
      level: env.NODE_ENV === "development" ? "info" : "warn"
    }
  });

  await app.register(cors, {
    origin: allowedOrigins,
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"]
  });
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1 }
  });

  await app.register(healthRoutes, { prefix: "/health" });
  await app.register(aiRoutes, { prefix: "/api/ai" });
  await app.register(chatRoutes, { prefix: "/api" });
  await app.register(workspaceRoutes, { prefix: "/api" });
  await app.register(attachmentRoutes, { prefix: "/api" });
  await app.register(authRoutes, { prefix: "/api" });

  return app;
}
