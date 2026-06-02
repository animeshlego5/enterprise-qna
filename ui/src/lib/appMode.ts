// Settings that live in localStorage for the local (free) mode.
// The backend (cloud) mode is unlocked automatically when the user
// signs in via Clerk.

export type LlmProvider = "openai" | "gemini" | "anthropic";

export interface LocalSettings {
  provider: LlmProvider;
  apiKey: string;
  model: string;
  // When true, a signed-in user still uses the local pipeline instead of
  // the backend — useful for testing or avoiding cloud credits.
  forceLocal: boolean;
}

export const DEFAULT_MODELS: Record<LlmProvider, string> = {
  openai: "gpt-4o-mini",
  gemini: "gemini-2.0-flash",
  anthropic: "claude-haiku-4-5-20251001",
};

export const MODEL_OPTIONS: Record<LlmProvider, { value: string; label: string }[]> = {
  openai: [
    { value: "gpt-4o-mini",      label: "GPT-4o Mini — fast & affordable" },
    { value: "gpt-4o",           label: "GPT-4o — most capable" },
    { value: "gpt-3.5-turbo",    label: "GPT-3.5 Turbo — cheapest" },
  ],
  gemini: [
    { value: "gemini-2.0-flash", label: "Gemini 2.0 Flash — fast & free tier" },
    { value: "gemini-2.5-flash-preview-05-20", label: "Gemini 2.5 Flash Preview" },
    { value: "gemini-1.5-flash", label: "Gemini 1.5 Flash" },
    { value: "gemini-1.5-pro",   label: "Gemini 1.5 Pro" },
  ],
  anthropic: [
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 — fast & cheap" },
    { value: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6 — balanced" },
    { value: "claude-opus-4-8",           label: "Claude Opus 4.8 — most capable" },
  ],
};

const DEFAULT_SETTINGS: LocalSettings = {
  provider: "openai",
  apiKey: "",
  model: DEFAULT_MODELS.openai,
  forceLocal: false,
};

const STORAGE_KEY = "eqna-local-settings";

export function loadLocalSettings(): LocalSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {}
  return DEFAULT_SETTINGS;
}

export function saveLocalSettings(s: LocalSettings): void {
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
  }
}
