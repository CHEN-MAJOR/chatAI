import type {
  AiModelCatalog, AttachmentSummary, ChatMessage, ChatStreamEvent, ChatStreamRequest,
  ConversationGroup, ConversationSummary, PromptTemplate
} from "@chatai/shared";
import { createBrowserId } from "../utils/id";

// Keep LAN access working without hard-coding the machine's current IP.
// An explicit VITE_API_BASE_URL still takes precedence for deployed setups.
const configuredApiBaseUrl = import.meta.env?.VITE_API_BASE_URL?.trim();
const API_BASE_URL = (configuredApiBaseUrl || (
  typeof window !== "undefined"
    ? `${window.location.protocol}//${window.location.hostname}:4000`
    : "http://localhost:4000"
)).replace(/\/+$/, "");
const clientIdKey = "chatai-client-id";
const tokenKey = "chatai-auth-token";
const volatileStorage = new Map<string, string | null>();

export interface AuthUser { id: string; name: string | null; email: string | null }

function readStorage(key: string) {
  if (volatileStorage.has(key)) return volatileStorage.get(key) ?? null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
    volatileStorage.delete(key);
  } catch {
    // Keep the value in memory when persistent browser storage is unavailable.
    volatileStorage.set(key, value);
  }
}

function removeStorage(key: string) {
  try {
    window.localStorage.removeItem(key);
    volatileStorage.delete(key);
  } catch {
    // The in-memory tombstone prevents a stale value from being reused.
    volatileStorage.set(key, null);
  }
}

function clientId() {
  let value = readStorage(clientIdKey);
  if (!value) { value = createBrowserId(); writeStorage(clientIdKey, value); }
  return value;
}
function headers(json = false) {
  const result: Record<string, string> = { "x-user-id": clientId() };
  const token = readStorage(tokenKey);
  if (token) result.Authorization = `Bearer ${token}`;
  if (json) result["Content-Type"] = "application/json";
  return result;
}
async function apiFetch(path: string, init: RequestInit = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { ...headers(Boolean(init.body && !(init.body instanceof FormData))), ...(init.headers ?? {}) }
  });
  await ensureOk(response);
  return response;
}

export async function fetchConversations() {
  const response = await apiFetch("/api/conversations");
  return ((await response.json()) as { conversations: ConversationSummary[] }).conversations;
}
export async function fetchAiModels() {
  const response = await apiFetch("/api/ai/models");
  return (await response.json()) as AiModelCatalog;
}
export async function fetchMessages(conversationId: string) {
  const response = await apiFetch(`/api/conversations/${conversationId}/messages`);
  return ((await response.json()) as { messages: ChatMessage[] }).messages;
}
export async function createConversation(title?: string, groupId?: string | null) {
  const response = await apiFetch("/api/conversations", { method: "POST", body: JSON.stringify({ title, groupId }) });
  return ((await response.json()) as { conversation: ConversationSummary }).conversation;
}
export async function deleteConversation(conversationId: string) {
  await apiFetch(`/api/conversations/${conversationId}`, { method: "DELETE" });
}
export async function updateConversation(
  conversationId: string,
  updates: Partial<Pick<ConversationSummary, "title" | "isFavorite" | "isArchived" | "groupId" | "aiProvider" | "aiModel">>
) {
  const response = await apiFetch(`/api/conversations/${conversationId}`, { method: "PATCH", body: JSON.stringify(updates) });
  return ((await response.json()) as { conversation: ConversationSummary }).conversation;
}

export async function uploadAttachment(file: File, onProgress?: (percent: number) => void) {
  onProgress?.(10);
  const form = new FormData();
  form.append("file", file);
  const response = await apiFetch("/api/attachments", { method: "POST", body: form });
  onProgress?.(100);
  return ((await response.json()) as { attachment: AttachmentSummary }).attachment;
}
export async function deleteAttachment(id: string) {
  await apiFetch(`/api/attachments/${id}`, { method: "DELETE" });
}

