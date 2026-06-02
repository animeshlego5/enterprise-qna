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
  gemini: "gemini-2.5-flash",
  anthropic: "claude-haiku-4-5-20251001",
};

export const MODEL_OPTIONS: Record<LlmProvider, { value: string; label: string }[]> = {
  // Model IDs sourced from https://developers.openai.com/api/docs/models (June 2026)
  openai: [
    { value: "gpt-4o-mini",   label: "GPT-4o Mini — reliable & affordable" },
    { value: "gpt-5.4-nano",  label: "GPT-5.4 Nano — fastest & cheapest" },
    { value: "gpt-5.4-mini",  label: "GPT-5.4 Mini — fast & capable" },
    { value: "gpt-5.4",       label: "GPT-5.4 — highly capable" },
    { value: "gpt-5.5",       label: "GPT-5.5 — most capable" },
  ],
  // Model IDs sourced from https://ai.google.dev/gemini-api/docs/models (June 2026)
  gemini: [
    { value: "gemini-2.5-flash",      label: "Gemini 2.5 Flash — best price/performance" },
    { value: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite — fastest & cheapest" },
    { value: "gemini-2.5-pro",        label: "Gemini 2.5 Pro — most capable" },
    { value: "gemini-3.5-flash",      label: "Gemini 3.5 Flash — frontier performance" },
    { value: "gemini-2.0-flash",      label: "Gemini 2.0 Flash — stable fallback" },
  ],
  // Model IDs sourced from https://docs.anthropic.com/en/docs/about-claude/models (June 2026)
  anthropic: [
    { value: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 — fastest & cheapest" },
    { value: "claude-sonnet-4-6",         label: "Claude Sonnet 4.6 — balanced" },
    { value: "claude-opus-4-7",           label: "Claude Opus 4.7 — most capable" },
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
