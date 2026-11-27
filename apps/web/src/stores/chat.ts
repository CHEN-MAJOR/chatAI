import type { AiModelOption, AiModelSelection, AttachmentSummary, ChatMessage, ConversationSummary } from "@chatai/shared";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { deleteConversation, fetchAiModels, fetchConversations, fetchMessages, streamChat, updateConversation } from "../services/api";
import { createBrowserId } from "../utils/id";

const pendingConversationId = "pending";
const modelSelectionStorageKey = "chatai-model-selection";
type SendOptions = { attachments?: AttachmentSummary[]; replaceFromMessageId?: string; regenerateFromMessageId?: string };

export const useChatStore = defineStore("chat", () => {
  const conversations = ref<ConversationSummary[]>([]);
  const allMessages = ref<ChatMessage[]>([]);
  const activeConversationId = ref<string | null>(null);
  const branchSelections = ref<Record<string, string>>({});
  const isLoadingConversations = ref(false);
  const isLoadingMessages = ref(false);
  const isStreaming = ref(false);
  const isReceiving = ref(false);
  const errorMessage = ref("");
  const isServiceAvailable = ref<boolean | null>(null);
  const aiModels = ref<AiModelOption[]>([]);
  const aiDefaultSelection = ref<AiModelSelection | null>(null);
  const selectedAiProvider = ref("");
  const selectedAiModel = ref("");
  const isLoadingAiModels = ref(false);
  let errorTimer: ReturnType<typeof setTimeout> | undefined;
  let streamController: AbortController | null = null;
  const messageRenderKeys = new Map<string, string>();

  const activeConversation = computed(() => conversations.value.find((item) => item.id === activeConversationId.value));
  const messages = computed(() => buildActivePath(allMessages.value, branchSelections.value));
  const selectedAiOption = computed(() => aiModels.value.find((item) => item.provider === selectedAiProvider.value && item.model === selectedAiModel.value) ?? null);

  async function loadConversations() {
    isLoadingConversations.value = true;
    clearError();
    try {
      conversations.value = await fetchConversations();
      isServiceAvailable.value = true;
      if (!activeConversationId.value && conversations.value[0]) await selectConversation(conversations.value[0].id);
      else applyConversationSelection(activeConversation.value);
    } catch (error) { isServiceAvailable.value = false; showError(error); }
    finally { isLoadingConversations.value = false; }
  }

  async function loadAiModels() {
    isLoadingAiModels.value = true;
    try {
      const catalog = await fetchAiModels();
      aiModels.value = catalog.models;
      aiDefaultSelection.value = catalog.defaultSelection;
      const conversation = activeConversation.value;
      if (conversation?.aiProvider && conversation.aiModel && hasModel(conversation.aiProvider, conversation.aiModel)) {
        applySelection({ provider: conversation.aiProvider, model: conversation.aiModel }, false);
        return;
      }
      if (selectedAiProvider.value && selectedAiModel.value && hasModel(selectedAiProvider.value, selectedAiModel.value)) {
        return;
      }
      const stored = readStoredModelSelection();
      const candidate = stored && hasModel(stored.provider, stored.model)
        ? stored
        : catalog.defaultSelection;
      if (candidate && hasModel(candidate.provider, candidate.model)) {
        applySelection(candidate, false);
      }
    } catch (error) {
      showError(error);
    } finally {
      isLoadingAiModels.value = false;
    }
  }

  async function selectAiModel(provider: string, model: string) {
    if (!hasModel(provider, model) || isStreaming.value) return false;
    const conversation = activeConversation.value;
    const previous = conversation?.aiProvider && conversation.aiModel
      ? { provider: conversation.aiProvider, model: conversation.aiModel }
      : null;
    applySelection({ provider, model });
    if (!conversation) return true;
    try {
      upsertConversation(await updateConversation(conversation.id, { aiProvider: provider, aiModel: model }));
      return true;
    } catch (error) {
      if (previous) applySelection(previous, false);
      showError(error);
      return false;
    }
  }

  function hasModel(provider: string, model: string) {
    return aiModels.value.some((item) => item.provider === provider && item.model === model);
  }

  function applySelection(selection: AiModelSelection, persist = true) {
    selectedAiProvider.value = selection.provider;
    selectedAiModel.value = selection.model;
    if (persist) writeStoredModelSelection(selection);
  }

  function applyConversationSelection(conversation: ConversationSummary | null | undefined) {
    if (conversation?.aiProvider && conversation.aiModel && hasModel(conversation.aiProvider, conversation.aiModel)) {
      applySelection({ provider: conversation.aiProvider, model: conversation.aiModel }, false);
      return;
    }
    const stored = readStoredModelSelection();
    if (stored && hasModel(stored.provider, stored.model)) {
      applySelection(stored, false);
      return;
    }
    if (aiDefaultSelection.value && hasModel(aiDefaultSelection.value.provider, aiDefaultSelection.value.model)) {
      applySelection(aiDefaultSelection.value, false);
    }
  }

  async function selectConversation(conversationId: string) {
    if (isStreaming.value) return;
    activeConversationId.value = conversationId;
    isLoadingMessages.value = true;
    branchSelections.value = {};
    clearError();
    try {
      messageRenderKeys.clear();
      allMessages.value = (await fetchMessages(conversationId)).filter((message) => message.role !== "assistant" || message.content.trim());
      isServiceAvailable.value = true;
      applyConversationSelection(conversations.value.find((item) => item.id === conversationId));
    } catch (error) { isServiceAvailable.value = false; showError(error); }
    finally { isLoadingMessages.value = false; }
  }

  function startNewConversation() {
    if (isStreaming.value) return;
    activeConversationId.value = null;
    allMessages.value = [];
    messageRenderKeys.clear();
    branchSelections.value = {};
    applyConversationSelection(null);
    clearError();
  }

  async function removeConversation(conversationId: string) {
    if (isStreaming.value) return false;
    try {
      await deleteConversation(conversationId);
      conversations.value = conversations.value.filter((item) => item.id !== conversationId);
      if (activeConversationId.value === conversationId) {
        const next = conversations.value.find((item) => !item.isArchived);
        next ? await selectConversation(next.id) : startNewConversation();
      }
      return true;
    } catch (error) { showError(error); return false; }
  }

  async function editConversation(
    conversationId: string,
    updates: Partial<Pick<ConversationSummary, "title" | "isFavorite" | "isArchived" | "groupId">>
  ) {
    try {
      upsertConversation(await updateConversation(conversationId, updates));
      sortConversations();
      return true;
    } catch (error) { showError(error); return false; }
  }

  async function sendMessage(content: string, options: SendOptions = {}) {
    const message = content.trim();
    if (!message || isStreaming.value) return;
    const visible = messages.value;
    const replaceTarget = options.replaceFromMessageId ? allMessages.value.find((item) => item.id === options.replaceFromMessageId) : undefined;
    const parentMessageId = replaceTarget ? replaceTarget.parentMessageId : visible.at(-1)?.id ?? null;
    const regenerateTarget = options.regenerateFromMessageId ? allMessages.value.find((item) => item.id === options.regenerateFromMessageId) : undefined;
    const localUser = regenerateTarget ? null : makeLocalMessage("user", message, parentMessageId, options.attachments ?? []);
    const assistantParentId = regenerateTarget?.id ?? localUser!.id;
    const localAssistant = makeLocalMessage("assistant", "", assistantParentId);
    const localAssistantId = localAssistant.id;
    if (localUser) {
      messageRenderKeys.set(localUser.id, localUser.id);
      allMessages.value.push(localUser);
      branchSelections.value[parentKey(localUser.parentMessageId)] = localUser.id;
    }
    messageRenderKeys.set(localAssistant.id, localAssistant.id);
    allMessages.value.push(localAssistant);
    branchSelections.value[parentKey(assistantParentId)] = localAssistant.id;
    isStreaming.value = true;
    isReceiving.value = true;
    clearError();
    const controller = new AbortController();
    streamController = controller;
    let streamCompleted = false;

    try {
      await streamChat({
        conversationId: activeConversationId.value ?? undefined,
        message,
        attachmentIds: options.attachments?.map((file) => file.id),
        parentMessageId: replaceTarget ? undefined : parentMessageId ?? undefined,
        replaceFromMessageId: options.replaceFromMessageId,
        regenerateFromMessageId: options.regenerateFromMessageId,
        provider: selectedAiProvider.value || undefined,
        model: selectedAiModel.value || undefined
      }, (event) => {
        if (event.type === "conversation") {
          activeConversationId.value = event.conversation.id;
          upsertConversation(event.conversation);
          applyConversationSelection(event.conversation);
          movePendingMessages(event.conversation.id);
        } else if (event.type === "user_message" && localUser) {
          replaceLocalMessage(localUser.id, event.message);
          patchMessage(localAssistantId, { parentMessageId: event.message.id });
          branchSelections.value[parentKey(event.message.parentMessageId)] = event.message.id;
          branchSelections.value[parentKey(event.message.id)] = localAssistantId;
        } else if (event.type === "message_delta") {
          patchMessage(localAssistantId, (current) => ({ content: current.content + event.delta }));
        } else if (event.type === "message_done") {
          streamCompleted = true;
          replaceLocalMessage(localAssistantId, event.message);
          branchSelections.value[parentKey(event.message.parentMessageId)] = event.message.id;
          isReceiving.value = false;
        } else if (event.type === "error") showError(event.message);
      }, controller.signal);
      if (activeConversationId.value) syncServerMessages(await fetchMessages(activeConversationId.value));
      await loadConversations();
    } catch (error) {
      if (controller.signal.aborted) {
        const currentAssistant = allMessages.value.find((item) => item.id === localAssistantId);
        allMessages.value = allMessages.value.filter((item) => item.id !== localAssistantId || item.content.trim());
        if (!currentAssistant?.content.trim()) messageRenderKeys.delete(localAssistantId);
      } else {
        if (!streamCompleted) patchMessage(localAssistantId, { content: "发送失败，请稍后再试。" });
        // 同步服务端消息，移除只在本地存在的失败占位，避免下一次发送引用失效的父消息。
        if (activeConversationId.value) {
          try { syncServerMessages(await fetchMessages(activeConversationId.value)); } catch { /* 保留当前失败提示 */ }
        } else {
          await loadConversations();
        }
        // 模型/供应商错误说明后端仍在线，只有真正的网络故障才标记离线。
        if (error instanceof TypeError) isServiceAvailable.value = false;
        showError(error);
      }
    } finally {
      if (streamController === controller) streamController = null;
      isReceiving.value = false;
      isStreaming.value = false;
    }
  }

  function variantsFor(message: ChatMessage) {
    return allMessages.value.filter((item) => item.role === message.role && item.parentMessageId === message.parentMessageId).sort((a, b) => a.variantIndex - b.variantIndex || a.createdAt.localeCompare(b.createdAt));
  }
  function selectVariant(message: ChatMessage) {
    branchSelections.value[parentKey(message.parentMessageId)] = message.id;
  }
  function messageRenderKey(message: ChatMessage) {
    return messageRenderKeys.get(message.id) ?? message.id;
  }
  function stopStreaming() { streamController?.abort(); }
  function upsertConversation(conversation: ConversationSummary) {
    const index = conversations.value.findIndex((item) => item.id === conversation.id);
    index === -1 ? conversations.value.unshift(conversation) : conversations.value.splice(index, 1, conversation);
  }
  function sortConversations() { conversations.value.sort((a, b) => Number(b.isFavorite) - Number(a.isFavorite) || b.updatedAt.localeCompare(a.updatedAt)); }
  function replaceLocalMessage(localId: string, message: ChatMessage) {
    const index = allMessages.value.findIndex((item) => item.id === localId);
    if (index === -1) return;
    const renderKey = messageRenderKeys.get(localId) ?? localId;
    messageRenderKeys.delete(localId);
    messageRenderKeys.set(message.id, renderKey);
    allMessages.value.splice(index, 1, message);
  }
  function patchMessage(messageId: string, patch: Partial<ChatMessage> | ((message: ChatMessage) => Partial<ChatMessage>)) {
    const index = allMessages.value.findIndex((item) => item.id === messageId);
    if (index === -1) return;
    const current = allMessages.value[index];
    const nextPatch = typeof patch === "function" ? patch(current) : patch;
    allMessages.value.splice(index, 1, { ...current, ...nextPatch });
  }
  function syncServerMessages(messages: ChatMessage[]) {
    const serverIds = new Set(messages.map((message) => message.id));
    for (const id of messageRenderKeys.keys()) {
      if (!serverIds.has(id)) messageRenderKeys.delete(id);
    }
    allMessages.value = messages;
  }
  function movePendingMessages(conversationId: string) {
    allMessages.value = allMessages.value.map((message) => message.conversationId === pendingConversationId ? { ...message, conversationId } : message);
  }
  function clearError() {
    errorMessage.value = "";
    if (errorTimer) { clearTimeout(errorTimer); errorTimer = undefined; }
  }
  function showError(error: unknown) {
    clearError();
    errorMessage.value = normalizeError(error);
    errorTimer = setTimeout(clearError, 8000);
  }

  return {
    activeConversation, activeConversationId, aiDefaultSelection, aiModels, allMessages, conversations, clearError, editConversation,
    errorMessage, isLoadingAiModels, isLoadingConversations, isLoadingMessages, isReceiving, isStreaming, isServiceAvailable,
    loadAiModels, loadConversations, messageRenderKey, messages, removeConversation, selectAiModel, selectConversation, selectVariant, selectedAiOption, selectedAiModel, selectedAiProvider, sendMessage,
    startNewConversation, stopStreaming, variantsFor
  };
});

