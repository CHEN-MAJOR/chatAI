import type { ChatMessage, ChatRole, ChatStreamEvent, ConversationSummary } from "@chatai/shared";
import type { Attachment, Conversation, Message, MessageRole } from "@prisma/client";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { allowedOrigins, env } from "../../config/env.js";
import { resolveUser } from "../../lib/identity.js";
import { prisma } from "../../lib/prisma.js";
import { type AiChatMessage, streamAiResponse } from "../ai/ai.service.js";
import { AiSelectionError, resolveAiSelection, type AiModelConfig } from "../ai/providers.js";

const idParams = z.object({ id: z.string().min(1).max(191) });
const createConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  groupId: z.string().min(1).max(191).nullable().optional()
});
const updateConversationSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  isFavorite: z.boolean().optional(),
  isArchived: z.boolean().optional(),
  groupId: z.string().min(1).max(191).nullable().optional(),
  aiProvider: z.string().min(1).max(40).optional(),
  aiModel: z.string().min(1).max(120).optional()
}).refine((value) => Object.keys(value).length > 0);
const chatStreamRequestSchema = z.object({
  conversationId: z.string().min(1).max(191).optional(),
  message: z.string().trim().min(1).max(50_000),
  attachmentIds: z.array(z.string().min(1).max(191)).max(8).optional(),
  parentMessageId: z.string().min(1).max(191).optional(),
  replaceFromMessageId: z.string().min(1).max(191).optional(),
  regenerateFromMessageId: z.string().min(1).max(191).optional(),
  provider: z.string().min(1).max(40).optional(),
  model: z.string().min(1).max(120).optional()
});

