export type ChatRole = "system" | "user" | "assistant";

export interface ConversationSummary {
  id: string;
  title: string;
  isFavorite: boolean;
  isArchived: boolean;
  groupId: string | null;
  aiProvider: string | null;
  aiModel: string | null;
  createdAt: string;
  updatedAt: string;
}

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

export interface AiModelCatalog {
  models: AiModelOption[];
  defaultSelection: AiModelSelection;
}

export interface AttachmentSummary {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  status: "PROCESSING" | "READY" | "FAILED";
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: string;
  parentMessageId: string | null;
  variantIndex: number;
  attachments: AttachmentSummary[];
  createdAt: string;
}

export interface ConversationGroup {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PromptTemplate {
  id: string;
  title: string;
  content: string;
  category: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChatStreamRequest {
  conversationId?: string;
  message: string;
  attachmentIds?: string[];
  parentMessageId?: string;
  replaceFromMessageId?: string;
  regenerateFromMessageId?: string;
  provider?: string;
  model?: string;
}

export type ChatStreamEvent =
  | { type: "conversation"; conversation: ConversationSummary }
  | { type: "user_message"; message: ChatMessage }
  | { type: "message_delta"; delta: string }
  | { type: "message_done"; message: ChatMessage }
  | { type: "error"; message: string };