function parentKey(parentId: string | null) { return parentId ?? "__root__"; }
function buildActivePath(all: ChatMessage[], selections: Record<string, string>) {
  if (!all.length || !all.some((item) => item.parentMessageId)) return all;
  const children = new Map<string, ChatMessage[]>();
  for (const message of all) {
    const key = parentKey(message.parentMessageId);
    const group = children.get(key) ?? [];
    group.push(message);
    children.set(key, group);
  }
  for (const group of children.values()) group.sort((a, b) => a.variantIndex - b.variantIndex || a.createdAt.localeCompare(b.createdAt));
  const path: ChatMessage[] = [];
  let key = "__root__";
  const seen = new Set<string>();
  while (children.get(key)?.length) {
    const options = children.get(key)!;
    const chosen = options.find((item) => item.id === selections[key]) ?? options.at(-1)!;
    if (seen.has(chosen.id)) break;
    seen.add(chosen.id);
    path.push(chosen);
    key = chosen.id;
  }
  return path;
}
function makeLocalMessage(role: "user" | "assistant", content: string, parentMessageId: string | null, attachments: AttachmentSummary[] = []): ChatMessage {
  return { id: createBrowserId(), conversationId: pendingConversationId, role, content, parentMessageId, variantIndex: 0, attachments, createdAt: new Date().toISOString() };
}
function normalizeError(error: unknown) {
  if (typeof error === "string") return error;
  if (error instanceof TypeError && error.message === "Failed to fetch") return "无法连接到 AI 服务，请确认后端服务已启动。";
  return error instanceof Error ? error.message : "请求失败，请稍后重试。";
}
function readStoredModelSelection(): AiModelSelection | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(modelSelectionStorageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AiModelSelection>;
    if (typeof parsed.provider !== "string" || typeof parsed.model !== "string") return null;
    if (!parsed.provider || !parsed.model) return null;
    return { provider: parsed.provider, model: parsed.model };
  } catch {
    return null;
  }
}
function writeStoredModelSelection(selection: AiModelSelection) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(modelSelectionStorageKey, JSON.stringify(selection));
  } catch {
    // The current session still keeps the selection in memory.
  }
}