export async function chatRoutes(app: FastifyInstance) {
  app.get("/conversations", async (request) => {
    const user = await resolveUser(request);
    const conversations = await prisma.conversation.findMany({
      where: { userId: user.id },
      orderBy: [{ isFavorite: "desc" }, { updatedAt: "desc" }],
      take: 100
    });
    return { conversations: conversations.map(mapConversation) };
  });

  app.post("/conversations", async (request, reply) => {
    const user = await resolveUser(request);
    const parsed = createConversationSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    if (parsed.data.groupId && !(await ownsGroup(user.id, parsed.data.groupId))) {
      return reply.code(400).send({ error: "会话分组不存在。" });
    }
    const conversation = await prisma.conversation.create({
      data: { userId: user.id, title: parsed.data.title ?? "新的对话", groupId: parsed.data.groupId }
    });
    return reply.code(201).send({ conversation: mapConversation(conversation) });
  });

  app.get("/conversations/:id/messages", async (request, reply) => {
    const user = await resolveUser(request);
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "会话参数无效。" });
    const conversation = await prisma.conversation.findFirst({ where: { id: parsed.data.id, userId: user.id } });
    if (!conversation) return reply.code(404).send({ error: "会话不存在。" });
    await ensureLegacyMessageChain(conversation.id);
    const messages = await prisma.message.findMany({
      where: { conversationId: conversation.id },
      include: { attachments: true },
      orderBy: { createdAt: "asc" }
    });
    return { messages: messages.map(mapMessage) };
  });

  app.patch("/conversations/:id", async (request, reply) => {
    const user = await resolveUser(request);
    const params = idParams.safeParse(request.params);
    const body = updateConversationSchema.safeParse(request.body);
    if (!params.success || !body.success) return reply.code(400).send({ error: "会话更新参数无效。" });
    if (body.data.groupId && !(await ownsGroup(user.id, body.data.groupId))) {
      return reply.code(400).send({ error: "会话分组不存在。" });
    }
    let updateData = body.data;
    if (body.data.aiProvider !== undefined || body.data.aiModel !== undefined) {
      if (!body.data.aiProvider || !body.data.aiModel) {
        return reply.code(400).send({ error: "请同时选择模型供应商和模型。" });
      }
      try {
        const selection = resolveAiSelection(body.data.aiProvider, body.data.aiModel);
        updateData = {
          ...body.data,
          aiProvider: selection.provider,
          aiModel: selection.model
        };
      } catch (error) {
        if (error instanceof AiSelectionError) {
          return reply.code(400).send({ error: error.message });
        }
        throw error;
      }
    }
    const updated = await prisma.conversation.updateMany({
      where: { id: params.data.id, userId: user.id }, data: updateData
    });
    if (!updated.count) return reply.code(404).send({ error: "会话不存在。" });
    const conversation = await prisma.conversation.findUniqueOrThrow({ where: { id: params.data.id } });
    return { conversation: mapConversation(conversation) };
  });

  app.delete("/conversations/:id", async (request, reply) => {
    const user = await resolveUser(request);
    const parsed = idParams.safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: "会话参数无效。" });
    const deleted = await prisma.conversation.deleteMany({ where: { id: parsed.data.id, userId: user.id } });
    if (!deleted.count) return reply.code(404).send({ error: "会话不存在。" });
    return reply.code(204).send();
  });

  app.post("/chat/stream", async (request, reply) => {
    const user = await resolveUser(request);
    const parsed = chatStreamRequestSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const conversation = await getOrCreateConversation(user.id, parsed.data.conversationId, parsed.data.message);
    if (!conversation) return reply.code(404).send({ error: "会话不存在。" });

    let modelConfig: AiModelConfig;
    try {
      modelConfig = resolveAiSelection(
        parsed.data.provider ?? conversation.aiProvider,
        parsed.data.model ?? conversation.aiModel
      );
    } catch (error) {
      if (error instanceof AiSelectionError) {
        return reply.code(400).send({ error: error.message });
      }
      throw error;
    }

    let activeConversation = conversation;
    if (conversation.aiProvider !== modelConfig.provider || conversation.aiModel !== modelConfig.model) {
      activeConversation = await prisma.conversation.update({
        where: { id: conversation.id },
        data: { aiProvider: modelConfig.provider, aiModel: modelConfig.model }
      });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": resolveCorsOrigin(request.headers.origin),
      "Access-Control-Allow-Credentials": "true",
      Vary: "Origin"
    });
    let isClosed = false;
    const controller = new AbortController();
    reply.raw.on("close", () => { isClosed = true; controller.abort(); });
    request.raw.on("aborted", () => controller.abort());
    const heartbeat = setInterval(() => {
      if (!isClosed && !reply.raw.writableEnded) reply.raw.write(": ping\n\n");
    }, env.SSE_HEARTBEAT_MS);
    heartbeat.unref();
    const send = (event: ChatStreamEvent) => { if (!isClosed) reply.raw.write(`data: ${JSON.stringify(event)}\n\n`); };

    try {
      send({ type: "conversation", conversation: mapConversation(activeConversation) });
      const userMessage = await resolveUserMessage(request, user.id, conversation.id, parsed.data);
      if (!parsed.data.regenerateFromMessageId) send({ type: "user_message", message: mapMessage(userMessage) });
      const context = await buildContext(conversation.id, userMessage.id);
      let assistantContent = "";
      for await (const delta of streamAiResponse(context, modelConfig, controller.signal)) {
        assistantContent += delta;
        send({ type: "message_delta", delta });
      }
      if (!assistantContent.trim()) throw new Error("AI provider returned an empty response");
      const variantIndex = await prisma.message.count({ where: { parentMessageId: userMessage.id, role: "ASSISTANT" } });
      const assistantMessage = await prisma.message.create({
        data: { conversationId: conversation.id, role: "ASSISTANT", content: assistantContent, parentMessageId: userMessage.id, variantIndex },
        include: { attachments: true }
      });
      await prisma.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } });
      send({ type: "message_done", message: mapMessage(assistantMessage) });
    } catch (error) {
      request.log.error(error);
      send({ type: "error", message: "聊天服务暂时不可用，请稍后重试。" });
    } finally {
      clearInterval(heartbeat);
      if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.end();
    }
  });
}

async function resolveUserMessage(
  request: FastifyRequest,
  userId: string,
  conversationId: string,
  data: z.infer<typeof chatStreamRequestSchema>
) {
  if (data.regenerateFromMessageId) {
    const target = await prisma.message.findFirst({ where: { id: data.regenerateFromMessageId, conversationId, role: "USER" }, include: { attachments: true } });
    if (!target) throw new Error("Regeneration target not found");
    return target;
  }
  let parentMessageId = data.parentMessageId;
  if (data.replaceFromMessageId) {
    const replaced = await prisma.message.findFirst({ where: { id: data.replaceFromMessageId, conversationId, role: "USER" } });
    if (!replaced) throw new Error("Edit target not found");
    parentMessageId = replaced.parentMessageId ?? undefined;
  }
  if (parentMessageId) {
    const parent = await prisma.message.findFirst({ where: { id: parentMessageId, conversationId } });
    if (!parent) throw new Error("Parent message not found");
  }
  const siblingCount = await prisma.message.count({ where: { conversationId, parentMessageId: parentMessageId ?? null, role: "USER" } });
  const message = await prisma.message.create({
    data: { conversationId, role: "USER", content: data.message, parentMessageId: parentMessageId ?? null, variantIndex: siblingCount },
    include: { attachments: true }
  });
  if (data.attachmentIds?.length) {
    const updated = await prisma.attachment.updateMany({
      where: { id: { in: data.attachmentIds }, userId, messageId: null }, data: { messageId: message.id }
    });
    if (updated.count !== data.attachmentIds.length) throw new Error("One or more attachments are invalid");
    return prisma.message.findUniqueOrThrow({ where: { id: message.id }, include: { attachments: true } });
  }
  return message;
}

