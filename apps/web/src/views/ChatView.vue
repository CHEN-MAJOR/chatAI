<script setup lang="ts">
import type { AiModelOption, AttachmentSummary, ChatMessage, ConversationGroup, ConversationSummary, PromptTemplate } from "@chatai/shared";
import {
  Archive, ArrowDown, Bot, Check, CircleAlert, Copy, Download, Library, LoaderCircle, Menu,
  MessageSquarePlus, Moon, Palette, Paperclip, Pencil, RefreshCw, Save, Search, Send,
  Settings2, Sparkles, Square, Star, Sun, Trash2, UserRound, X, ChevronLeft, ChevronRight, ChevronDown, FolderTree
} from "@lucide/vue";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useChatStore } from "../stores/chat";
import MarkdownContent from "../components/MarkdownContent.vue";
import WorkspaceLibrary, { type CloudPromptLibraryItem, type PromptLibraryDraft } from "../components/WorkspaceLibrary.vue";
import AccountDialog from "../components/AccountDialog.vue";
import CommandPalette from "../components/CommandPalette.vue";
import SciFiParticleField from "../components/SciFiParticleField.vue";
import { useModalFocus } from "../composables/useModalFocus";
import {
  BUILT_IN_VISUAL_PRESETS,
  CUSTOM_VISUAL_PRESETS_STORAGE_KEY,
  MAX_CUSTOM_VISUAL_PRESETS,
  MAX_VISUAL_PRESET_NAME_LENGTH,
  loadCustomVisualPresets,
  removeCustomVisualPreset,
  saveCustomVisualPreset,
  type VisualPreset,
  type VisualPresetDraft
} from "../utils/visualPresets";
import {
  createGroup, createPrompt, deleteAttachment, deleteGroup, deletePrompt, fetchGroups, fetchPrompts,
  updateGroup, updatePrompt, uploadAttachment, fetchCurrentUser, hasAuthToken, type AuthUser
} from "../services/api";

const themeOptions = ["light", "dark", "system"] as const;
const densityOptions = ["comfortable", "compact"] as const;
type Theme = typeof themeOptions[number];
type Density = typeof densityOptions[number];
const accentOptions = ["emerald", "blue", "violet", "coral", "rose", "champagne"] as const;
type Accent = typeof accentOptions[number];
const motionOptions = ["full", "subtle", "reduced"] as const;
type MotionLevel = typeof motionOptions[number];
const visualMoodOptions = ["cyber", "fusion", "soft"] as const;
type VisualMood = typeof visualMoodOptions[number];
const ACTIVE_VISUAL_PRESET_STORAGE_KEY = "chatai-active-visual-preset";

const accentLabels: Record<Accent, string> = {
  emerald: "翡翠绿",
  blue: "星际蓝",
  violet: "星云紫",
  coral: "珊瑚橙",
  rose: "玫瑰粉",
  champagne: "香槟金"
};

function readLocalPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalPreference(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Preferences remain usable for the current session when storage is blocked.
  }
}

function removeLocalPreference(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing else is required when storage is unavailable.
  }
}

function readStoredChoice<T extends string>(key: string, options: readonly T[], fallback: T): T {
  const value = readLocalPreference(key);
  return options.includes(value as T) ? value as T : fallback;
}

function readStoredPercentage(key: string, fallback: number): number {
  const storedValue = readLocalPreference(key);
  if (storedValue === null) return fallback;
  const value = Number(storedValue);
  return Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : fallback;
}

function readStoredBoolean(key: string, fallback: boolean): boolean {
  const storedValue = readLocalPreference(key);
  if (storedValue === "true") return true;
  if (storedValue === "false") return false;
  return fallback;
}

const chatStore = useChatStore();
const draft = ref("");
const searchQuery = ref("");
const conversationFilter = ref<"active" | "favorites" | "archived">("active");
const messageList = ref<HTMLElement | null>(null);
const composerInput = ref<HTMLTextAreaElement | null>(null);
const fileInput = ref<HTMLInputElement | null>(null);
const settingsDialog = ref<HTMLElement | null>(null);
const settingsTrigger = ref<HTMLButtonElement | null>(null);
const modelPicker = ref<HTMLElement | null>(null);
const modelPickerTrigger = ref<HTMLButtonElement | null>(null);
const modelMenu = ref<HTMLElement | null>(null);
const isModelMenuOpen = ref(false);
const presetNameInput = ref<HTMLInputElement | null>(null);
const isSidebarOpen = ref(false);
const isSettingsOpen = ref(false);
const isWorkspaceOpen = ref(false);
const isAccountOpen = ref(false);
const isCommandPaletteOpen = ref(false);
const currentUser = ref<AuthUser | null>(null);
const workspaceTab = ref<"groups" | "prompts">("groups");
const showScrollButton = ref(false);
const shouldAutoScroll = ref(true);
const copiedMessageId = ref<string | null>(null);
const deleteDialog = ref<HTMLDialogElement | null>(null);
const pendingDelete = ref<ConversationSummary | null>(null);
const isDeleting = ref(false);
const deleteError = ref("");
const attachments = ref<AttachmentSummary[]>([]);
const isUploading = ref(false);
const uploadProgress = ref(0);
const editingMessageId = ref<string | null>(null);
const groups = ref<ConversationGroup[]>([]);
const cloudPrompts = ref<PromptTemplate[]>([]);
const activeGroupId = ref<string | null>(null);
const isWorkspaceLoading = ref(false);
const isWorkspaceSyncing = ref(false);
const workspaceBusyId = ref<string | null>(null);
const workspaceError = ref("");
const theme = ref<Theme>(readStoredChoice("chatai-theme", themeOptions, "system"));
const density = ref<Density>(readStoredChoice("chatai-density", densityOptions, "comfortable"));
const accent = ref<Accent>(readStoredChoice("chatai-accent", accentOptions, "emerald"));
const motionLevel = ref<MotionLevel>(readStoredChoice("chatai-motion", motionOptions, "full"));
const visualMood = ref<VisualMood>(readStoredChoice("chatai-visual-mood", visualMoodOptions, "cyber"));
const softIntensity = ref(readStoredPercentage("chatai-soft-intensity", 55));
const particlesEnabled = ref(readStoredBoolean("chatai-particles-enabled", true));
const particleIntensity = ref(readStoredPercentage("chatai-particle-intensity", 45));
const customVisualPresets = ref<VisualPreset[]>(loadCustomVisualPresets());
const presetName = ref("");
const editingPresetId = ref<string | null>(null);
const lastAppliedVisualPresetId = ref<string | null>(readLocalPreference(ACTIVE_VISUAL_PRESET_STORAGE_KEY));
const presetStatus = ref("");
const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
let copyTimer: ReturnType<typeof setTimeout> | undefined;
let presetStatusTimer: ReturnType<typeof setTimeout> | undefined;
const builtInVisualPresetIds = new Set(BUILT_IN_VISUAL_PRESETS.map((preset) => preset.id));
useModalFocus(isSettingsOpen, settingsDialog, settingsTrigger);
applyPreferences();

