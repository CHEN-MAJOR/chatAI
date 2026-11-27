import type { FastifyInstance } from "fastify";
import { getAiModelCatalog } from "./providers.js";

export async function aiRoutes(app: FastifyInstance) {
  app.get("/models", async () => getAiModelCatalog());
}
