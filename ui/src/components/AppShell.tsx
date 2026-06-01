"use client";

// AppShell detects whether the user is signed in (→ cloud/backend mode)
// or not (→ local/free mode) and renders the appropriate components.

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { loadLocalSettings, saveLocalSettings, LocalSettings } from "@/lib/appMode";
import { ModeSelector } from "./ModeSelector";
import { DocumentUpload } from "./DocumentUpload";
import { QueryForm } from "./QueryForm";
import { LocalDocumentUpload } from "./LocalDocumentUpload";
import { LocalQueryForm } from "./LocalQueryForm";

export function AppShell() {
  const { isSignedIn, getToken } = useAuth();
  const [settings, setSettings] = useState<LocalSettings | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // Load settings from localStorage after hydration
  useEffect(() => {
    setSettings(loadLocalSettings());
  }, []);

  // Fetch a fresh Clerk token whenever sign-in state changes
  useEffect(() => {
    if (isSignedIn) {
      getToken().then(setToken).catch(() => setToken(null));
    } else {
      setToken(null);
    }
  }, [isSignedIn, getToken]);

  // Null during SSR / first paint — avoid layout shift
  if (settings === null) {
    return (
      <div className="w-full max-w-3xl space-y-4 animate-pulse">
        <div className="h-12 rounded-xl bg-claude-surface border border-claude-border" />
        <div className="h-12 rounded-xl bg-claude-surface border border-claude-border" />
        <div className="h-44 rounded-2xl bg-claude-surface border border-claude-border" />
      </div>
    );
  }

  const useBackend = !!isSignedIn && !settings.forceLocal;

  return (
    <>
      <ModeSelector settings={settings} onChange={(s) => { setSettings(s); saveLocalSettings(s); }} />

      {useBackend ? (
        <>
          <DocumentUpload />
          <QueryForm token={token ?? undefined} />
        </>
      ) : (
        <>
          <LocalDocumentUpload settings={settings} />
          <LocalQueryForm settings={settings} />
        </>
      )}
    </>
  );
}