const suggestions = [
  { icon: "✦", title: "梳理产品需求", prompt: "帮我梳理一个产品需求，并输出目标、用户故事和验收标准" },
  { icon: "⌘", title: "解释技术方案", prompt: "请用通俗易懂的方式解释这段技术方案，并指出潜在风险" },
  { icon: "↗", title: "优化文字表达", prompt: "帮我优化下面这段文字，让表达更清晰、专业且自然" },
  { icon: "◎", title: "制定行动计划", prompt: "根据我的目标，帮我制定一份可执行的分步行动计划" }
];

const filteredConversations = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  return chatStore.conversations.filter((item) => {
    const matchesSearch = !query || item.title.toLocaleLowerCase().includes(query);
    const matchesFilter = conversationFilter.value === "favorites" ? item.isFavorite && !item.isArchived : conversationFilter.value === "archived" ? item.isArchived : !item.isArchived;
    const matchesGroup = !activeGroupId.value || item.groupId === activeGroupId.value;
    return matchesSearch && matchesFilter && matchesGroup;
  });
});
const visibleMessages = computed(() => chatStore.messages.filter((message, index) =>
  Boolean(message.content.trim()) || (chatStore.isStreaming && index === chatStore.messages.length - 1)
));
const draftCount = computed(() => draft.value.length);
const workspaceGroups = computed(() => groups.value.map((group) => ({
  ...group,
  conversationCount: chatStore.conversations.filter((item) => item.groupId === group.id).length
})));
const workspacePrompts = computed(() => cloudPrompts.value.map((prompt) => ({
  ...prompt, isSynced: true, description: "云端同步"
})));
const visualPresets = computed(() => [
  ...BUILT_IN_VISUAL_PRESETS,
  ...customVisualPresets.value
]);
const aiModelGroups = computed(() => {
  const groups = new Map<string, { provider: string; providerLabel: string; models: AiModelOption[] }>();
  for (const item of chatStore.aiModels) {
    const group = groups.get(item.provider) ?? {
      provider: item.provider,
      providerLabel: item.providerLabel,
      models: []
    };
    group.models.push(item);
    groups.set(item.provider, group);
  }
  return [...groups.values()];
});
const providerMarks: Record<string, string> = {
  openai: "O",
  deepseek: "DS",
  qwen: "Q",
  kimi: "K",
  gemini: "G",
  custom: "AI",
  mock: "M"
};
const selectedProviderMark = computed(() => providerMarks[chatStore.selectedAiProvider] ?? "AI");
const selectedProviderLabel = computed(() => chatStore.selectedAiOption?.providerLabel ?? "模型供应商");
const selectedModelLabel = computed(() => chatStore.selectedAiOption?.label ?? (chatStore.selectedAiModel || "选择模型"));
const activeVisualPresetId = computed(() => {
  const matchingPresets = visualPresets.value.filter(matchesCurrentVisualPreset);
  const lastAppliedPreset = matchingPresets.find((preset) => preset.id === lastAppliedVisualPresetId.value);
  return lastAppliedPreset?.id ?? matchingPresets[0]?.id ?? null;
});

onMounted(async () => {
  draft.value = readLocalPreference("chatai-draft") || "";
  window.addEventListener("keydown", handleGlobalShortcut);
  window.addEventListener("storage", handlePreferenceStorageChange);
  document.addEventListener("pointerdown", handleDocumentPointerDown);
  mediaQuery.addEventListener("change", applyPreferences);
  await Promise.all([chatStore.loadAiModels(), chatStore.loadConversations(), loadWorkspace()]);
  if (hasAuthToken()) currentUser.value = await fetchCurrentUser().catch(() => null);
  await nextTick();
  scrollToBottom(false);
});
onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleGlobalShortcut);
  window.removeEventListener("storage", handlePreferenceStorageChange);
  document.removeEventListener("pointerdown", handleDocumentPointerDown);
  mediaQuery.removeEventListener("change", applyPreferences);
  if (copyTimer) clearTimeout(copyTimer);
  if (presetStatusTimer) clearTimeout(presetStatusTimer);
});
watch(() => [chatStore.messages.length, chatStore.messages.at(-1)?.content], async () => {
  await nextTick();
  if (shouldAutoScroll.value) scrollToBottom(false);
  updateScrollState();
});
watch(() => chatStore.activeConversationId, async () => {
  shouldAutoScroll.value = true;
  await nextTick();
  scrollToBottom(false);
});
watch(
  [theme, density, accent, motionLevel, visualMood, softIntensity, particlesEnabled, particleIntensity],
  applyPreferences
);
watch(draft, (value) => writeLocalPreference("chatai-draft", value));
watch(lastAppliedVisualPresetId, (value) => {
  if (value) writeLocalPreference(ACTIVE_VISUAL_PRESET_STORAGE_KEY, value);
  else removeLocalPreference(ACTIVE_VISUAL_PRESET_STORAGE_KEY);
});
watch(() => chatStore.isStreaming, (streaming) => {
  if (streaming) isModelMenuOpen.value = false;
});
watch(() => chatStore.activeConversationId, () => {
  isModelMenuOpen.value = false;
});

function matchesCurrentVisualPreset(preset: Readonly<VisualPreset>) {
  return preset.theme === theme.value
    && preset.density === density.value
    && preset.accent === accent.value
    && preset.motionLevel === motionLevel.value
    && preset.visualMood === visualMood.value
    && preset.softIntensity === softIntensity.value
    && preset.particlesEnabled === particlesEnabled.value
    && preset.particleIntensity === particleIntensity.value;
}

function handlePreferenceStorageChange(event: StorageEvent) {
  if (event.key === ACTIVE_VISUAL_PRESET_STORAGE_KEY) {
    lastAppliedVisualPresetId.value = event.newValue;
    return;
  }
  if (event.key !== CUSTOM_VISUAL_PRESETS_STORAGE_KEY && event.key !== null) return;

  customVisualPresets.value = loadCustomVisualPresets();
  lastAppliedVisualPresetId.value = readLocalPreference(ACTIVE_VISUAL_PRESET_STORAGE_KEY);
  if (editingPresetId.value && !customVisualPresets.value.some((preset) => preset.id === editingPresetId.value)) {
    cancelPresetRename();
  }
  if (lastAppliedVisualPresetId.value && !visualPresets.value.some((preset) => preset.id === lastAppliedVisualPresetId.value)) {
    lastAppliedVisualPresetId.value = null;
  }
}

function handleGlobalShortcut(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    isModelMenuOpen.value = false;
    if (isSettingsOpen.value) return;
    isCommandPaletteOpen.value = !isCommandPaletteOpen.value;
  }
  if (event.key === "Escape") {
    if (isModelMenuOpen.value) {
      event.preventDefault();
      closeModelMenu(true);
      return;
    }
    if (isSettingsOpen.value) {
      event.preventDefault();
      isSettingsOpen.value = false;
      return;
    }
    if (isCommandPaletteOpen.value) {
      event.preventDefault();
      isCommandPaletteOpen.value = false;
    }
  }
}

