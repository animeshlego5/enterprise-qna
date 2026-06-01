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