export async function fetchGroups() {
  const response = await apiFetch("/api/groups");
  return ((await response.json()) as { groups: ConversationGroup[] }).groups;
}
export async function createGroup(name: string) {
  const response = await apiFetch("/api/groups", { method: "POST", body: JSON.stringify({ name }) });
  return ((await response.json()) as { group: ConversationGroup }).group;
}
export async function updateGroup(id: string, updates: Partial<Pick<ConversationGroup, "name" | "color" | "sortOrder">>) {
  const response = await apiFetch(`/api/groups/${id}`, { method: "PATCH", body: JSON.stringify(updates) });
  return ((await response.json()) as { group: ConversationGroup }).group;
}
export async function deleteGroup(id: string) { await apiFetch(`/api/groups/${id}`, { method: "DELETE" }); }

export async function fetchPrompts() {
  const response = await apiFetch("/api/prompts");
  return ((await response.json()) as { prompts: PromptTemplate[] }).prompts;
}
export async function createPrompt(input: Pick<PromptTemplate, "title" | "content" | "category">) {
  const response = await apiFetch("/api/prompts", { method: "POST", body: JSON.stringify(input) });
  return ((await response.json()) as { prompt: PromptTemplate }).prompt;
}
export async function updatePrompt(id: string, input: Partial<Pick<PromptTemplate, "title" | "content" | "category">>) {
  const response = await apiFetch(`/api/prompts/${id}`, { method: "PATCH", body: JSON.stringify(input) });
  return ((await response.json()) as { prompt: PromptTemplate }).prompt;
}
export async function deletePrompt(id: string) { await apiFetch(`/api/prompts/${id}`, { method: "DELETE" }); }

export async function register(input: { email: string; password: string; name?: string }) {
  return authenticate("/api/auth/register", input);
}
export async function login(input: { email: string; password: string }) {
  return authenticate("/api/auth/login", input);
}
async function authenticate(path: string, input: object) {
  const response = await apiFetch(path, { method: "POST", body: JSON.stringify(input) });
  const payload = await response.json() as { token: string; user: AuthUser };
  writeStorage(tokenKey, payload.token);
  return payload.user;
}
export async function fetchCurrentUser() {
  const response = await apiFetch("/api/auth/me");
  return ((await response.json()) as { user: AuthUser }).user;
}
export async function logout() {
  await apiFetch("/api/auth/session", { method: "DELETE" });
  removeStorage(tokenKey);
}
export function hasAuthToken() { return Boolean(readStorage(tokenKey)); }

export async function streamChat(request: ChatStreamRequest, onEvent: (event: ChatStreamEvent) => void, signal?: AbortSignal) {
  const response = await fetch(`${API_BASE_URL}/api/chat/stream`, {
    method: "POST", headers: headers(true), body: JSON.stringify(request), signal
  });
  await ensureOk(response);
  if (!response.body) throw new Error("当前浏览器不支持流式响应。" );
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let receivedDone = false;
  let streamError = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    const parsed = parseSseBuffer(buffer);
    buffer = parsed.remainder;
    for (const data of parsed.events) {
      try {
        const event = JSON.parse(data) as ChatStreamEvent;
        if (event.type === "message_done") receivedDone = true;
        if (event.type === "error") streamError = event.message;
        onEvent(event);
      } catch { /* Ignore malformed keep-alive events. */ }
    }
  }
  if (streamError) throw new Error(streamError);
  if (!receivedDone) throw new Error("连接提前结束，回答可能不完整，请重新发送。" );
}
function parseSseBuffer(buffer: string) {
  const events: string[] = [];
  let remainder = buffer;
  let boundary = remainder.indexOf("\n\n");
  while (boundary !== -1) {
    const raw = remainder.slice(0, boundary);
    remainder = remainder.slice(boundary + 2);
    const data = raw.split("\n").map((line) => line.trim()).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
    if (data) events.push(data);
    boundary = remainder.indexOf("\n\n");
  }
  return { events, remainder };
}
async function ensureOk(response: Response) {
  if (response.ok) return;
  const body = await response.text();
  let message = "";
  try {
    const payload = JSON.parse(body) as { message?: string; error?: string | object };
    message = typeof payload.error === "string" ? payload.error : payload.message ?? "";
  } catch { message = body; }
  throw new Error(message || `请求失败（${response.status}）`);
}