function applyPreferences() {
  const resolvedTheme = theme.value === "system" ? (mediaQuery.matches ? "dark" : "light") : theme.value;
  const normalizedSoftIntensity = Math.min(100, Math.max(0, Math.round(softIntensity.value)));
  const normalizedParticleIntensity = Math.min(100, Math.max(0, Math.round(particleIntensity.value)));
  document.documentElement.dataset.theme = resolvedTheme;
  document.documentElement.dataset.density = density.value;
  document.documentElement.dataset.accent = accent.value;
  document.documentElement.dataset.motion = motionLevel.value;
  document.documentElement.dataset.mood = visualMood.value;
  document.documentElement.dataset.particles = particlesEnabled.value ? "on" : "off";
  document.documentElement.style.setProperty("--soft-bg-mix", `${Math.round(normalizedSoftIntensity * .16)}%`);
  document.documentElement.style.setProperty("--soft-glow-opacity", (normalizedSoftIntensity * .0034).toFixed(2));
  document.documentElement.style.setProperty("--soft-blur", `${Math.round(6 + normalizedSoftIntensity * .12)}px`);
  document.documentElement.style.setProperty("--particle-intensity", (normalizedParticleIntensity / 100).toFixed(2));
  writeLocalPreference("chatai-theme", theme.value);
  writeLocalPreference("chatai-density", density.value);
  writeLocalPreference("chatai-accent", accent.value);
  writeLocalPreference("chatai-motion", motionLevel.value);
  writeLocalPreference("chatai-visual-mood", visualMood.value);
  writeLocalPreference("chatai-soft-intensity", String(normalizedSoftIntensity));
  writeLocalPreference("chatai-particles-enabled", String(particlesEnabled.value));
  writeLocalPreference("chatai-particle-intensity", String(normalizedParticleIntensity));
}
function setTheme(nextTheme: Theme) {
  if (theme.value === nextTheme) return;
  const root = document.documentElement;
  root.dataset.themeChanging = "true";
  theme.value = nextTheme;
  window.setTimeout(() => delete root.dataset.themeChanging, motionLevel.value === "reduced" ? 0 : 360);
}

function setPresetStatus(message: string) {
  presetStatus.value = message;
  if (presetStatusTimer) clearTimeout(presetStatusTimer);
  presetStatusTimer = window.setTimeout(() => {
    presetStatus.value = "";
  }, 2600);
}

function isBuiltInVisualPreset(preset: Readonly<VisualPreset>) {
  return builtInVisualPresetIds.has(preset.id);
}

function applyVisualPreset(preset: Readonly<VisualPreset>) {
  density.value = preset.density;
  accent.value = preset.accent;
  motionLevel.value = preset.motionLevel;
  visualMood.value = preset.visualMood;
  softIntensity.value = preset.softIntensity;
  particlesEnabled.value = preset.particlesEnabled;
  particleIntensity.value = preset.particleIntensity;
  lastAppliedVisualPresetId.value = preset.id;
  setTheme(preset.theme);
  setPresetStatus(`已应用“${preset.name}”`);
}

function currentVisualPresetDraft(name: string): VisualPresetDraft {
  return {
    name,
    theme: theme.value,
    density: density.value,
    accent: accent.value,
    motionLevel: motionLevel.value,
    visualMood: visualMood.value,
    softIntensity: softIntensity.value,
    particlesEnabled: particlesEnabled.value,
    particleIntensity: particleIntensity.value
  };
}

function saveVisualPreset() {
  const name = presetName.value.trim();
  if (!name) {
    setPresetStatus("请输入方案名称");
    presetNameInput.value?.focus();
    return;
  }

  const existingPreset = editingPresetId.value
    ? customVisualPresets.value.find((preset) => preset.id === editingPresetId.value)
    : undefined;
  const draft: VisualPresetDraft = existingPreset
    ? { ...existingPreset, name }
    : currentVisualPresetDraft(name);
  const result = saveCustomVisualPreset(draft);

  if (!result.ok) {
    customVisualPresets.value = result.presets;
    const errorMessage = result.reason === "limit-reached"
      ? `最多保存 ${MAX_CUSTOM_VISUAL_PRESETS} 个自定义方案`
      : result.reason === "storage-unavailable"
        ? "当前浏览器无法保存方案"
        : "方案名称无效";
    setPresetStatus(errorMessage);
    return;
  }

  customVisualPresets.value = result.presets;
  if (matchesCurrentVisualPreset(result.preset)) lastAppliedVisualPresetId.value = result.preset.id;
  presetName.value = "";
  editingPresetId.value = null;
  setPresetStatus(`已保存“${result.preset.name}”`);
}

function startPresetRename(preset: VisualPreset) {
  editingPresetId.value = preset.id;
  presetName.value = preset.name;
  void nextTick(() => {
    presetNameInput.value?.focus();
    presetNameInput.value?.select();
  });
}

function cancelPresetRename() {
  editingPresetId.value = null;
  presetName.value = "";
  void nextTick(() => presetNameInput.value?.focus());
}

function deleteVisualPreset(preset: VisualPreset) {
  const result = removeCustomVisualPreset(preset.id);
  if (!result.ok) {
    customVisualPresets.value = result.presets;
    setPresetStatus(result.reason === "storage-unavailable" ? "当前浏览器无法保存删除结果" : "方案已经不存在");
    return;
  }
  customVisualPresets.value = result.presets;
  if (lastAppliedVisualPresetId.value === preset.id) lastAppliedVisualPresetId.value = null;
  if (editingPresetId.value === preset.id) cancelPresetRename();
  else void nextTick(() => presetNameInput.value?.focus());
  setPresetStatus(`已删除“${preset.name}”`);
}
function isActiveModel(item: AiModelOption) {
  return chatStore.selectedAiProvider === item.provider && chatStore.selectedAiModel === item.model;
}

async function toggleModelMenu() {
  if (chatStore.isStreaming) return;
  isModelMenuOpen.value = !isModelMenuOpen.value;
  if (!isModelMenuOpen.value) return;
  await nextTick();
  const target = modelMenu.value?.querySelector<HTMLElement>(".model-option.is-active")
    ?? modelMenu.value?.querySelector<HTMLElement>(".model-option");
  target?.focus();
}

function chooseModel(item: AiModelOption) {
  isModelMenuOpen.value = false;
  modelPickerTrigger.value?.focus();
  void chatStore.selectAiModel(item.provider, item.model);
}

function closeModelMenu(restoreFocus = false) {
  isModelMenuOpen.value = false;
  if (restoreFocus) modelPickerTrigger.value?.focus();
}

function handleDocumentPointerDown(event: PointerEvent) {
  if (!isModelMenuOpen.value) return;
  const target = event.target;
  if (target instanceof Node && modelPicker.value?.contains(target)) return;
  isModelMenuOpen.value = false;
}

