"use client";

import { useState, useEffect } from "react";
import { useAuth } from "@clerk/nextjs";
import {
  loadLocalSettings,
  saveLocalSettings,
  LocalSettings,
  LlmProvider,
  DEFAULT_MODELS,
  MODEL_OPTIONS,
} from "@/lib/appMode";

const PROVIDERS: { id: LlmProvider; label: string; placeholder: string }[] = [
  { id: "openai",     label: "OpenAI",     placeholder: "sk-..." },
  { id: "gemini",     label: "Gemini",     placeholder: "AIzaSy..." },
  { id: "anthropic",  label: "Anthropic",  placeholder: "sk-ant-..." },
];

interface Props {
  settings: LocalSettings;
  onChange: (s: LocalSettings) => void;
}

export function ModeSelector({ settings, onChange }: Props) {
  const { isSignedIn } = useAuth();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<LocalSettings>(settings);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => { setDraft(settings); }, [settings]);

  const save = () => {
    saveLocalSettings(draft);
    onChange(draft);
    setOpen(false);
  };

  const isBackend = isSignedIn && !settings.forceLocal;

  const modelLabel =
    MODEL_OPTIONS[settings.provider].find(o => o.value === settings.model)?.label.split(" —")[0]
    ?? settings.model;

  const modeLabel = isBackend
    ? "Cloud mode"
    : `Local · ${PROVIDERS.find(p => p.id === settings.provider)?.label} · ${modelLabel}`;

  return (
    <div className="w-full max-w-3xl mb-4">
      <button
        onClick={() => setOpen(v => !v)}
        className="flex w-full items-center justify-between rounded-xl border border-claude-border bg-claude-surface px-5 py-3 text-sm transition-colors hover:bg-claude-surface2"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className="shrink-0 text-claude-accent">
            <path d="M4 6h12M13 3l3 3-3 3M16 14H4M7 11l-3 3 3 3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="font-medium text-claude-text truncate">{modeLabel}</span>
        </div>
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"
          className={`transition-transform duration-200 text-claude-subtle ${open ? "rotate-180" : ""}`}>
          <path d="M4 6l4 4 4-4" />
        </svg>
      </button>

      <div className={`grid transition-[grid-template-rows] duration-300 ease-in-out ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className={`overflow-hidden transition-opacity duration-200 ${open ? "opacity-100" : "opacity-0"}`}>
        <div className="mt-1.5 rounded-xl border border-claude-border bg-claude-surface p-5 space-y-5">

          {/* Cloud / Local toggle */}
          {isSignedIn && (
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-claude-text">Use cloud backend</p>
                <p className="text-xs text-claude-subtle mt-0.5">You&apos;re signed in — the server handles processing</p>
              </div>
              <button
                onClick={() => setDraft(d => ({ ...d, forceLocal: !d.forceLocal }))}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  !draft.forceLocal ? "bg-claude-accent" : "bg-claude-border"
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  !draft.forceLocal ? "translate-x-6" : "translate-x-1"
                }`} />
              </button>
            </div>
          )}

          {/* Local mode settings */}
          {(draft.forceLocal || !isSignedIn) && (
            <div className="space-y-4">
              <p className="text-xs font-semibold uppercase tracking-widest text-claude-subtle">Local mode settings</p>

              {/* Provider */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-claude-text">LLM Provider</label>
                <div className="flex gap-2">
                  {PROVIDERS.map(p => (
                    <button
                      key={p.id}
                      onClick={() => setDraft(d => ({ ...d, provider: p.id, model: DEFAULT_MODELS[p.id] }))}
                      className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                        draft.provider === p.id
                          ? "border-claude-accent bg-claude-accent/10 text-claude-accent font-semibold"
                          : "border-claude-border bg-claude-surface2 text-claude-muted hover:border-claude-border-hi"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* API Key */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-claude-text">API Key</label>
                <div className="relative">
                  <input
                    type={showKey ? "text" : "password"}
                    value={draft.apiKey}
                    onChange={e => setDraft(d => ({ ...d, apiKey: e.target.value }))}
                    placeholder={PROVIDERS.find(p => p.id === draft.provider)?.placeholder}
                    className="w-full rounded-lg border border-claude-border bg-claude-surface2 px-4 py-2.5 pr-10 text-sm text-claude-text placeholder-claude-subtle focus:border-claude-border-hi focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-claude-subtle hover:text-claude-muted"
                  >
                    {showKey ? (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                        <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                        <line x1="1" y1="1" x2="23" y2="23" />
                      </svg>
                    ) : (
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                        <circle cx="12" cy="12" r="3" />
                      </svg>
                    )}
                  </button>
                </div>
                <p className="mt-1 text-xs text-claude-subtle">
                  Stored in your browser only — never sent to our servers.
                </p>
              </div>

              {/* Model */}
              <div>
                <label className="mb-1.5 block text-sm font-medium text-claude-text">Model</label>
                <select
                  value={draft.model}
                  onChange={e => setDraft(d => ({ ...d, model: e.target.value }))}
                  className="w-full rounded-lg border border-claude-border bg-claude-surface2 px-4 py-2.5 text-sm text-claude-text focus:border-claude-border-hi focus:outline-none"
                >
                  {MODEL_OPTIONS[draft.provider].map(opt => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => setOpen(false)}
              className="rounded-lg border border-claude-border px-4 py-2 text-sm text-claude-muted hover:bg-claude-surface2">
              Cancel
            </button>
            <button onClick={save}
              className="rounded-lg bg-claude-accent px-4 py-2 text-sm font-semibold text-white hover:bg-claude-accent-dim">
              Save
            </button>
          </div>
        </div>
        </div>
      </div>
    </div>
  );
}