async function buildContext(conversationId: string, leafId: string): Promise<AiChatMessage[]> {
  const all = await prisma.message.findMany({ where: { conversationId }, include: { attachments: true }, orderBy: { createdAt: "asc" } });
  const byId = new Map(all.map((message) => [message.id, message]));
  const path: typeof all = [];
  let current = byId.get(leafId);
  while (current) {
    path.unshift(current);
    current = current.parentMessageId ? byId.get(current.parentMessageId) : undefined;
  }
  const hasLinkedMessages = all.some((message) => message.parentMessageId);
  let selected: typeof all;
  if (hasLinkedMessages) {
    selected = path;
  } else {
    const leafIndex = all.findIndex((message) => message.id === leafId);
    selected = leafIndex === -1 ? all : all.slice(0, leafIndex + 1);
  }
  return [
    { role: "system", content: "你是 ChatAI，一个直接、清晰、可靠的中文 AI 助手。回答应贴近用户问题，必要时主动说明假设。" },
    ...selected.slice(-24).map((message) => ({
      role: mapRole(message.role),
      content: message.role === "USER" && message.attachments.length
        ? `${message.content}\n\n${message.attachments.map((file) => `[附件：${file.name}]\n${file.extractedText ?? ""}`).join("\n\n")}`
        : message.content
    }))
  ];
}

async function ensureLegacyMessageChain(conversationId: string) {
  const messages = await prisma.message.findMany({
    where: { conversationId }, select: { id: true, parentMessageId: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }]
  });
  if (messages.length < 2 || messages.some((message) => message.parentMessageId)) return;
  await prisma.$transaction(messages.slice(1).map((message, index) => prisma.message.update({
    where: { id: message.id }, data: { parentMessageId: messages[index].id }
  })));
}

async function getOrCreateConversation(userId: string, conversationId: string | undefined, message: string) {
  if (conversationId) return prisma.conversation.findFirst({ where: { id: conversationId, userId } });
  return prisma.conversation.create({ data: { userId, title: buildTitle(message) } });
}
async function ownsGroup(userId: string, groupId: string) {
  return Boolean(await prisma.conversationGroup.findFirst({ where: { id: groupId, userId }, select: { id: true } }));
}
function buildTitle(message: string) {
  const normalized = message.replace(/\s+/g, " ").trim();
  return normalized.length <= 24 ? normalized || "新的对话" : `${normalized.slice(0, 24)}...`;
}
type MessageWithAttachments = Message & { attachments: Attachment[] };
function mapConversation(conversation: Conversation): ConversationSummary {
  return { id: conversation.id, title: conversation.title, isFavorite: conversation.isFavorite, isArchived: conversation.isArchived, groupId: conversation.groupId, aiProvider: conversation.aiProvider, aiModel: conversation.aiModel, createdAt: conversation.createdAt.toISOString(), updatedAt: conversation.updatedAt.toISOString() };
}
function mapMessage(message: MessageWithAttachments): ChatMessage {
  return {
    id: message.id, conversationId: message.conversationId, role: mapRole(message.role), content: message.content,
    parentMessageId: message.parentMessageId, variantIndex: message.variantIndex,
    attachments: message.attachments.map((file) => ({ id: file.id, name: file.name, mimeType: file.mimeType, size: file.size, status: file.status as "PROCESSING" | "READY" | "FAILED", createdAt: file.createdAt.toISOString() })),
    createdAt: message.createdAt.toISOString()
  };
}
function mapRole(role: MessageRole): ChatRole {
  return role === "SYSTEM" ? "system" : role === "USER" ? "user" : "assistant";
}
function resolveCorsOrigin(origin: string | undefined) {
  return origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0] ?? "*";
}