async function submitMessage(options: { regenerateFromMessageId?: string } = {}) {
  const content = draft.value.trim();
  if (!content || chatStore.isStreaming || isUploading.value) return;
  shouldAutoScroll.value = true;
  draft.value = "";
  removeLocalPreference("chatai-draft");
  resizeComposer();
  const pendingAttachments = attachments.value;
  attachments.value = [];
  const replaceFromMessageId = editingMessageId.value ?? undefined;
  editingMessageId.value = null;
  await chatStore.sendMessage(content, { attachments: pendingAttachments, replaceFromMessageId, ...options });
}
function handleEnter(event: KeyboardEvent) {
  if (event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  void submitMessage();
}
function resizeComposer() {
  void nextTick(() => {
    const el = composerInput.value;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  });
}
function chooseSuggestion(value: string) {
  draft.value = value;
  resizeComposer();
  void nextTick(() => composerInput.value?.focus());
}
function usePrompt(value: string) {
  draft.value = value;
  resizeComposer();
  void nextTick(() => composerInput.value?.focus());
}
async function attachFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    window.alert("单个文件最大支持 10 MB。" );
    input.value = "";
    return;
  }
  const allowed = [".txt", ".md", ".csv", ".json", ".log", ".pdf", ".docx", ".xlsx"];
  if (!allowed.some((extension) => file.name.toLowerCase().endsWith(extension))) {
    window.alert("支持 PDF、DOCX、XLSX、TXT、Markdown、CSV、JSON 和 LOG 文件。" );
    input.value = "";
    return;
  }
  isUploading.value = true;
  uploadProgress.value = 0;
  try {
    attachments.value.push(await uploadAttachment(file, (value) => uploadProgress.value = value));
  } catch (error) {
    window.alert(error instanceof Error ? error.message : "文件上传失败。" );
  } finally { isUploading.value = false; input.value = ""; }
}
async function removeAttachment(file: AttachmentSummary) {
  await deleteAttachment(file.id);
  attachments.value = attachments.value.filter((item) => item.id !== file.id);
}
function exportConversation() {
  if (!chatStore.messages.length) return;
  const title = chatStore.activeConversation?.title || "ChatAI 对话";
  const body = chatStore.messages.map((message) => {
    const role = message.role === "user" ? "你" : "ChatAI";
    return `## ${role}\n\n${message.content}\n`;
  }).join("\n");
  const blob = new Blob([`# ${title}\n\n${body}`], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${title.replace(/[\\/:*?\"<>|]/g, "-")}.md`;
  link.click();
  URL.revokeObjectURL(url);
}
function selectConversation(id: string) {
  shouldAutoScroll.value = true;
  void chatStore.selectConversation(id);
  isSidebarOpen.value = false;
}
function startNewConversation() {
  chatStore.startNewConversation();
  searchQuery.value = "";
  isSidebarOpen.value = false;
  shouldAutoScroll.value = true;
  void nextTick(() => composerInput.value?.focus());
}
function selectConversationFromCommand(id: string) {
  isCommandPaletteOpen.value = false;
  selectConversation(id);
}
function usePromptFromCommand(content: string) {
  isCommandPaletteOpen.value = false;
  usePrompt(content);
}
function startFromCommand() {
  isCommandPaletteOpen.value = false;
  startNewConversation();
}
async function loadWorkspace() {
  isWorkspaceLoading.value = true;
  workspaceError.value = "";
  try {
    [groups.value, cloudPrompts.value] = await Promise.all([fetchGroups(), fetchPrompts()]);
  } catch (error) {
    workspaceError.value = error instanceof Error ? error.message : "工作区同步失败。";
  } finally { isWorkspaceLoading.value = false; }
}
function openWorkspace(tab: "groups" | "prompts") {
  workspaceTab.value = tab;
  isWorkspaceOpen.value = true;
}
async function handleAccountChanged(user: AuthUser | null) {
  currentUser.value = user;
  chatStore.startNewConversation();
  await Promise.all([chatStore.loadConversations(), loadWorkspace()]);
}
function selectGroup(id: string | null) {
  activeGroupId.value = id;
  isWorkspaceOpen.value = false;
}
async function handleCreateGroup(name: string) {
  const group = await createGroup(name);
  groups.value.push(group);
}
async function handleRenameGroup(payload: { id: string; name: string }) {
  workspaceBusyId.value = payload.id;
  try {
    const group = await updateGroup(payload.id, { name: payload.name });
    groups.value = groups.value.map((item) => item.id === group.id ? group : item);
  } finally { workspaceBusyId.value = null; }
}
async function handleDeleteGroup(id: string) {
  workspaceBusyId.value = id;
  try {
    await deleteGroup(id);
    groups.value = groups.value.filter((item) => item.id !== id);
    if (activeGroupId.value === id) activeGroupId.value = null;
    await chatStore.loadConversations();
  } finally { workspaceBusyId.value = null; }
}
async function moveConversationToGroup(conversation: ConversationSummary, groupId: string | null) {
  await chatStore.editConversation(conversation.id, { groupId });
}
function handleConversationGroupChange(conversation: ConversationSummary, event: Event) {
  const value = (event.target as HTMLSelectElement).value;
  void moveConversationToGroup(conversation, value || null);
}
async function handleCreatePrompt(draftValue: PromptLibraryDraft) {
  const prompt = await createPrompt({ title: draftValue.title, content: draftValue.content, category: draftValue.category || "我的" });
  cloudPrompts.value.unshift(prompt);
}
async function handleUpdatePrompt(payload: PromptLibraryDraft & { id: string }) {
  workspaceBusyId.value = payload.id;
  try {
    const prompt = await updatePrompt(payload.id, { title: payload.title, content: payload.content, category: payload.category || "我的" });
    cloudPrompts.value = cloudPrompts.value.map((item) => item.id === prompt.id ? prompt : item);
  } finally { workspaceBusyId.value = null; }
}
async function handleDeletePrompt(id: string) {
  workspaceBusyId.value = id;
  try { await deletePrompt(id); cloudPrompts.value = cloudPrompts.value.filter((item) => item.id !== id); }
  finally { workspaceBusyId.value = null; }
}
function handleUseCloudPrompt(prompt: CloudPromptLibraryItem) {
  usePrompt(prompt.content);
  isWorkspaceOpen.value = false;
}
function updateScrollState() {
  const el = messageList.value;
  if (!el) return;
  const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
  shouldAutoScroll.value = distance < 80;
  showScrollButton.value = distance > 180;
}
function scrollToBottom(smooth = true) {
  const el = messageList.value;
  if (!el) return;
  el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
  shouldAutoScroll.value = true;
  showScrollButton.value = false;
}
async function copyMessage(id: string, content: string) {
  if (!content) return;
  try {
    await navigator.clipboard.writeText(content);
    copiedMessageId.value = id;
    if (copyTimer) clearTimeout(copyTimer);
    copyTimer = setTimeout(() => copiedMessageId.value = null, 1800);
  } catch { chatStore.clearError(); }
}
function formatMessageTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(date);
}
function requestDelete(conversation: ConversationSummary) {
  pendingDelete.value = conversation;
  deleteError.value = "";
  void nextTick(() => deleteDialog.value?.showModal());
}
async function renameConversation(conversation: ConversationSummary) {
  const title = window.prompt("输入新的会话名称", conversation.title)?.trim();
  if (title && title !== conversation.title) await chatStore.editConversation(conversation.id, { title });
}
async function toggleFavorite(conversation: ConversationSummary) {
  await chatStore.editConversation(conversation.id, { isFavorite: !conversation.isFavorite });
}
async function toggleArchive(conversation: ConversationSummary) {
  await chatStore.editConversation(conversation.id, { isArchived: !conversation.isArchived });
  if (!conversation.isArchived && conversation.id === chatStore.activeConversationId) startNewConversation();
}
function editMessage(message: { id: string; content: string }) {
  if (chatStore.isStreaming) return;
  editingMessageId.value = message.id;
  draft.value = message.content;
  resizeComposer();
  void nextTick(() => composerInput.value?.focus());
}
function resendMessage(message: { id: string; content: string }) {
  if (chatStore.isStreaming) return;
  editingMessageId.value = null;
  draft.value = message.content;
  void submitMessage({ regenerateFromMessageId: message.id });
}
function messageVariants(message: ChatMessage) {
  return chatStore.variantsFor(message);
}
function isActiveStreamingMessage(message: ChatMessage) {
  return chatStore.isReceiving
    && message.role === "assistant"
    && message.id === chatStore.messages.at(-1)?.id;
}
function variantPosition(message: ChatMessage) {
  return messageVariants(message).findIndex((item) => item.id === message.id);
}
function switchVariant(message: ChatMessage, offset: number) {
  const variants = messageVariants(message);
  const target = variants[variantPosition(message) + offset];
  if (target) chatStore.selectVariant(target);
}
function cancelDelete() {
  if (isDeleting.value) return;
  deleteDialog.value?.close();
  pendingDelete.value = null;
  deleteError.value = "";
}
async function confirmDelete() {
  const conversation = pendingDelete.value;
  if (!conversation || isDeleting.value) return;
  isDeleting.value = true;
  deleteError.value = "";
  try {
    if (!await chatStore.removeConversation(conversation.id)) {
      deleteError.value = chatStore.errorMessage || "删除失败，请稍后重试。";
      return;
    }
    deleteDialog.value?.close();
    pendingDelete.value = null;
  } finally { isDeleting.value = false; }
}
</script>

<template>
  <main class="app-shell">
    <Transition name="sidebar-fade"><button v-if="isSidebarOpen" class="sidebar-backdrop" type="button" aria-label="关闭会话列表" @click="isSidebarOpen = false" /></Transition>
    <aside class="sidebar" :class="{ open: isSidebarOpen }">
      <div class="sidebar-hud" aria-hidden="true">
        <span class="sidebar-hud-grid" />
        <span class="sidebar-hud-rail rail-a" />
        <span class="sidebar-hud-rail rail-b" />
        <span class="sidebar-hud-scan" />
        <span class="sidebar-hud-node node-a" />
        <span class="sidebar-hud-node node-b" />
        <span class="sidebar-hud-node node-c" />
      </div>
      <div class="sidebar-header">
        <div class="brand-mark"><span class="brand-orbit" aria-hidden="true" /><Sparkles :size="20" /></div>
        <div class="brand-copy"><h1>ChatAI</h1><p><span class="brand-live-dot" /> NEURAL WORKSPACE</p></div>
        <button class="mobile-close icon-button" type="button" aria-label="关闭侧栏" @click="isSidebarOpen = false"><X :size="20" /></button>
      </div>
      <button class="new-chat-button" type="button" @click="startNewConversation"><span class="new-chat-scan" aria-hidden="true" /><MessageSquarePlus :size="18" /><span>开启新对话</span><kbd>⌘ K</kbd></button>
      <div class="conversation-section">
        <div class="section-heading"><p class="section-label">{{ activeGroupId ? groups.find(item => item.id === activeGroupId)?.name : '对话历史' }}</p><button class="section-tool" type="button" title="管理分组" @click="openWorkspace('groups')"><FolderTree :size="14" /></button><span>{{ filteredConversations.length }}</span></div>
        <div class="conversation-filters"><button type="button" :class="{ active: conversationFilter === 'active' }" @click="conversationFilter = 'active'">最近</button><button type="button" :class="{ active: conversationFilter === 'favorites' }" @click="conversationFilter = 'favorites'">收藏</button><button type="button" :class="{ active: conversationFilter === 'archived' }" @click="conversationFilter = 'archived'">归档</button></div>
        <label v-if="chatStore.conversations.length" class="conversation-search">
          <Search :size="15" /><input v-model="searchQuery" type="search" placeholder="搜索对话…" aria-label="搜索对话" />
          <button v-if="searchQuery" type="button" aria-label="清除搜索" @click="searchQuery = ''"><X :size="14" /></button>
        </label>
        <div class="conversation-list">
          <div v-if="chatStore.isLoadingConversations" class="sidebar-loading"><LoaderCircle class="spin" :size="18" /> 正在加载</div>
          <div v-else-if="!chatStore.conversations.length" class="no-conversations"><MessageSquarePlus :size="20" /><span>还没有历史对话</span><small>发送第一条消息开始探索</small></div>
          <p v-else-if="!filteredConversations.length" class="no-results">没有找到匹配的对话</p>
          <TransitionGroup name="conversation-list">
          <div v-for="conversation in filteredConversations" :key="conversation.id" class="conversation-item" :class="{ active: conversation.id === chatStore.activeConversationId }">
            <button class="conversation-select" type="button" @dblclick="renameConversation(conversation)" @click="selectConversation(conversation.id)"><span><Star v-if="conversation.isFavorite" :size="11" fill="currentColor" />{{ conversation.title }}</span><small>{{ new Date(conversation.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) }}</small></button>
            <div class="conversation-actions"><label class="group-move" title="移动到分组"><FolderTree :size="14" /><select :value="conversation.groupId || ''" @click.stop @change="handleConversationGroupChange(conversation, $event)"><option value="">未分组</option><option v-for="group in groups" :key="group.id" :value="group.id">{{ group.name }}</option></select></label><button class="icon-button" :title="conversation.isFavorite ? '取消收藏' : '收藏'" type="button" @click.stop="toggleFavorite(conversation)"><Star :size="14" :fill="conversation.isFavorite ? 'currentColor' : 'none'" /></button><button class="icon-button" :title="conversation.isArchived ? '移出归档' : '归档'" type="button" @click.stop="toggleArchive(conversation)"><Archive :size="14" /></button><button class="icon-button delete-button" title="删除对话" type="button" @click.stop="requestDelete(conversation)"><Trash2 :size="14" /></button></div>
          </div>
          </TransitionGroup>
        </div>
      </div>
      <div class="sidebar-bottom">
        <p class="service-state" :class="{ offline: chatStore.isServiceAvailable === false }"><span class="service-radar" aria-hidden="true"><i /><b /></span><span class="service-copy"><small>SYSTEM LINK</small>{{ chatStore.isServiceAvailable === null ? "正在连接" : chatStore.isServiceAvailable ? "服务运行正常" : "服务暂未连接" }}</span></p>
        <button class="profile-card" type="button" @click="isAccountOpen = true"><span class="profile-scan" aria-hidden="true" /><span class="profile-avatar"><UserRound :size="16" /></span><span class="profile-copy"><strong>{{ currentUser?.name || '本地访客' }}</strong><small>{{ currentUser ? '云同步已开启' : '登录以跨设备同步' }}</small></span><Settings2 :size="17" /></button>
      </div>
    </aside>

    <section class="chat-panel">
      <SciFiParticleField
        :enabled="particlesEnabled"
        :intensity="particleIntensity"
        :motion-level="motionLevel"
        :theme="theme"
        :accent="accent"
        :mood="visualMood"
      />
      <div class="chat-hud" aria-hidden="true">
        <span class="chat-hud-rail rail-top" />
        <span class="chat-hud-rail rail-right" />
        <span class="chat-hud-scan" />
        <span class="chat-hud-node node-one" />
        <span class="chat-hud-node node-two" />
        <span class="chat-hud-node node-three" />
      </div>
      <header class="chat-header" :class="{ 'model-menu-open': isModelMenuOpen }">
        <button class="menu-button icon-button" type="button" aria-label="打开会话列表" @click="isSidebarOpen = true"><Menu :size="21" /></button>
        <div class="header-copy"><p class="eyebrow">AI 智能助手</p><h2>{{ chatStore.activeConversation?.title ?? "新对话" }}</h2></div>
        <div v-if="chatStore.aiModels.length" ref="modelPicker" class="model-picker-wrap">
          <button ref="modelPickerTrigger" class="model-picker" :class="{ open: isModelMenuOpen }" type="button" :disabled="chatStore.isStreaming" :aria-expanded="isModelMenuOpen" aria-haspopup="listbox" :aria-label="`当前模型：${selectedProviderLabel} ${selectedModelLabel}`" title="切换当前对话使用的模型" @click.stop="toggleModelMenu">
            <span class="model-provider-mark" :data-provider="chatStore.selectedAiProvider" aria-hidden="true">{{ selectedProviderMark }}</span>
            <span class="model-picker-copy" aria-hidden="true">
              <small>{{ selectedProviderLabel }}</small>
              <strong>{{ selectedModelLabel }}</strong>
            </span>
            <ChevronDown class="model-picker-chevron" :size="14" aria-hidden="true" />
          </button>
          <Transition name="model-menu">
            <div v-if="isModelMenuOpen" ref="modelMenu" class="model-menu" role="listbox" aria-label="选择模型">
              <div class="model-menu-head"><span>选择模型</span><small>{{ chatStore.aiModels.length }} 个可用</small></div>
              <div v-for="group in aiModelGroups" :key="group.provider" class="model-menu-group" role="group" :aria-label="group.providerLabel">
                <div class="model-menu-group-head"><span class="model-menu-provider-mark" :data-provider="group.provider" aria-hidden="true">{{ providerMarks[group.provider] ?? "AI" }}</span><span>{{ group.providerLabel }}</span><small>{{ group.models.length }}</small></div>
                <button v-for="item in group.models" :key="`${item.provider}::${item.model}`" class="model-option" :class="{ 'is-active': isActiveModel(item) }" type="button" role="option" :aria-selected="isActiveModel(item)" @click="chooseModel(item)">
                  <span class="model-option-copy"><strong>{{ item.label }}</strong><small v-if="item.label !== item.model">{{ item.model }}</small></span>
                  <span class="model-option-tags"><em v-if="item.isDefault">默认</em><Check v-if="isActiveModel(item)" :size="15" /></span>
                </button>
              </div>
            </div>
          </Transition>
        </div>
        <span class="status-pill" :class="{ streaming: chatStore.isStreaming, offline: chatStore.isServiceAvailable === false }"><LoaderCircle v-if="chatStore.isStreaming" class="spin" :size="14" /><span v-else class="status-dot" />{{ chatStore.isStreaming ? "正在思考" : chatStore.isServiceAvailable === false ? "离线" : "在线" }}</span>
        <button class="header-settings icon-button" type="button" title="工作区资料库" @click="openWorkspace('prompts')"><Library :size="19" /></button>
        <button v-if="chatStore.messages.length" class="header-settings icon-button" type="button" title="导出 Markdown" @click="exportConversation"><Download :size="19" /></button>
        <button ref="settingsTrigger" class="header-settings personalize-button icon-button" type="button" title="个性化设置" aria-label="打开个性化设置" @click="isSettingsOpen = true"><Settings2 :size="19" /></button>
      </header>

      <div ref="messageList" class="message-list" aria-live="polite" @scroll="updateScrollState">
        <div v-if="chatStore.isLoadingMessages" class="loading-state"><LoaderCircle class="spin" :size="24" /><span>正在加载对话</span></div>
        <div v-else-if="!chatStore.messages.length" class="empty-state">
          <div class="welcome-badge"><Sparkles :size="14" /> 为你准备好了</div>
          <h3>今天想一起完成什么？</h3>
          <p>从一个想法开始。帮你分析问题、创作内容、梳理方案，让复杂的事情变得简单。</p>
          <div class="suggestion-list"><button v-for="item in suggestions" :key="item.title" type="button" @click="chooseSuggestion(item.prompt)"><span>{{ item.icon }}</span><strong>{{ item.title }}</strong><small>{{ item.prompt }}</small></button></div>
        </div>
        <TransitionGroup name="message-list">
        <article v-for="message in visibleMessages" :key="chatStore.messageRenderKey(message)" class="message-row" :class="message.role">
          <div v-if="message.role !== 'user'" class="message-avatar"><Bot :size="17" /></div>
          <div class="message-content">
            <div class="message-label">{{ message.role === 'user' ? '你' : 'ChatAI' }}</div>
            <div class="message-bubble" :class="{ 'is-streaming': isActiveStreamingMessage(message) }">
              <div v-if="message.attachments.length" class="message-attachments"><span v-for="file in message.attachments" :key="file.id"><Paperclip :size="12" />{{ file.name }}</span></div>
              <MarkdownContent v-if="message.content && message.role !== 'user'" :content="message.content" />
              <p v-else-if="message.content">{{ message.content }}</p>
              <Transition name="streaming-indicator">
                <div v-if="isActiveStreamingMessage(message)" class="typing-indicator streaming-continuation" role="status" aria-label="正在生成"><span /><span /><span /></div>
              </Transition>
            </div>
            <div class="message-meta"><time :datetime="message.createdAt">{{ formatMessageTime(message.createdAt) }}</time><span v-if="messageVariants(message).length > 1" class="branch-switch"><button type="button" :disabled="variantPosition(message) <= 0" title="上一个分支" @click="switchVariant(message, -1)"><ChevronLeft :size="13" /></button>{{ variantPosition(message) + 1 }}/{{ messageVariants(message).length }}<button type="button" :disabled="variantPosition(message) >= messageVariants(message).length - 1" title="下一个分支" @click="switchVariant(message, 1)"><ChevronRight :size="13" /></button></span><button type="button" :title="copiedMessageId === message.id ? '已复制' : '复制消息'" @click="copyMessage(message.id, message.content)"><Check v-if="copiedMessageId === message.id" :size="14" /><Copy v-else :size="14" /></button><button v-if="message.role === 'user'" type="button" title="编辑并创建分支" @click="editMessage(message)">编辑</button><button v-if="message.role === 'user'" type="button" title="重新生成回答" @click="resendMessage(message)"><RefreshCw :size="13" /></button></div>
          </div>
        </article>
        </TransitionGroup>
      </div>
      <Transition name="notice"><button v-if="showScrollButton" class="scroll-bottom-button" type="button" title="回到底部" @click="scrollToBottom()"><ArrowDown :size="18" /></button></Transition>
      <div class="composer-area">
        <Transition name="notice"><div v-if="chatStore.errorMessage" class="error-notice" role="alert"><CircleAlert :size="17" /><span>{{ chatStore.errorMessage }}</span><div class="error-actions"><button type="button" @click="chatStore.loadConversations"><RefreshCw :size="15" /><span>重试</span></button><button type="button" aria-label="关闭提示" @click="chatStore.clearError"><X :size="16" /></button></div></div></Transition>
        <Transition name="composer-detail"><div v-if="editingMessageId" class="editing-notice"><span>正在编辑历史消息，发送后将创建新分支</span><button type="button" @click="editingMessageId = null"><X :size="13" />取消</button></div></Transition>
        <div v-if="attachments.length || isUploading" class="attachment-tray"><TransitionGroup name="attachment-chip"><span v-for="file in attachments" :key="file.id"><Paperclip :size="13" /><b>{{ file.name }}</b><small>{{ Math.ceil(file.size / 1024) }} KB</small><button type="button" title="移除附件" @click="removeAttachment(file)"><X :size="13" /></button></span><span v-if="isUploading" key="uploading" class="uploading-file"><LoaderCircle class="spin" :size="13" />正在上传并解析 {{ uploadProgress }}%</span></TransitionGroup></div>
        <div class="composer-tools"><span class="tool-buttons"><button type="button" @click="openWorkspace('prompts')"><Library :size="14" /> 提示词库</button><button type="button" :disabled="isUploading" @click="fileInput?.click()"><Paperclip :size="14" /> 添加文件</button><input ref="fileInput" class="visually-hidden" type="file" accept=".txt,.md,.csv,.json,.log,.pdf,.docx,.xlsx" @change="attachFile" /></span><span v-if="draft">草稿已自动保存</span></div>
        <form class="composer" @submit.prevent="submitMessage()">
          <textarea ref="composerInput" v-model="draft" :disabled="chatStore.isStreaming" maxlength="6000" aria-label="消息内容" placeholder="输入消息，Enter 发送，Shift + Enter 换行" rows="1" @input="resizeComposer" @keydown.enter="handleEnter" />
          <span v-if="draftCount > 5000" class="draft-count">{{ draftCount }}/6000</span>
          <Transition name="composer-action" mode="out-in"><button v-if="chatStore.isStreaming" key="stop" class="stop-button" title="停止生成" type="button" @click="chatStore.stopStreaming"><Square :size="15" /></button><button v-else key="send" class="send-button" :disabled="!draft.trim() || isUploading" title="发送消息" type="submit"><Send :size="18" /></button></Transition>
        </form>
        <p class="composer-hint"><span>Enter 发送</span><span>AI 可能会出错，请核实重要信息</span></p>
      </div>
    </section>

    <Transition name="drawer"><div v-if="isWorkspaceOpen" class="settings-backdrop workspace-backdrop" @click.self="isWorkspaceOpen = false"><WorkspaceLibrary :groups="workspaceGroups" :prompts="workspacePrompts" :active-group-id="activeGroupId" :total-conversation-count="chatStore.conversations.length" :initial-tab="workspaceTab" :loading="isWorkspaceLoading" :syncing="isWorkspaceSyncing" :busy-id="workspaceBusyId" :sync-error="workspaceError" @close="isWorkspaceOpen = false" @select-group="selectGroup" @create-group="handleCreateGroup" @rename-group="handleRenameGroup" @delete-group="handleDeleteGroup" @create-prompt="handleCreatePrompt" @update-prompt="handleUpdatePrompt" @delete-prompt="handleDeletePrompt" @use-prompt="handleUseCloudPrompt" @sync="loadWorkspace" /></div></Transition>

    <Transition name="drawer">
      <div v-if="isSettingsOpen" class="settings-backdrop" @click.self="isSettingsOpen = false">
        <aside ref="settingsDialog" class="settings-drawer" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <div class="settings-header"><div><p>个人偏好</p><h3 id="settings-title">让 ChatAI 更像你的空间</h3></div><button class="icon-button" type="button" aria-label="关闭设置" @click="isSettingsOpen = false"><X :size="20" /></button></div>
          <div class="setting-group preset-setting">
            <div class="setting-label"><Sparkles :size="17" /> 视觉方案 <small>{{ customVisualPresets.length }}/{{ MAX_CUSTOM_VISUAL_PRESETS }}</small></div>
            <div class="preset-list" role="list" aria-label="视觉方案">
              <div v-for="preset in visualPresets" :key="preset.id" class="preset-row" role="listitem">
                <button class="preset-apply" :class="{ active: activeVisualPresetId === preset.id }" type="button" :aria-pressed="activeVisualPresetId === preset.id" @click="applyVisualPreset(preset)"><Check v-if="activeVisualPresetId === preset.id" :size="14" /><Sparkles v-else :size="14" /><span>{{ preset.name }}</span><small v-if="isBuiltInVisualPreset(preset)">内置</small></button>
                <button v-if="!isBuiltInVisualPreset(preset)" class="preset-icon-button" type="button" title="重命名方案" :aria-label="`重命名方案：${preset.name}`" @click="startPresetRename(preset)"><Pencil :size="14" /></button>
                <button v-if="!isBuiltInVisualPreset(preset)" class="preset-icon-button danger" type="button" title="删除方案" :aria-label="`删除方案：${preset.name}`" @click="deleteVisualPreset(preset)"><Trash2 :size="14" /></button>
              </div>
            </div>
            <form class="preset-save-form" @submit.prevent="saveVisualPreset">
              <label class="visually-hidden" for="visual-preset-name">方案名称</label>
              <input id="visual-preset-name" ref="presetNameInput" v-model="presetName" :maxlength="MAX_VISUAL_PRESET_NAME_LENGTH" type="text" :placeholder="editingPresetId ? '重命名方案' : '保存当前设置'" />
              <button class="preset-icon-button primary" type="submit" :disabled="!presetName.trim() || (!editingPresetId && customVisualPresets.length >= MAX_CUSTOM_VISUAL_PRESETS)" :title="editingPresetId ? '确认重命名' : '保存当前方案'" :aria-label="editingPresetId ? '确认重命名' : '保存当前方案'"><Save :size="15" /></button>
              <button v-if="editingPresetId" class="preset-icon-button" type="button" title="取消重命名" aria-label="取消重命名" @click="cancelPresetRename"><X :size="15" /></button>
            </form>
            <p class="preset-status" role="status" aria-live="polite">{{ presetStatus }}</p>
          </div>
          <div class="setting-group"><label><Palette :size="17" /> 主题色</label><div class="accent-options"><button v-for="item in accentOptions" :key="item" :class="[item, { active: accent === item }]" type="button" :aria-label="`主题色：${accentLabels[item]}`" :title="accentLabels[item]" :aria-pressed="accent === item" @click="accent = item"><Check v-if="accent === item" :size="15" /></button></div></div>
          <div class="setting-group"><label><Sun :size="17" /> 外观模式</label><div class="segmented" role="group" aria-label="外观模式"><button type="button" :class="{ active: theme === 'light' }" :aria-pressed="theme === 'light'" @click="setTheme('light')"><Sun :size="15" />浅色</button><button type="button" :class="{ active: theme === 'dark' }" :aria-pressed="theme === 'dark'" @click="setTheme('dark')"><Moon :size="15" />深色</button><button type="button" :class="{ active: theme === 'system' }" :aria-pressed="theme === 'system'" @click="setTheme('system')">自动</button></div></div>
          <div class="setting-group"><label>界面密度</label><div class="segmented" role="group" aria-label="界面密度"><button type="button" :class="{ active: density === 'comfortable' }" :aria-pressed="density === 'comfortable'" @click="density = 'comfortable'">舒适</button><button type="button" :class="{ active: density === 'compact' }" :aria-pressed="density === 'compact'" @click="density = 'compact'">紧凑</button></div></div>
          <div class="setting-group"><label><Sparkles :size="17" /> 动效强度</label><div class="segmented motion-options" role="group" aria-label="动效强度"><button type="button" :class="{ active: motionLevel === 'full' }" :aria-pressed="motionLevel === 'full'" @click="motionLevel = 'full'">沉浸</button><button type="button" :class="{ active: motionLevel === 'subtle' }" :aria-pressed="motionLevel === 'subtle'" @click="motionLevel = 'subtle'">克制</button><button type="button" :class="{ active: motionLevel === 'reduced' }" :aria-pressed="motionLevel === 'reduced'" @click="motionLevel = 'reduced'">减少</button></div><p>“减少”会关闭背景扫描、脉冲和非必要过渡。</p></div>
          <div class="setting-group visual-mood-setting">
            <div id="visual-mood-label" class="setting-label"><Sparkles :size="17" /> 柔感个性 <small>可选</small></div>
            <div class="segmented mood-options" role="group" aria-labelledby="visual-mood-label">
              <button type="button" :class="{ active: visualMood === 'cyber' }" :aria-pressed="visualMood === 'cyber'" @click="visualMood = 'cyber'">科技</button>
              <button type="button" :class="{ active: visualMood === 'fusion' }" :aria-pressed="visualMood === 'fusion'" @click="visualMood = 'fusion'">融合</button>
              <button type="button" :class="{ active: visualMood === 'soft' }" :aria-pressed="visualMood === 'soft'" @click="visualMood = 'soft'">柔光</button>
            </div>
            <div v-if="visualMood !== 'cyber'" class="soft-intensity">
              <div class="soft-intensity-header"><label for="soft-intensity">柔光强度</label><output for="soft-intensity">{{ softIntensity }}%</output></div>
              <input id="soft-intensity" v-model.number="softIntensity" type="range" min="0" max="100" step="1" :aria-valuetext="`柔光强度 ${softIntensity}%`" />
              <div class="intensity-scale" aria-hidden="true"><span>轻盈</span><span>馥郁</span></div>
            </div>
          </div>
          <div class="setting-group particle-setting">
            <div class="setting-label"><Sparkles :size="17" /> 星图背景<label class="setting-switch" title="启用星图背景"><input v-model="particlesEnabled" type="checkbox" aria-label="启用星图背景" /><span aria-hidden="true" /></label></div>
            <div v-if="particlesEnabled" class="soft-intensity particle-intensity">
              <div class="soft-intensity-header"><label for="particle-intensity">星图强度</label><output for="particle-intensity">{{ particleIntensity }}%</output></div>
              <input id="particle-intensity" v-model.number="particleIntensity" type="range" min="0" max="100" step="1" :aria-valuetext="`星图强度 ${particleIntensity}%`" />
              <div class="intensity-scale" aria-hidden="true"><span>稀疏</span><span>繁星</span></div>
            </div>
          </div>
          <p class="settings-footnote">视觉方案与界面偏好会自动保存在当前浏览器中。</p>
        </aside>
      </div>
    </Transition>

    <CommandPalette :open="isCommandPaletteOpen" :conversations="chatStore.conversations" :prompts="cloudPrompts" :current-theme="theme" @close="isCommandPaletteOpen = false" @new-chat="startFromCommand" @select-conversation="selectConversationFromCommand" @use-prompt="usePromptFromCommand" @open-workspace="isCommandPaletteOpen = false; openWorkspace('prompts')" @open-settings="isCommandPaletteOpen = false; isSettingsOpen = true" @toggle-theme="setTheme(theme === 'dark' ? 'light' : 'dark')" />
    <AccountDialog :open="isAccountOpen" :user="currentUser" @close="isAccountOpen = false" @changed="handleAccountChanged" />

    <dialog ref="deleteDialog" class="delete-dialog" @close="pendingDelete = null" @click.self="cancelDelete"><div class="dialog-icon"><Trash2 :size="21" /></div><div class="dialog-copy"><h3>删除这个对话？</h3><p>“{{ pendingDelete?.title }}”及其中的全部消息将被永久删除，此操作无法撤销。</p><p v-if="deleteError" class="dialog-error" role="alert">{{ deleteError }}</p></div><div class="dialog-actions"><button class="cancel-button" type="button" :disabled="isDeleting" @click="cancelDelete">取消</button><button class="confirm-delete-button" type="button" :disabled="isDeleting" @click="confirmDelete"><LoaderCircle v-if="isDeleting" class="spin" :size="16" /><Trash2 v-else :size="16" />{{ isDeleting ? "删除中" : "确认删除" }}</button></div></dialog>
  </main>
</template>
